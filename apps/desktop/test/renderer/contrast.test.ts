import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contraste dos tokens de cor (WCAG 2.2 AA, seção 12.4 do planejamento): todo par texto/fundo
 * precisa de pelo menos 4,5:1 no tema claro e no tema escuro. O teste lê o `tokens.css` de verdade,
 * então trocar uma cor por um valor fraco derruba este teste.
 */

const MIN_CONTRAST = 4.5;

const COLOR_TOKENS = [
  '--color-bg',
  '--color-text',
  '--color-accent',
  '--color-danger',
  '--color-success',
  '--color-warning',
] as const;

type ColorToken = (typeof COLOR_TOKENS)[number];

/**
 * Pares de texto sobre fundo que o aplicativo usa. O accent também é a cor dos links e do contorno
 * do foco. Um par novo (por exemplo, texto sobre um fundo de botão) entra nesta lista.
 */
const TEXT_ON_BACKGROUND: [text: ColorToken, background: ColorToken][] = [
  ['--color-text', '--color-bg'],
  ['--color-accent', '--color-bg'],
  ['--color-danger', '--color-bg'],
  ['--color-success', '--color-bg'],
  ['--color-warning', '--color-bg'],
];

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa de uma cor `#rgb` ou `#rrggbb`. Qualquer outra forma é erro, não é ignorada. */
function luminance(color: string): number {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (digits === undefined) {
    throw new Error(`Cor não suportada pelo teste de contraste: "${color}". Use #rgb ou #rrggbb.`);
  }
  const hex = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const value = Number.parseInt(hex, 16);
  const linear = (shift: number): number => channelToLinear((value >> shift) & 255);
  return 0.2126 * linear(16) + 0.7152 * linear(8) + 0.0722 * linear(0);
}

function contrastRatio(first: string, second: string): number {
  const [a, b] = [luminance(first), luminance(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Declarações `--nome: valor` de um trecho de CSS. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
    if (name !== undefined && value !== undefined) {
      found.set(name, value);
    }
  }
  return found;
}

/** Os dois temas do `tokens.css`: o claro vem do `:root` e o escuro, do `prefers-color-scheme`. */
function readThemes(css: string): { light: Map<string, string>; dark: Map<string, string> } {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const darkBlock = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{([\s\S]*?\})\s*\}/.exec(
    withoutComments,
  )?.[1];
  if (darkBlock === undefined) {
    throw new Error('tokens.css precisa de um @media (prefers-color-scheme: dark)');
  }
  const outsideMedia = withoutComments.replace(/@media[\s\S]*?\}\s*\}/g, '');
  const lightBlocks = [...outsideMedia.matchAll(/:root\s*\{([^}]*)\}/g)].map((match) => match[1]);
  if (lightBlocks.length === 0) {
    throw new Error('tokens.css precisa de um bloco :root');
  }
  return { light: declarations(lightBlocks.join('\n')), dark: declarations(darkBlock) };
}

// Neste projeto (jsdom) não use new URL('texto literal', import.meta.url): o Vite reescreve esse
// padrão para um endereço http://localhost. import.meta.dirname é o caminho real da pasta do teste.
const tokensCss = readFileSync(
  resolve(import.meta.dirname, '../../src/renderer/styles/tokens.css'),
  'utf8',
);
const themes = readThemes(tokensCss);

describe('cálculo do contraste', () => {
  it('preto sobre branco é 21:1 e cor igual é 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('não depende da ordem das cores e aceita #rgb', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(contrastRatio('#000000', '#ffffff'), 10);
  });

  it('separa o cinza #767676 (4,54:1, passa) do #777777 (4,48:1, falha) sobre branco', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(MIN_CONTRAST);
  });

  it('recusa cor que não é #rgb nem #rrggbb, em vez de ignorar', () => {
    expect(() => contrastRatio('rgb(0, 0, 0)', '#ffffff')).toThrow('Cor não suportada');
    expect(() => contrastRatio('var(--color-bg)', '#ffffff')).toThrow('Cor não suportada');
  });
});

describe.each([
  { name: 'claro', declared: themes.light },
  { name: 'escuro', declared: themes.dark },
])('tema $name', ({ declared }) => {
  it('define todos os tokens de cor', () => {
    const colorTokens = [...declared.keys()].filter((token) => token.startsWith('--color-'));
    expect(colorTokens.sort()).toEqual([...COLOR_TOKENS].sort());
  });

  it.each(TEXT_ON_BACKGROUND)(
    '%s sobre %s tem contraste de pelo menos 4,5:1',
    (text, background) => {
      const textColor = declared.get(text) ?? '';
      const backgroundColor = declared.get(background) ?? '';
      expect(
        contrastRatio(textColor, backgroundColor),
        `${text} (${textColor}) sobre ${background} (${backgroundColor})`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    },
  );
});

describe('os dois temas', () => {
  it('o escuro troca o fundo e o texto do claro, em vez de repeti-los', () => {
    expect(themes.dark.get('--color-bg')).not.toBe(themes.light.get('--color-bg'));
    expect(themes.dark.get('--color-text')).not.toBe(themes.light.get('--color-text'));
  });
});
