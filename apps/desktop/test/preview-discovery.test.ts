import { describe, expect, it } from 'vitest';
import { commandFor, discover, shownBody } from '../src/main/preview/discovery';

const files = (...names: string[]) => new Set(names);
const pkg = (value: unknown) => JSON.stringify(value);

describe('discover', () => {
  it.each([
    ['ausente', null],
    ['inválido', '{ "scripts": '],
    ['que não é objeto', '[1, 2]'],
    ['nulo', 'null'],
    ['sem scripts', pkg({ name: 'x' })],
    ['com scripts em lista', pkg({ scripts: ['dev'] })],
    ['com scripts nulos', pkg({ scripts: null })],
  ])('package.json %s não oferece script', (_label, packageJson) => {
    const found = discover({ packageJson, rootFiles: files() });
    expect(found.scripts).toEqual([]);
    expect(found.suggested).toBeNull();
    expect(found.packageManager).toBe('npm');
  });

  it('sugere dev, depois start, depois serve', () => {
    const all = { build: 'x', serve: 'sv', start: 's', dev: 'vite' };
    expect(discover({ packageJson: pkg({ scripts: all }), rootFiles: files() }).suggested).toBe(
      'dev',
    );
    const noDev = { build: 'x', serve: 'sv', start: 's' };
    expect(discover({ packageJson: pkg({ scripts: noDev }), rootFiles: files() }).suggested).toBe(
      'start',
    );
    const onlyServe = { build: 'x', serve: 'sv' };
    expect(
      discover({ packageJson: pkg({ scripts: onlyServe }), rootFiles: files() }).suggested,
    ).toBe('serve');
  });

  it('sem dev, start nem serve não há sugestão, mas os válidos são oferecidos', () => {
    const found = discover({
      packageJson: pkg({ scripts: { build: 'tsc', test: 'vitest' } }),
      rootFiles: files(),
    });
    expect(found.suggested).toBeNull();
    expect(found.scripts).toEqual([
      { name: 'build', body: 'tsc' },
      { name: 'test', body: 'vitest' },
    ]);
  });

  it('nome hostil, valor que não é texto e texto vazio ficam de fora', () => {
    const scripts = {
      'dev; calc': 'x',
      'a b': 'x',
      '$(x)': 'x',
      '-dev': 'x',
      ['n'.repeat(200)]: 'x',
      numero: 7,
      objeto: { a: 1 },
      vazio: '',
      espacos: '   ',
      ok: 'node server.js',
    };
    const found = discover({ packageJson: pkg({ scripts }), rootFiles: files() });
    expect(found.scripts).toEqual([{ name: 'ok', body: 'node server.js' }]);
  });

  it('se o único dev é inválido, não há sugestão', () => {
    const found = discover({
      packageJson: pkg({ scripts: { dev: 7, 'dev; calc': 'vite' } }),
      rootFiles: files(),
    });
    expect(found.suggested).toBeNull();
    expect(found.scripts).toEqual([]);
  });

  it('o texto do script vem inteiro', () => {
    const body = 'x'.repeat(500);
    const found = discover({ packageJson: pkg({ scripts: { dev: body } }), rootFiles: files() });
    expect(found.scripts[0]?.body).toBe(body);
  });

  it.each([
    [['pnpm-lock.yaml'], 'pnpm'],
    [['yarn.lock'], 'yarn'],
    [['bun.lockb'], 'bun'],
    [['bun.lock'], 'bun'],
    [['package-lock.json'], 'npm'],
    [[], 'npm'],
    [['yarn.lock', 'pnpm-lock.yaml', 'package-lock.json'], 'pnpm'],
    [['package-lock.json', 'yarn.lock'], 'yarn'],
  ] as const)('lockfiles %j dão o gerenciador %s', (names, expected) => {
    const found = discover({ packageJson: pkg({ scripts: {} }), rootFiles: files(...names) });
    expect(found.packageManager).toBe(expected);
  });

  it('o campo packageManager vence o lockfile, e um desconhecido é ignorado', () => {
    const withField = pkg({ packageManager: 'pnpm@9.1.0', scripts: {} });
    expect(discover({ packageJson: withField, rootFiles: files('yarn.lock') }).packageManager).toBe(
      'pnpm',
    );
    const unknown = pkg({ packageManager: 'coisa@1', scripts: {} });
    expect(discover({ packageJson: unknown, rootFiles: files('yarn.lock') }).packageManager).toBe(
      'yarn',
    );
    const notText = pkg({ packageManager: 7, scripts: {} });
    expect(discover({ packageJson: notText, rootFiles: files() }).packageManager).toBe('npm');
    // Só o nome antes de `@` conta: `pnpmx@1` não é o pnpm.
    const lookalike = pkg({ packageManager: 'pnpmx@1', scripts: {} });
    expect(discover({ packageJson: lookalike, rootFiles: files() }).packageManager).toBe('npm');
  });

  it('diz se há index.html na raiz', () => {
    expect(discover({ packageJson: null, rootFiles: files('index.html') }).hasIndexHtml).toBe(true);
    expect(discover({ packageJson: null, rootFiles: files('Index.htm') }).hasIndexHtml).toBe(false);
  });
});

describe('commandFor', () => {
  it('monta <gerenciador> run <script>', () => {
    expect(commandFor('pnpm', 'dev')).toBe('pnpm run dev');
    expect(commandFor('npm', 'dev:web')).toBe('npm run dev:web');
  });

  it.each(['dev; calc', 'a b', '', '$(x)', 'dev\n'])('recusa o nome %j', (script) => {
    expect(() => commandFor('npm', script)).toThrow();
  });

  it('recusa gerenciador desconhecido', () => {
    expect(() => commandFor('cargo' as never, 'dev')).toThrow();
  });
});

describe('shownBody', () => {
  it('deixa o texto curto como está', () => {
    expect(shownBody('vite')).toBe('vite');
    expect(shownBody('x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('corta em 200 caracteres, com reticências no fim', () => {
    const cut = shownBody('x'.repeat(250));
    expect(cut).toHaveLength(200);
    expect(cut.endsWith('…')).toBe(true);
  });
});
