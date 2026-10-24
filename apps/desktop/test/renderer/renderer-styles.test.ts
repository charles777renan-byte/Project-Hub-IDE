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

  it('liga os estilos por <link rel="stylesheet">, as fontes e os tokens primeiro e o workspace.css depois do app.css', () => {
    const hrefs = [...page.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      './styles/fonts.css',
      './styles/tokens.css',
      './styles/xterm.css',
      './styles/app.css',
      './styles/workspace.css',
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
    for (const name of ['fonts.css', 'tokens.css', 'app.css', 'workspace.css']) {
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
      '0.6875rem',
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

  it('.btn-outline e .btn-link continuam, com a cor da marca', () => {
    expect(rule('.btn-outline').get('color')).toBe('var(--brand)');
    expect(rule('.btn-link').get('color')).toBe('var(--brand)');
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

  it('o anel de foco é 2px --focus com deslocamento de 2px', () => {
    expect(rule(':focus-visible').get('outline')).toBe('2px solid var(--focus)');
    expect(rule(':focus-visible').get('outline-offset')).toBe('2px');
  });

  it('campos têm fundo --surface (sólido; o cartão .form é translúcido), borda --field-line e raio de controle', () => {
    const field = rule('.field input');
    expect(field.get('background')).toBe('var(--surface)');
    expect(field.get('border')).toBe('1px solid var(--field-line)');
    expect(field.get('border-radius')).toBe('var(--radius)');
    expect(rule('.field textarea').get('background')).toBe('var(--surface)');
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
