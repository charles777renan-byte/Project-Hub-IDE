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

  it('liga os estilos por <link rel="stylesheet">, os tokens primeiro', () => {
    const hrefs = [...page.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(['./styles/tokens.css', './styles/app.css']);
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
