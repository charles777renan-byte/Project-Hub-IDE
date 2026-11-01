import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mediaBlock, readCss, ruleDeclarations } from './css-rules';

/**
 * O renderer roda com `style-src 'self'` e `script-src 'self'` (ADR 0007, item 6): sem estilo nem
 * script inline. Em produção, o Vite junta o CSS num arquivo e o liga por <link>. Em
 * desenvolvimento, um CSS importado por módulo TS vira um <style> que o cliente do Vite injeta, e a
 * CSP bloqueia. Por isso o CSS é ligado por <link> no index.html, que o Vite serve como arquivo nos
 * dois modos, e nenhum módulo do renderer importa CSS.
 */

// Neste projeto (jsdom) não use new URL('texto literal', import.meta.url): o Vite reescreve esse
// padrão para um endereço http://localhost. import.meta.dirname é o caminho real da pasta do teste.
const rendererDirectory = resolve(import.meta.dirname, '../../src/renderer');
const page = new DOMParser().parseFromString(
  readFileSync(join(rendererDirectory, 'index.html'), 'utf8'),
  'text/html',
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('index.html do renderer', () => {
  it('tem a raiz do React e um só script, externo e do tipo módulo', () => {
    expect(page.querySelectorAll('div#root')).toHaveLength(1);
    const scripts = [...page.querySelectorAll('script')];
    expect(
      scripts.map((script) => ({
        type: script.type,
        src: script.getAttribute('src'),
        inline: script.textContent,
      })),
    ).toEqual([{ type: 'module', src: './main.tsx', inline: '' }]);
  });

  it('não tem elemento <style> nem atributo style', () => {
    expect(page.querySelectorAll('style')).toHaveLength(0);
    expect(page.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('liga os estilos por <link rel="stylesheet">, as fontes e os tokens primeiro, o home.css, o plan.css, o orchestrator-board.css e o statusbar.css, o project.css, o mission.css e o progress.css depois do app.css, o workspace.css e, por último, o motion.css', () => {
    const hrefs = [...page.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      './styles/fonts.css',
      './styles/tokens.css',
      './styles/xterm.css',
      './styles/app.css',
      './styles/home.css',
      './styles/plan.css',
      './styles/orchestrator-board.css',
      './styles/statusbar.css',
      './styles/project.css',
      './styles/mission.css',
      './styles/progress.css',
      './styles/workspace.css',
      './styles/motion.css',
    ]);
  });

  it('não liga nenhum recurso de fora do aplicativo', () => {
    const references = [...page.querySelectorAll('[href], [src]')].flatMap((element) => [
      element.getAttribute('href') ?? '',
      element.getAttribute('src') ?? '',
    ]);
    expect(
      references.filter((reference) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)),
    ).toEqual([]);
  });
});

/**
 * Fontes locais (Tarefa 1 do plano da interface do workspace): Inter no texto e JetBrains Mono nos
 * dados, como arquivos `.woff2` em `assets/fonts/`. A CSP (`default-src 'self'`) não deixa carregar
 * fonte de fora, e `font-src` cai no `default-src`, então a fonte tem de ser um arquivo do aplicativo.
 * Estes testes leem os arquivos de verdade; que o Chromium aceita a fonte sob a CSP quem prova é o
 * E2E (`e2e/security.spec.ts`).
 */
const stylesDirectory = join(rendererDirectory, 'styles');
const fontsDirectory = join(rendererDirectory, 'assets', 'fonts');

const EXPECTED_FACES = [
  ...[400, 500, 600, 700].map((weight) => ({
    family: 'Inter',
    weight,
    file: `inter-latin-${weight}-normal.woff2`,
  })),
  ...[400, 500, 600].map((weight) => ({
    family: 'JetBrains Mono',
    weight,
    file: `jetbrains-mono-latin-${weight}-normal.woff2`,
  })),
];

type FontFace = { family: string; weight: number; style: string; display: string; src: string };

/** Lê cada bloco `@font-face` do CSS. Uma declaração que falta vira `''`, e o teste a reprova. */
function parseFontFaces(css: string): FontFace[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body = '']) => {
    const read = (property: string) =>
      new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim() ?? '';
    return {
      family: read('font-family').replace(/^['"]|['"]$/g, ''),
      weight: Number(read('font-weight')),
      style: read('font-style'),
      display: read('font-display'),
      src: read('src'),
    };
  });
}

describe('fontes locais', () => {
  // Lido por teste, e não na carga do arquivo: sem o fonts.css só os testes de fonte falham.
  const loadFaces = () => parseFontFaces(readFileSync(join(stylesDirectory, 'fonts.css'), 'utf8'));

  it('declara @font-face de Inter (400 a 700) e de JetBrains Mono (400 a 600), só normal', () => {
    expect(loadFaces().map(({ family, weight, style }) => ({ family, weight, style }))).toEqual(
      EXPECTED_FACES.map(({ family, weight }) => ({ family, weight, style: 'normal' })),
    );
  });

  it('usa font-display: swap em todas', () => {
    expect(loadFaces().map((face) => face.display)).toEqual(EXPECTED_FACES.map(() => 'swap'));
  });

  it('aponta cada face para um único .woff2 relativo, sem http, data: nem // ', () => {
    const sources = loadFaces().map((face) => face.src);
    expect(sources).toEqual(
      EXPECTED_FACES.map(({ file }) => `url(../assets/fonts/${file}) format('woff2')`),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/https?:|data:|\/\/|@import/i);
    }
  });

  it('não importa nem referencia endereço de fora em nenhum CSS do renderer', () => {
    for (const name of [
      'fonts.css',
      'tokens.css',
      'app.css',
      'plan.css',
      'orchestrator-board.css',
      'statusbar.css',
      'project.css',
      'mission.css',
      'progress.css',
      'workspace.css',
      'motion.css',
    ]) {
      const css = readFileSync(join(stylesDirectory, name), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      );
      expect(css, name).not.toMatch(/@import|https?:|url\(\s*['"]?(?:data:|\/\/)/i);
    }
  });

  it('tem em assets/fonts cada arquivo referenciado, e só ele (mais a licença)', () => {
    const referenced = loadFaces().map(
      (face) => /url\(\.\.\/assets\/fonts\/([^)]+)\)/.exec(face.src)?.[1],
    );
    expect(referenced).toEqual(EXPECTED_FACES.map(({ file }) => file));
    expect(readdirSync(fontsDirectory).sort()).toEqual(
      [...EXPECTED_FACES.map(({ file }) => file), 'LICENSES.md'].sort(),
    );
    for (const { file } of EXPECTED_FACES) {
      const content = readFileSync(join(fontsDirectory, file));
      // Todo .woff2 começa pela assinatura "wOF2"; um arquivo vazio, de texto ou de outro formato falha.
      expect(content.subarray(0, 4).toString('latin1'), file).toBe('wOF2');
      expect(content.length, file).toBeGreaterThan(10_000);
    }
  });

  it('registra a licença OFL das duas famílias em LICENSES.md', () => {
    const licenses = readFileSync(join(fontsDirectory, 'LICENSES.md'), 'utf8');
    expect(licenses).toContain('Inter');
    expect(licenses).toContain('JetBrains Mono');
    expect(licenses).toContain('@fontsource/inter');
    expect(licenses).toContain('@fontsource/jetbrains-mono');
    expect(licenses).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licenses).toMatch(/sha512-[A-Za-z0-9+/]+=*/);
  });

  it('começa --font-sans por Inter e --font-mono por JetBrains Mono, com a pilha do sistema depois', () => {
    const tokensCss = readFileSync(join(stylesDirectory, 'tokens.css'), 'utf8');
    const read = (token: string) =>
      new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(tokensCss)?.[1]?.trim() ?? '';
    const sans = read('--font-sans');
    const mono = read('--font-mono');
    expect(sans.startsWith('Inter,')).toBe(true);
    expect(sans).toContain('system-ui');
    expect(sans.endsWith('sans-serif')).toBe(true);
    expect(mono.startsWith("'JetBrains Mono',")).toBe(true);
    expect(mono).toContain('ui-monospace');
    expect(mono.endsWith('monospace')).toBe(true);
  });
});

describe('tokens da identidade visual', () => {
  const root = ruleDeclarations(readCss('tokens.css'), ':root');

  it('define os raios, a escala tipográfica e as transições', () => {
    expect(root.get('--radius')).toBe('8px');
    expect(root.get('--radius-card')).toBe('12px');
    expect(root.get('--radius-panel')).toBe('var(--radius-card)');
    expect(root.get('--radius-pill')).toBe('999px');
    expect(['xs', 'sm', 'md', 'lg', 'xl'].map((size) => root.get(`--text-${size}`))).toEqual([
      '0.75rem',
      '0.8125rem',
      '0.9375rem',
      '1.125rem',
      '1.5rem',
    ]);
    expect(root.get('--dur-fast')).toBe('120ms');
    expect(root.get('--dur')).toBe('180ms');
    for (const token of ['--ease', '--shadow-card', '--shadow-pop', '--glow-app']) {
      expect(root.get(token), token).toBeDefined();
    }
  });

  it('body define font-size e color, para o texto cru herdar do aplicativo', () => {
    const body = ruleDeclarations(readCss('app.css'), 'body');
    expect(body.get('font-size')).toBe('var(--text-md)');
    expect(body.get('color')).toBe('var(--text)');
  });

  it('`.app-main p` não declara font-size: parágrafos com classe própria (eyebrow, project-path) mantêm o tamanho que têm', () => {
    expect(ruleDeclarations(readCss('app.css'), '.app-main p').has('font-size')).toBe(false);
  });
});

describe('botões, campos e anel de foco', () => {
  const css = readCss('app.css');
  const rule = (selector: string) => ruleDeclarations(css, selector);

  it('o botão base usa o raio de controle, a borda de campo e cursor not-allowed quando desligado', () => {
    expect(rule('button').get('border-radius')).toBe('var(--radius)');
    expect(rule('button').get('border')).toBe('1px solid var(--field-line)');
    expect(rule('button:disabled').get('cursor')).toBe('not-allowed');
  });

  it('a barra de abas, parada do Tab depois de um clique, tem anel de foco que vence o outline inline do Radix', () => {
    const ring = rule('.tabs:focus-visible');
    // O Radix põe `outline: none` inline na barra; só o !important o vence.
    expect(ring.get('outline')).toBe('2px solid var(--focus) !important');
    expect(ring.get('outline-offset')).toBe('2px');
  });

  it('o botão principal é lima cheio com texto --accent-ink; aprovar tem a mesma aparência', () => {
    const primary = rule('.btn-primary');
    expect(primary.get('background')).toBe('var(--accent)');
    expect(primary.get('color')).toBe('var(--accent-ink)');
    expect(primary.get('border-color')).toBe('var(--accent)');
    expect(rule('.btn-decision').get('background')).toBe('var(--accent)');
    expect(rule('.btn-decision').get('color')).toBe('var(--accent-ink)');
  });

  it('secundário tem contorno --field-line, fantasma não tem borda, perigo usa --danger', () => {
    expect(rule('.btn-secondary').get('border-color')).toBe('var(--field-line)');
    expect(rule('.btn-ghost').get('border-color')).toBe('transparent');
    expect(rule('.btn-danger').get('border-color')).toBe('var(--danger)');
    expect(rule('.btn-danger').get('color')).toBe('var(--danger)');
  });

  it('.btn-outline continua, com a cor da marca', () => {
    expect(rule('.btn-outline').get('color')).toBe('var(--brand)');
  });

  it('o botão anima só cor de fundo e de borda, e o movimento reduzido desliga a transição', () => {
    const transition = rule('button').get('transition') ?? '';
    expect(transition).toContain('background-color var(--dur-fast) var(--ease)');
    expect(transition).toContain('border-color var(--dur-fast) var(--ease)');
    // Há mais de um bloco de movimento reduzido: o dos botões e campos é o que vem depois dos campos.
    const reduced = mediaBlock(
      css.slice(css.indexOf('.field input:hover')),
      '(prefers-reduced-motion: reduce)',
    );
    expect(ruleDeclarations(reduced, 'button').get('transition')).toBe('none');
  });

  it('o movimento reduzido também desliga a transição dos campos, e o bloco vem depois da regra deles', () => {
    // Mesma especificidade: o bloco só vence se vier depois da regra base dos campos.
    const reduced = mediaBlock(
      css.slice(css.indexOf('.field textarea {')),
      '(prefers-reduced-motion: reduce)',
    );
    expect(ruleDeclarations(reduced, '.field input').get('transition')).toBe('none');
    expect(ruleDeclarations(reduced, '.field textarea').get('transition')).toBe('none');
  });

  it('o hover dos botões não vale para botão desabilitado', () => {
    for (const selector of [
      'button:hover:not(:disabled)',
      '.btn-primary:hover:not(:disabled)',
      '.btn-decision:hover:not(:disabled)',
      '.btn-secondary:hover:not(:disabled)',
      '.btn-ghost:hover:not(:disabled)',
      '.btn-danger:hover:not(:disabled)',
      '.btn-outline:hover:not(:disabled)',
    ]) {
      expect(ruleDeclarations(css, selector).size, selector).toBeGreaterThan(0);
    }
    expect(css).not.toMatch(/^button:hover \{/m);
  });

  it('a aba ativa tem pistas além do preenchimento: peso 700 e anel de 1px em --muted', () => {
    // O anel mora na pílula (o ::before da aba), que acende na ativa; o peso fica na própria aba.
    expect(rule(".tab[aria-selected='true']").get('font-weight')).toBe('700');
    expect(rule('.tab::before').get('box-shadow')).toBe('inset 0 0 0 1px var(--muted)');
    expect(rule(".tab[aria-selected='true']::before").get('opacity')).toBe('1');
    // A inativa sob o mouse não usa a ponta do gradiente da ativa.
    expect(rule('.tab:hover').get('background')).toBe('var(--surface-2)');
  });

  it('o anel de foco é 2px --focus com deslocamento de 2px', () => {
    expect(rule(':focus-visible').get('outline')).toBe('2px solid var(--focus)');
    expect(rule(':focus-visible').get('outline-offset')).toBe('2px');
  });

  it('o item do menu do workspace tem o anel por dentro (deslocamento de -2px) e não tira o outline', () => {
    // O anel fica por dentro do item (deslocamento negativo); sem outline, o foco do teclado some.
    const item = rule('.workspace__menu-item:focus-visible');
    expect(item.get('outline-offset')).toBe('-2px');
    expect(item.get('outline')).not.toBe('none');
  });

  it('campos têm fundo --surface (sólido; o cartão .form é translúcido), borda --field-line e raio de controle', () => {
    const field = rule('.field input');
    expect(field.get('background')).toBe('var(--surface)');
    expect(field.get('border')).toBe('1px solid var(--field-line)');
    expect(field.get('border-radius')).toBe('var(--radius)');
    expect(rule('.field textarea').get('background')).toBe('var(--surface)');
  });
});

describe('selos de estado em pílula', () => {
  const appCss = readCss('app.css');
  const workspaceCss = readCss('workspace.css');
  const BASES = [
    ['.chip', appCss],
    ['.state-mark', workspaceCss],
  ] as const;
  const TONE_OF: [selector: string, tone: string][] = [
    ['.chip--lime', 'var(--accent)'],
    ['.chip--warn', 'var(--warn)'],
    ['.chip--red', 'var(--danger)'],
    ['.chip--violet', 'var(--brand)'],
    ['.chip--muted', 'var(--muted)'],
    ['.chip--blue', 'var(--muted)'],
    ['.chip--orange', 'var(--muted)'],
    ['.chip--cyan', 'var(--muted)'],
    ['.state-mark--active', 'var(--accent)'],
    ['.state-mark--done', 'var(--accent)'],
    ['.state-mark--waiting', 'var(--warn)'],
    ['.state-mark--error', 'var(--danger)'],
    ['.state-mark--disconnected', 'var(--muted)'],
  ];

  it.each(BASES)('%s tem raio de pílula e padding 2px 8px', (selector, css) => {
    const rule = ruleDeclarations(css, selector);
    expect(rule.size).toBeGreaterThan(0);
    expect(rule.get('border-radius')).toBe('var(--radius-pill)');
    expect(rule.get('padding')).toBe('2px 8px');
  });

  it.each(['.chip', '.state-mark'])('%s pinta fundo e texto com a cor do tom a 14%', (selector) => {
    const rule = ruleDeclarations(appCss, selector);
    expect(rule.get('background')).toBe('color-mix(in srgb, var(--tone) 14%, var(--surface))');
    expect(rule.get('color')).toBe('var(--tone)');
  });

  it.each(TONE_OF)('%s define o tom %s', (selector, tone) => {
    const rule = ruleDeclarations(appCss, selector);
    expect(rule.size).toBeGreaterThan(0);
    expect(rule.get('--tone')).toBe(tone);
  });

  it('com ícone, o ícone toma o lugar do ponto e herda a cor do tom', () => {
    expect(ruleDeclarations(appCss, '.chip--icon::before').get('display')).toBe('none');
    expect(ruleDeclarations(appCss, '.chip__icon').get('flex')).toBe('none');
    // O ícone usa `currentColor` (lucide) e o tamanho vem do atributo `size`: nada de cor fixa nem de
    // atributo style, que a CSP bloquearia.
    expect(ruleDeclarations(appCss, '.chip__icon').has('color')).toBe(false);
  });

  it('o botão "Copiar caminho" alinha o ícone ao texto com um espaço de token', () => {
    const rule = ruleDeclarations(appCss, '.mission-meta__copy');
    expect(rule.get('display')).toBe('inline-flex');
    expect(rule.get('align-items')).toBe('center');
    expect(rule.get('gap')).toBe('var(--space-1)');
  });

  it('o selo não tem hover: é informação, não controle', () => {
    expect(appCss).not.toMatch(/\.chip[^{]*:hover/);
    expect(workspaceCss).not.toMatch(/\.state-mark[^{]*:hover/);
  });
});

/**
 * Aba Progresso (progress.css): a forma que a tela exige. O cartão corta o que passa do arredondamento
 * (`overflow: hidden`), então o anel de foco do botão de expandir tem de ficar por dentro
 * (`outline-offset: -2px`), ou o corte o esconderia. Nenhuma regra faz a página rolar para o lado.
 */
describe('forma da aba Progresso (progress.css)', () => {
  const css = readCss('progress.css');
  const rule = (selector: string) => ruleDeclarations(css, selector);

  it('o cartão da missão corta o excesso e o botão de expandir tem o anel por dentro', () => {
    expect(rule('.progress-row').get('overflow')).toBe('hidden');
    expect(rule('.progress-row__toggle:focus-visible').get('outline-offset')).toBe('-2px');
  });

  it('as colunas e o texto do botão podem encolher (min-width: 0)', () => {
    for (const selector of ['.progress__main', '.progress__aside', '.progress-row__toggle']) {
      expect(rule(selector).get('min-width'), selector).toBe('0');
    }
  });

  it('o painel da visão tem respiro e rola por dentro', () => {
    expect(rule('.project-tab__panel--progresso').get('overflow')).toBe('auto');
  });

  it('o preenchimento tem classe por estado, e a tarefa pendente é só contorno', () => {
    expect(rule('.progress-bar--succeeded').get('fill')).toBe('var(--muted)');
    expect(rule('.progress-bar--running').get('fill')).toBe('var(--blue)');
    expect(rule('.progress-bar--failed').get('fill')).toBe('var(--danger)');
    expect(rule('.progress-seg--succeeded').get('background')).toBe('var(--muted)');
    expect(rule('.progress-seg--running').get('background')).toBe('var(--blue)');
    expect(rule('.progress-seg--failed').get('background')).toBe('var(--danger)');
    const pending = rule('.progress-seg--pending');
    expect(pending.get('border')).toBe('1px solid var(--muted)');
    expect(pending.get('background')).toBe('transparent');
  });

  it('a borda do cartão pede atenção em --warn e falha em --danger; o resto é --line', () => {
    expect(rule('.progress-row').get('border')).toBe('1px solid var(--line)');
    expect(rule('.progress-row--attention').get('border-color')).toBe('var(--warn)');
    expect(rule('.progress-row--failed').get('border-color')).toBe('var(--danger)');
  });

  it('a linha do "agora" é tracejada em --blue', () => {
    const now = rule('.progress-now');
    expect(now.get('stroke')).toBe('var(--blue)');
    expect(now.get('stroke-dasharray')).toBeDefined();
  });

  it('até 1100px a atividade passa para baixo da coluna principal', () => {
    expect(rule('.progress').get('grid-template-columns')).toBe('minmax(0, 1fr)');
    const wide = mediaBlock(css, '(min-width: 1101px)');
    expect(ruleDeclarations(wide, '.progress').get('grid-template-columns')).toMatch(/minmax/);
  });

  it('até 900px a coluna "Papel · programa" some da tabela', () => {
    const narrow = mediaBlock(css, '(max-width: 900px)');
    expect(ruleDeclarations(narrow, '.progress-table__role').get('display')).toBe('none');
  });
});

describe('módulos do renderer', () => {
  it('não importam CSS', () => {
    const importsCss = /^\s*import\b.*\.css(?:\?[^'"]*)?['"]|\bimport\(\s*['"][^'"]*\.css/m;
    const offenders = sourceFiles(rendererDirectory)
      .filter((file) => importsCss.test(readFileSync(file, 'utf8')))
      .map((file) => relative(rendererDirectory, file));
    expect(
      offenders,
      'CSS importado por módulo vira <style> em desenvolvimento e a CSP bloqueia. Ligue o arquivo por <link> no index.html.',
    ).toEqual([]);
  });
});

/**
 * Guarda de CSS e código mortos (Tarefa 8): as classes das telas que saíram (o banner "Aguardando você", o fluxo da
 * missão em cinco etapas, o cartão de projeto, o cabeçalho antigo do projeto, a linha antiga de missão) não voltam
 * nem nos CSS nem nos módulos.
 */
describe('classes removidas', () => {
  const REMOVED = [
    'decision-banner',
    'decision-status',
    'mission-flow',
    'project-card',
    'project-list',
    'project-unavailable',
    'project-head__',
    'mission-row__text',
    'mission-summary',
    'mission-indicator',
    'mission-actions',
    'mission-workspace',
    'mission-tabs',
    'mission-tabpanel',
    'btn-link',
    'page-note',
    'sidebar__meta',
    'sidebar__project',
    'conclusion__item--failed',
    'plan-table',
    'plan-row',
    'plan-actions',
    'plan-agent',
  ];

  it('nenhum CSS do renderer cita uma classe que já não existe', () => {
    const stylesDirectory = join(rendererDirectory, 'styles');
    const offenders = readdirSync(stylesDirectory)
      .filter((name) => name.endsWith('.css'))
      .flatMap((name) => {
        const css = readFileSync(join(stylesDirectory, name), 'utf8');
        return REMOVED.filter((cls) => css.includes(`.${cls}`)).map((cls) => `${name}: .${cls}`);
      });
    expect(offenders).toEqual([]);
  });

  it('nenhum módulo do renderer usa uma classe removida nem importa o componente apagado', () => {
    const offenders = sourceFiles(rendererDirectory).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const classes = REMOVED.filter((cls) => text.includes(cls)).map(
        (cls) => `${relative(rendererDirectory, file)}: ${cls}`,
      );
      const imports = /\b(?:DecisionBanner|MissionFlow|ProjectCard|mission-flow)\b/.test(text)
        ? [`${relative(rendererDirectory, file)}: import de componente apagado`]
        : [];
      return [...classes, ...imports];
    });
    expect(offenders).toEqual([]);
  });

  it('o texto do link "Ver a decisão" do banner apagado não sobrou em mission-text', () => {
    const text = readFileSync(join(rendererDirectory, 'mission-text.ts'), 'utf8');
    expect(text).not.toContain('decisionLink');
  });
});

/**
 * Lista de etapas (plan.css). O jsdom não carrega CSS: nenhum teste de componente enxerga o corte do título
 * com reticências. Este confere o texto das regras, que é o que o navegador aplica. O título longo (acento,
 * emoji) só trunca se a cadeia inteira deixar o bloco encolher: o item flex precisa de `min-width: 0`, e o
 * título, de `overflow: hidden`, `text-overflow: ellipsis` e `white-space: nowrap`. O "⋯" fica fora desse
 * bloco e não encolhe (`flex: none`), então continua visível. Que ele é irmão do bloco, e não filho, está
 * em StepList.test.tsx.
 */
describe('lista de etapas: título longo trunca e o menu continua visível (plan.css)', () => {
  const css = readCss('plan.css');
  const rule = (selector: string) => ruleDeclarations(css, selector);

  it('o bloco do título encolhe: min-width 0 e ocupa o espaço que sobra', () => {
    const main = rule('.step-row__main');
    expect(main.get('min-width')).toBe('0');
    expect(main.get('flex')).toMatch(/^1 1 /);
  });

  it('o título corta com reticências numa linha só', () => {
    const title = rule('.step-row__title');
    expect(title.get('overflow')).toBe('hidden');
    expect(title.get('text-overflow')).toBe('ellipsis');
    expect(title.get('white-space')).toBe('nowrap');
  });

  it('a linha é flex, e o "⋯" e a alça não encolhem', () => {
    expect(rule('.step-row').get('display')).toBe('flex');
    expect(rule('.step-row__menu').get('flex')).toBe('none');
    expect(rule('.step-row__handle').get('flex')).toBe('none');
  });

  it('nenhuma regra põe o "⋯" dentro do bloco que encolhe', () => {
    expect(css).not.toMatch(/\.step-row__main\s+\.step-row__menu/);
    expect(css).not.toMatch(/\.step-row__main\s*>\s*\.step-row__menu/);
  });
});

describe('lateral recolhida', () => {
  it('não desenha traço na borda: a divisória só aparece com o mouse, e o respiro da esquerda é ela', () => {
    const css = readCss('workspace.css');
    expect(css).not.toContain('.app-body--side-collapsed > .pane-tree__separator');
    expect(ruleDeclarations(css, '.app-body--side-collapsed').get('padding-left')).toBe('0');
  });
});

/**
 * Links do app não são sublinhados nem azuis do navegador (isso faz o app parecer um site): o `a` base herda a
 * cor e não tem sublinhado, e os links de ação do Progresso têm cara de botão (contorno de campo).
 */
describe('links sem cara de site', () => {
  it('o `a` base herda a cor e não é sublinhado', () => {
    const base = ruleDeclarations(readCss('app.css'), 'a');
    expect(base.get('color')).toBe('inherit');
    expect(base.get('text-decoration')).toBe('none');
  });

  it.each(['.progress-empty__action', '.progress-row__link'])(
    '%s tem contorno de campo, sem sublinhado',
    (selector) => {
      const rule = ruleDeclarations(readCss('progress.css'), selector);
      expect(rule.get('border')).toBe('1px solid var(--field-line)');
      expect(rule.get('text-decoration')).toBe('none');
      expect(rule.get('color')).toBe('var(--text)');
    },
  );
});

/**
 * Escala tipográfica e raios só em tokens (tokens.css): nenhuma folha de styles/ escreve um font-size
 * ou um border-radius com valor literal em px ou rem. Não entram na conta 50%, 0 e inherit, que não
 * têm px nem rem. Ficam de fora só o tokens.css, que é onde a escala e os raios são definidos, e no
 * font-size o xterm.css, que é o CSS do próprio terminal e carrega o tamanho dele.
 */
describe('escala tipográfica e raios só em tokens', () => {
  const LITERAL = /(?<![\w.-])(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)\b/;
  const FONT_SIZE_EXCLUDED = ['tokens.css', 'xterm.css'];
  const RADIUS_EXCLUDED = ['tokens.css'];

  /** Os valores literais de `property` em cada folha de styles/, com arquivo e linha de cada um. */
  function literalValues(property: string, excluded: string[]): string[] {
    return readdirSync(stylesDirectory)
      .filter((name) => name.endsWith('.css') && !excluded.includes(name))
      .flatMap((name) => {
        // Os comentários viram espaços, para que a numeração das linhas continue igual à do arquivo.
        const css = readFileSync(join(stylesDirectory, name), 'utf8').replace(
          /\/\*[\s\S]*?\*\//g,
          (comment) => comment.replace(/[^\n]/g, ' '),
        );
        return [...css.matchAll(new RegExp(`(?<![\\w-])${property}\\s*:\\s*([^;{}]+);`, 'g'))]
          .filter(([, value = '']) => LITERAL.test(value))
          .map((match) => {
            const line = css.slice(0, match.index).split('\n').length;
            return `${name}:${line} ${property}: ${match[1]?.trim() ?? ''}`;
          });
      });
  }

  it('nenhum font-size tem valor literal em px ou rem fora de tokens.css e xterm.css', () => {
    expect(
      literalValues('font-size', FONT_SIZE_EXCLUDED),
      'font-size com valor literal: troque pelo token de --text-* (escala em tokens.css)',
    ).toEqual([]);
  });

  it('nenhum border-radius tem valor literal em px ou rem fora de tokens.css', () => {
    expect(
      literalValues('border-radius', RADIUS_EXCLUDED),
      'border-radius com valor literal: troque pelo token de raio (--radius-sm, --radius, --radius-card)',
    ).toEqual([]);
  });
});
