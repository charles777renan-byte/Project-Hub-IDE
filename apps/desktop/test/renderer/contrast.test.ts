import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contraste dos tokens de cor (WCAG 2.2 AA, seção 12.4 do planejamento): todo texto sobre um fundo
 * precisa de pelo menos 4,5:1. O aplicativo tem só o tema escuro (R172). O teste lê o `tokens.css`
 * de verdade, então trocar uma cor por um valor fraco derruba este teste.
 */

const MIN_CONTRAST = 4.5;

const ACCENTS = [
  '--violet',
  '--red',
  '--blue',
  '--magenta',
  '--orange',
  '--lime',
  '--cyan',
  '--yellow',
] as const;

const COLOR_TOKENS = [
  '--bg',
  '--panel',
  '--panel-2',
  '--line',
  '--field-line',
  '--text',
  '--muted',
  '--surface',
  '--surface-2',
  '--accent',
  '--accent-ink',
  '--focus',
  '--danger',
  '--warn',
  '--brand',
  ...ACCENTS,
] as const;

type ColorToken = (typeof COLOR_TOKENS)[number];

const SURFACES = ['--bg', '--panel', '--panel-2', '--surface', '--surface-2'] as const;
const TEXTS = ['--text', '--muted', '--accent', ...ACCENTS] as const;

/**
 * Pares de texto sobre fundo que o aplicativo usa. --panel e --panel-2 valem --surface, então entram
 * na lista para o teste falhar se um deles passar a ser outro tom. Texto, texto secundário e
 * cada acento (chip, link, borda com texto, aba) são medidos sobre cada superfície; o texto escuro
 * (`--bg`) dentro de botão ou aba cheios é medido sobre cada acento. Um par novo entra nesta lista.
 */
const TEXT_ON_BACKGROUND: [text: ColorToken, background: ColorToken][] = [
  ...TEXTS.flatMap((text) => SURFACES.map((surface): [ColorToken, ColorToken] => [text, surface])),
  ...ACCENTS.map((accent): [ColorToken, ColorToken] => ['--bg', accent]),
  // Barra superior e navegação do workspace: a aba ativa e o item ativo ficam sobre --field-line, e o
  // botão de fechar e o passar do mouse usam --line e --field-line por trás do texto secundário.
  ['--muted', '--field-line'],
  ['--muted', '--line'],
  ['--text', '--field-line'],
  ['--text', '--line'],
  // Identidade visual: texto escuro dentro do botão e da aba cheios em lima.
  ['--accent-ink', '--accent'],
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

/** Os tokens do bloco `:root`, que é o único tema (escuro). */
function readTokens(css: string): { tokens: Map<string, string>; hasLightTheme: boolean } {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rootBlocks = [...withoutComments.matchAll(/:root\s*\{([^}]*)\}/g)].map((match) => match[1]);
  if (rootBlocks.length === 0) {
    throw new Error('tokens.css precisa de um bloco :root');
  }
  return {
    tokens: declarations(rootBlocks.join('\n')),
    hasLightTheme: /prefers-color-scheme\s*:\s*light/.test(withoutComments),
  };
}

// Neste projeto (jsdom) não use new URL('texto literal', import.meta.url): o Vite reescreve esse
// padrão para um endereço http://localhost. import.meta.dirname é o caminho real da pasta do teste.
const tokensCss = readFileSync(
  resolve(import.meta.dirname, '../../src/renderer/styles/tokens.css'),
  'utf8',
);
const { tokens, hasLightTheme } = readTokens(tokensCss);

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
    expect(() => contrastRatio('var(--bg)', '#ffffff')).toThrow('Cor não suportada');
  });
});

describe('tema escuro', () => {
  it('define todos os tokens de cor, em #rrggbb ou #rgb', () => {
    for (const token of COLOR_TOKENS) {
      expect(tokens.get(token), token).toBeDefined();
      expect(() => luminance(tokens.get(token) ?? '')).not.toThrow();
    }
  });

  // Atualizado na identidade visual: os cartões passaram a ter superfície própria (--surface), mais
  // clara que o fundo; --panel e --panel-2 seguem existindo e apontam para ela.
  it('painéis e caixas internas valem --surface, e --surface difere do fundo', () => {
    expect(tokens.get('--panel')).toBe(tokens.get('--surface'));
    expect(tokens.get('--panel-2')).toBe(tokens.get('--surface'));
    expect(tokens.get('--surface')).not.toBe(tokens.get('--bg'));
  });

  it('os aliases semânticos apontam para o acento certo', () => {
    expect(tokens.get('--accent')).toBe(tokens.get('--lime'));
    expect(tokens.get('--accent-ink')).toBe(tokens.get('--bg'));
    expect(tokens.get('--focus')).toBe(tokens.get('--lime'));
    expect(tokens.get('--danger')).toBe(tokens.get('--red'));
    expect(tokens.get('--warn')).toBe(tokens.get('--yellow'));
    expect(tokens.get('--brand')).toBe(tokens.get('--violet'));
  });

  it('não tem tema claro: o aplicativo é escuro (R172)', () => {
    expect(hasLightTheme).toBe(false);
    expect(tokensCss).toMatch(/color-scheme:\s*dark/);
  });

  it.each(TEXT_ON_BACKGROUND)(
    '%s sobre %s tem contraste de pelo menos 4,5:1',
    (text, background) => {
      const textColor = tokens.get(text) ?? '';
      const backgroundColor = tokens.get(background) ?? '';
      expect(
        contrastRatio(textColor, backgroundColor),
        `${text} (${textColor}) sobre ${background} (${backgroundColor})`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    },
  );
});

/**
 * O chrome novo (barra superior, navegação e casca, em workspace.css) usa só as cores neutras do
 * tema: --bg, --line, --field-line, --muted e --text, e misturas delas por color-mix. As cores de
 * destaque ficam para os dados (estados, contadores), nunca para o chrome. As variáveis derivadas
 * ficam em workspace.css, escopadas num seletor: o tokens.css só guarda #rrggbb.
 */
describe('cores do chrome do workspace', () => {
  const workspaceCss = readFileSync(
    resolve(import.meta.dirname, '../../src/renderer/styles/workspace.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const NEUTRAL = new Set(['--bg', '--line', '--field-line', '--muted', '--text']);
  // Variáveis do chrome que não são cor: espaçamento, fonte e raio.
  const NOT_COLOR = /^--(?:space|font|radius)(?:-|$)/;

  /** Variáveis derivadas, definidas em workspace.css: `--nome: color-mix(...)`. */
  const derived = new Map(
    [...workspaceCss.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(
      ([, name = '', value = '']) => [name, value.trim()] as const,
    ),
  );

  it('só usa var() das cores neutras, de espaçamento, de fonte ou de uma derivada local', () => {
    const used = [...workspaceCss.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name = '']) => name);
    expect(used.length).toBeGreaterThan(0);
    const foreign = used.filter(
      (name) => !NEUTRAL.has(name) && !NOT_COLOR.test(name) && !derived.has(name),
    );
    expect(foreign).toEqual([]);
  });

  it('não escreve cor literal nem usa cor de destaque', () => {
    expect(workspaceCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(workspaceCss).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i);
    for (const accent of ACCENTS) {
      expect(workspaceCss, accent).not.toContain(`var(${accent})`);
    }
  });

  it('cada variável derivada é um color-mix só das cores neutras', () => {
    expect(derived.size).toBeGreaterThan(0);
    for (const [name, value] of derived) {
      expect(value, name).toMatch(/^color-mix\(/);
      const inputs = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, token = '']) => token);
      expect(inputs.length, name).toBeGreaterThan(0);
      for (const input of inputs) {
        expect(NEUTRAL.has(input), `${name} usa ${input}`).toBe(true);
      }
    }
  });
});
