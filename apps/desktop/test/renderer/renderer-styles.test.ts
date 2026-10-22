import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
