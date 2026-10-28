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
  // Início em painéis: o número de falhas em vermelho (--danger) fica sobre o cartão e sobre o fundo.
  ...SURFACES.map((surface): [ColorToken, ColorToken] => ['--danger', surface]),
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
 * Selos de estado (chip e marca de estado, em pílula): o texto é a cor do tom e o fundo é a mesma cor a
 * 14% sobre --surface (`color-mix(in srgb, tom 14%, var(--surface))` em app.css). O teste calcula essa
 * mistura aqui, em #rrggbb, e mede cada par com o mesmo limite de 4,5:1. Tons: lima (ativo/ok),
 * --warn (aguardando), --danger (erro), --brand (marca) e --muted (neutro).
 */
const BADGE_TONES = ['--accent', '--warn', '--danger', '--brand', '--muted'] as const;
const BADGE_TINT = 0.14;

/** `foreground` a `alpha` sobre `background`, como `color-mix(in srgb, ...)`, devolvido em #rrggbb. */
function mixOver(foreground: string, background: string, alpha: number): string {
  const channels = (color: string): number[] => {
    const hex = color.trim().replace(/^#/, '');
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const value = Number.parseInt(full, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const [front, back] = [channels(foreground), channels(background)];
  const mixed = front.map((channel, index) =>
    Math.round(channel * alpha + (back[index] ?? 0) * (1 - alpha)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

describe('selos de estado em pílula', () => {
  it('a mistura calculada pelo teste confere com um caso conhecido', () => {
    expect(mixOver('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixOver('#ff0000', '#000000', 1)).toBe('#ff0000');
  });

  it.each(BADGE_TONES)('o tom %s sobre ele mesmo a 14% sobre --surface passa de 4,5:1', (tone) => {
    const color = tokens.get(tone) ?? '';
    const fill = mixOver(color, tokens.get('--surface') ?? '', BADGE_TINT);
    expect(fill).not.toBe(color);
    expect(contrastRatio(color, fill), `${tone} (${color}) sobre ${fill}`).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    );
  });
});

/**
 * O chrome novo (barra superior, navegação e casca, em workspace.css) usa só as cores neutras do
 * tema: --bg, --surface, --line, --field-line, --muted e --text, o anel de foco (--focus) e misturas
 * delas por color-mix. O lima (--accent) só marca o item ativo da navegação (teste próprio abaixo). As
 * cores de destaque dos dados (estados, contadores) nunca entram no chrome. As variáveis derivadas
 * ficam em workspace.css, escopadas num seletor: o tokens.css só guarda #rrggbb.
 */
describe('cores do chrome do workspace', () => {
  const workspaceCss = readFileSync(
    resolve(import.meta.dirname, '../../src/renderer/styles/workspace.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  // --focus: o anel de foco lima é o mesmo em toda a interface (identidade visual).
  // --surface: o cartão da barra lateral (Tarefa 5). --surface-2: o menu flutuante "+" (Tarefa 6).
  const NEUTRAL = new Set([
    '--bg',
    '--surface',
    '--surface-2',
    '--line',
    '--field-line',
    '--muted',
    '--text',
    '--focus',
  ]);
  // Variáveis do chrome que não são cor: espaçamento, fonte, raio, movimento e os tokens compostos de
  // sombra e brilho, por nome exato. As cores desses três são conferidas no teste "sombras e brilho".
  const NOT_COLOR =
    /^--(?:space|font|radius|ease|dur)(?:-|$)|^--(?:shadow-card|shadow-pop|glow-app)$/;

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
      (name) =>
        name !== '--accent' && !NEUTRAL.has(name) && !NOT_COLOR.test(name) && !derived.has(name),
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

  it('a aba ativa sobre --bg tem texto --text legível, e o anel --muted passa de 3:1', () => {
    // A aba ativa usa o fundo da página (--bg). O anel de 1px em --muted é a marca do estado além do peso
    // do texto, e precisa de 3:1 sobre o fundo (WCAG 1.4.11).
    const background = tokens.get('--bg') ?? '';
    expect(contrastRatio(tokens.get('--text') ?? '', background)).toBeGreaterThanOrEqual(
      MIN_CONTRAST,
    );
    expect(contrastRatio(tokens.get('--muted') ?? '', background)).toBeGreaterThanOrEqual(3);
  });

  it('o lima (--accent) só aparece na barra do link atual da lateral', () => {
    const allowed = [".sidebar__link[aria-current='page']"];
    const rules = [...workspaceCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const using = rules.filter(([, , body = '']) => body.includes('var(--accent)'));
    expect(using.length).toBeGreaterThan(0);
    for (const [, selectors = '', body = ''] of using) {
      const list = selectors.split(',').map((item) => item.trim());
      expect(
        list.every((item) => allowed.includes(item)),
        selectors.trim(),
      ).toBe(true);
      // A barra de 3px do link atual.
      expect(body, selectors.trim()).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--accent\)/);
    }
  });

  it('as sombras e o brilho (tokens.css) só usam preto da casca, branco e o violeta da marca', () => {
    const tokens = readFileSync(
      resolve(import.meta.dirname, '../../src/renderer/styles/tokens.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const allowed = new Set(['4 2 16', '255 255 255', '181 131 255']);
    for (const name of ['--shadow-card', '--shadow-pop', '--glow-app']) {
      const value = new RegExp(String.raw`${name}\s*:([^;]+);`).exec(tokens)?.[1] ?? '';
      expect(value, name).not.toBe('');
      const colors = [...value.matchAll(/rgb\(\s*(\d+ \d+ \d+)\s*\//g)].map(([, rgb = '']) => rgb);
      expect(colors.length, name).toBeGreaterThan(0);
      for (const rgb of colors) expect(allowed.has(rgb), `${name}: rgb(${rgb})`).toBe(true);
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

/**
 * Aba Plano (plan.css), quadro do orquestrador (orchestrator-board.css) e barra de status (statusbar.css): só tokens de tokens.css e
 * app.css, sem cor literal, sem animação. O programa é texto e a cor só o reforça; cada cor de programa
 * (hoje o laranja do Claude) passa de 4,5:1 como texto e de 3:1 como borda sobre o fundo e o cartão
 * (WCAG 1.4.3 e 1.4.11). O lima (--accent) fica fora desses dois arquivos.
 */
describe.each(['plan.css', 'orchestrator-board.css', 'statusbar.css'])('cores de %s', (name) => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/renderer/styles', name),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const ALLOWED = new Set([
    '--bg',
    '--surface',
    '--surface-2',
    '--surface-glass',
    '--line',
    '--field-line',
    '--muted',
    '--text',
    '--blue',
    '--orange',
    '--brand',
    '--danger',
    '--board-line',
  ]);
  const NOT_COLOR = /^--(?:space|font|text|radius)(?:-|$)/;

  it('só usa var() de tokens permitidos', () => {
    const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, token = '']) => token);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((token) => !ALLOWED.has(token) && !NOT_COLOR.test(token))).toEqual([]);
  });

  it('não escreve cor literal, não usa o lima e não tem animação nem estilo inline', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i);
    expect(css).not.toContain('var(--accent)');
    expect(css).not.toMatch(/\b(?:animation|transition)\b/);
  });
});

describe('cores dos programas no quadro do orquestrador', () => {
  const PROGRAM_COLORS = ['--orange'] as const;
  const BORDERS = ['--brand', ...PROGRAM_COLORS] as const;

  it.each(PROGRAM_COLORS)(
    'o nome do programa em %s passa de 4,5:1 sobre o cartão e o fundo',
    (color) => {
      const text = tokens.get(color) ?? '';
      for (const surface of ['--surface', '--bg']) {
        expect(
          contrastRatio(text, tokens.get(surface) ?? ''),
          `${color} sobre ${surface}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    },
  );

  it.each(BORDERS)('a borda do cartão em %s passa de 3:1 sobre o fundo e o cartão', (color) => {
    const border = tokens.get(color) ?? '';
    for (const surface of ['--surface', '--bg']) {
      expect(
        contrastRatio(border, tokens.get(surface) ?? ''),
        `${color} sobre ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('o estado "falhou" (--danger) e o texto neutro passam de 4,5:1 sobre o cartão', () => {
    const surface = tokens.get('--surface') ?? '';
    for (const color of ['--danger', '--text', '--muted']) {
      expect(contrastRatio(tokens.get(color) ?? '', surface), color).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      );
    }
  });
});

/**
 * Início em painéis (home.css): só tokens de tokens.css, sem cor literal, sem animação. Cada cor de
 * destaque tem um lugar: o lima (--accent) só no dia de hoje do mapa de atividade e no preenchimento da
 * barra de missão em andamento ou concluída, o âmbar (--warn) só no preenchimento da barra de missão que
 * espera a pessoa, o vermelho (--danger) só no da barra de missão que falhou, e o mapa usa a rampa de --muted
 * (#b7adcf) por opacidade. O texto do cartão (--text e --muted sobre --surface e --surface-2) já está nos pares do começo.
 */
describe('cores do Início (home.css)', () => {
  const homeCss = readFileSync(
    resolve(import.meta.dirname, '../../src/renderer/styles/home.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...homeCss.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(
    ([, selectors = '', body = '']) => ({
      selectors: selectors
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      body,
    }),
  );
  const ALLOWED = new Set([
    '--bg',
    '--surface',
    '--surface-2',
    '--line',
    '--field-line',
    '--muted',
    '--text',
    '--accent',
    '--warn',
    '--danger',
  ]);
  const NOT_COLOR = /^--(?:space|font|text|radius)(?:-|$)/;
  /** O preenchimento da barra de progresso, nos dois motores (WebKit e Gecko), por tom do estado. */
  const FILL = (tone: string) => [
    `.mission-progress__bar--${tone}::-webkit-progress-value`,
    `.mission-progress__bar--${tone}::-moz-progress-bar`,
  ];

  it('só usa var() de tokens permitidos', () => {
    const used = [...homeCss.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name = '']) => name);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !ALLOWED.has(name) && !NOT_COLOR.test(name))).toEqual([]);
  });

  it('não escreve cor literal nem usa outro acento', () => {
    expect(homeCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(homeCss).not.toMatch(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i);
    for (const accent of ACCENTS) {
      expect(homeCss, accent).not.toContain(`var(${accent})`);
    }
  });

  it.each([
    ['--accent', ['.activity-cell--today', ...FILL('lime')]],
    ['--warn', FILL('warn')],
    ['--danger', FILL('red')],
  ])('%s só aparece onde tem papel', (token, allowed) => {
    const using = rules.filter(({ body }) => body.includes(`var(${token})`));
    expect(using.length).toBeGreaterThan(0);
    for (const { selectors } of using) {
      expect(
        selectors.every((item) => allowed.includes(item)),
        selectors.join(', '),
      ).toBe(true);
    }
  });

  it('a barra de progresso pinta o preenchimento por tom do estado e o trilho de --line', () => {
    for (const [tone, token] of [
      ['lime', '--accent'],
      ['warn', '--warn'],
      ['red', '--danger'],
    ] as const) {
      for (const selector of FILL(tone)) {
        const rule = rules.find((item) => item.selectors.includes(selector));
        expect(rule?.body, selector).toMatch(new RegExp(String.raw`background:\s*var\(${token}\)`));
      }
    }
    const track = rules.find((item) =>
      item.selectors.includes('.mission-progress__bar::-webkit-progress-bar'),
    );
    expect(track?.body).toMatch(/background:\s*var\(--line\)/);
  });

  it('a rampa do mapa vai de 0 a 4 só com --muted, em opacidade crescente', () => {
    const percent: number[] = [];
    for (let level = 0; level <= 4; level += 1) {
      const rule = rules.find(({ selectors }) => selectors.includes(`.activity-level--${level}`));
      expect(rule, `nível ${level}`).toBeDefined();
      const body = rule?.body ?? '';
      expect(body).toContain('var(--muted)');
      const mix = /color-mix\(in srgb, var\(--muted\) (\d+)%, transparent\)/.exec(body);
      percent.push(mix === null ? 100 : Number(mix[1]));
    }
    expect(percent).toEqual([...percent].sort((a, b) => a - b));
    expect(new Set(percent).size).toBe(5);
  });

  it('não tem animação nem transição', () => {
    expect(homeCss).not.toMatch(/\b(?:animation|transition)\b/);
  });
});
