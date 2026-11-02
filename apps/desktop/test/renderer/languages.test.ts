import { describe, expect, it } from 'vitest';
import { languageOf, loadLanguage } from '../../src/renderer/components/editor/languages';

describe('languageOf', () => {
  it.each([
    ['a.ts', 'typescript'],
    ['src/a.TSX', 'typescript'],
    ['a.mts', 'typescript'],
    ['a.cts', 'typescript'],
    ['a.js', 'javascript'],
    ['a.jsx', 'javascript'],
    ['a.mjs', 'javascript'],
    ['a.cjs', 'javascript'],
    ['package.json', 'json'],
    ['tsconfig.jsonc', 'json'],
    ['app.css', 'css'],
    ['index.html', 'html'],
    ['index.htm', 'html'],
    ['README.md', 'markdown'],
    ['doc.mdx', 'markdown'],
    ['ci.yml', 'yaml'],
    ['ci.yaml', 'yaml'],
  ] as const)('%s é %s', (path, language) => {
    expect(languageOf(path)).toBe(language);
  });

  it('arquivo sem extensão ou de extensão desconhecida é texto simples', () => {
    expect(languageOf('Dockerfile')).toBe('text');
    expect(languageOf('infra/Dockerfile')).toBe('text');
    expect(languageOf('a.txt')).toBe('text');
    expect(languageOf('.gitignore')).toBe('text');
  });

  it('só olha a extensão do último trecho do caminho', () => {
    expect(languageOf('pasta.ts/LICENSE')).toBe('text');
    expect(languageOf('pasta.md/notas.json')).toBe('json');
  });
});

describe('loadLanguage', () => {
  it('texto simples não carrega realce', async () => {
    expect(await loadLanguage('text')).toBeNull();
  });

  it.each(['typescript', 'javascript', 'json', 'css', 'html', 'markdown', 'yaml'] as const)(
    '%s carrega uma extensão',
    async (id) => {
      expect(await loadLanguage(id)).not.toBeNull();
    },
  );
});
