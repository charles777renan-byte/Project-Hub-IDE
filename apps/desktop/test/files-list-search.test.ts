import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesError } from '../src/main/files/files-error';
import { listDirectory, searchContent, searchNames } from '../src/main/files/list-search';

let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'Pasta com espaço e acentuação-'));
  root = join(base, 'raiz');
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Cria os arquivos (com o texto dado) e as pastas que faltam. */
async function seed(files: Record<string, string | Buffer>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, ...relative.split('/'));
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, content);
  }
}

/** Cria muitos arquivos pequenos, em pastas de 100, sem fazer um `writeFile` por vez. */
async function seedMany(prefix: string, count: number, content: string): Promise<void> {
  const folders = Math.ceil(count / 100);
  for (let folder = 0; folder < folders; folder += 1) {
    await mkdir(join(root, prefix, `p${folder}`), { recursive: true });
  }
  const writes: Promise<void>[] = [];
  for (let index = 0; index < count; index += 1) {
    const file = join(root, prefix, `p${Math.floor(index / 100)}`, `f${index}.txt`);
    writes.push(writeFile(file, content));
    if (writes.length === 200) await Promise.all(writes.splice(0));
  }
  await Promise.all(writes);
}

async function expectFilesError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FilesError);
  expect((error as FilesError).code).toBe(code);
}

describe('listDirectory', () => {
  it('põe as pastas antes dos arquivos, cada grupo em ordem alfabética sem diferenciar maiúsculas', async () => {
    await seed({
      'zeta.txt': '',
      'Beta.txt': '',
      'alfa.txt': '',
      'Ótica/a.txt': '',
      'src/a.txt': '',
      'Docs/a.txt': '',
    });
    const entries = await listDirectory(root, '');
    expect(entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'directory:Docs',
      'directory:Ótica',
      'directory:src',
      'file:alfa.txt',
      'file:Beta.txt',
      'file:zeta.txt',
    ]);
  });

  it('devolve o caminho relativo em POSIX e lista uma subpasta com nome com espaço', async () => {
    await seed({ 'pasta com espaço/ação.ts': '', 'pasta com espaço/interna/b.ts': '' });
    const entries = await listDirectory(root, 'pasta com espaço');
    expect(entries).toEqual([
      { name: 'interna', path: 'pasta com espaço/interna', kind: 'directory', ignored: false },
      { name: 'ação.ts', path: 'pasta com espaço/ação.ts', kind: 'file', ignored: false },
    ]);
  });

  it('esconde .git e marca node_modules, out, dist e coverage como ignorados', async () => {
    await seed({
      '.git/HEAD': 'ref',
      'node_modules/x/index.js': '',
      'out/a.js': '',
      'dist/a.js': '',
      'coverage/a.json': '',
      'src/a.ts': '',
      'README.md': '',
    });
    const entries = await listDirectory(root, '');
    expect(entries.map((entry) => entry.name)).toEqual([
      'coverage',
      'dist',
      'node_modules',
      'out',
      'src',
      'README.md',
    ]);
    expect(Object.fromEntries(entries.map((entry) => [entry.name, entry.ignored]))).toEqual({
      coverage: true,
      dist: true,
      node_modules: true,
      out: true,
      src: false,
      'README.md': false,
    });
  });

  it('recusa listar .git e sair da raiz', async () => {
    await seed({ '.git/HEAD': 'ref' });
    await expectFilesError(listDirectory(root, '.git'), 'PATH_OUTSIDE_ALLOWED_SCOPE');
    await expectFilesError(listDirectory(root, '..'), 'PATH_OUTSIDE_ALLOWED_SCOPE');
  });

  it('pasta que não existe vira FILE_NOT_FOUND', async () => {
    await expectFilesError(listDirectory(root, 'nao-existe'), 'FILE_NOT_FOUND');
  });

  it('não mostra o link que sai da raiz nem o que aponta para .git, mas mostra o que fica dentro', async () => {
    const outside = join(base, 'fora');
    await mkdir(outside, { recursive: true });
    await seed({ '.git/HEAD': 'ref', 'src/a.ts': '' });
    await symlink(outside, join(root, 'saida'), 'junction');
    await symlink(join(root, '.git'), join(root, 'atalho-git'), 'junction');
    await symlink(join(root, 'src'), join(root, 'atalho'), 'junction');
    await symlink(join(outside, 'nao-existe'), join(root, 'pendurado'), 'junction');
    const entries = await listDirectory(root, '');
    expect(entries.map((entry) => entry.name)).toEqual(['atalho', 'src']);
    expect(entries[0]).toMatchObject({ path: 'atalho', kind: 'directory' });
  });
});

describe('searchNames', () => {
  it('acha por subsequência sem diferenciar maiúsculas', async () => {
    await seed({
      'src/MissionPage.tsx': '',
      'src/outro.ts': '',
      'README.md': '',
    });
    const result = await searchNames(root, 'mpg');
    expect(result).toEqual({ paths: ['src/MissionPage.tsx'], truncated: false });
    expect((await searchNames(root, 'MISSIONPAGE')).paths).toEqual(['src/MissionPage.tsx']);
  });

  it('põe os caminhos mais curtos primeiro e devolve no máximo 100', async () => {
    await seed({
      'a/b/c/arquivo.ts': '',
      'a/arquivo.ts': '',
      'arquivo.ts': '',
    });
    expect((await searchNames(root, 'arq')).paths).toEqual(['arquivo.ts', 'a/arquivo.ts', 'a/b/c/arquivo.ts']);

    await seedMany('muitos', 150, '');
    const many = await searchNames(root, 'f');
    expect(many.paths).toHaveLength(100);
    expect(many.truncated).toBe(false);
  });

  it('não olha dentro de .git, node_modules, out, dist e coverage, em nenhuma profundidade', async () => {
    await seed({
      '.git/alvo.txt': '',
      'node_modules/alvo.txt': '',
      'out/alvo.txt': '',
      'dist/alvo.txt': '',
      'coverage/alvo.txt': '',
      'pacote/node_modules/alvo.txt': '',
      'pacote/src/alvo.txt': '',
    });
    expect((await searchNames(root, 'alvo')).paths).toEqual(['pacote/src/alvo.txt']);
  });

  it('não segue links simbólicos', async () => {
    const outside = join(base, 'fora');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'segredo.txt'), 'segredo');
    await symlink(outside, join(root, 'saida'), 'junction');
    expect((await searchNames(root, 'segredo')).paths).toEqual([]);
  });

  it('marca truncated só ao passar de 20 000 entradas (arquivos e pastas contam)', async () => {
    // 19 800 arquivos em 198 pastas, mais as 198 pastas e 2 arquivos soltos: 20 000 entradas, o limite.
    await seedMany('', 19_800, '');
    await seed({ 'um.txt': '', 'dois.txt': '' });
    const exact = await searchNames(root, 'f');
    expect(exact.truncated).toBe(false);
    expect(exact.paths).toHaveLength(100);

    // Mais um arquivo vazio: 20 001 entradas.
    await seed({ 'tres.txt': '' });
    expect((await searchNames(root, 'f')).truncated).toBe(true);
  }, 60_000);

  it('para quando o AbortSignal é abortado e devolve o que já tem, sem lançar', async () => {
    await seedMany('', 2_000, '');
    const controller = new AbortController();
    controller.abort();
    const result = await searchNames(root, 'f', { signal: controller.signal });
    expect(result.paths).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});

describe('searchContent', () => {
  it('acha texto com acento e devolve arquivo, linha e trecho', async () => {
    await seed({
      'src/a.ts': 'linha um\nfazer a ação agora\nlinha três',
      'src/b.ts': 'nada aqui',
    });
    const result = await searchContent(root, 'ação', false);
    expect(result).toEqual({
      matches: [{ path: 'src/a.ts', line: 2, text: 'fazer a ação agora' }],
      truncated: false,
    });
  });

  it('numera as linhas certo com CRLF e lê arquivo com BOM', async () => {
    await seed({ 'a.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('um\r\ndois\r\nalvo\r\n')]) });
    const result = await searchContent(root, 'alvo', false);
    expect(result.matches).toEqual([{ path: 'a.txt', line: 3, text: 'alvo' }]);
  });

  it('trata a consulta literal como texto, sem interpretá-la como regex', async () => {
    await seed({ 'a.txt': 'valor (a+b)\nvalor ab' });
    const literal = await searchContent(root, '(a+b)', false);
    expect(literal.matches.map((match) => match.line)).toEqual([1]);
    const regex = await searchContent(root, 'a\\+?b', true);
    expect(regex.matches.map((match) => match.line)).toEqual([1, 2]);
  });

  it('recusa regex inválida com VALIDATION_FAILED', async () => {
    await seed({ 'a.txt': 'x' });
    await expectFilesError(searchContent(root, '(', true), 'VALIDATION_FAILED');
  });

  it('corta o trecho em 200 caracteres', async () => {
    await seed({ 'a.txt': `alvo${'x'.repeat(500)}` });
    const result = await searchContent(root, 'alvo', false);
    expect(result.matches[0]?.text).toHaveLength(200);
    expect(result.matches[0]?.text.startsWith('alvo')).toBe(true);
  });

  it('respeita o limite de 200 resultados e marca truncated só quando há mais', async () => {
    await seed({ 'a.txt': Array.from({ length: 250 }, () => 'alvo').join('\n') });
    const over = await searchContent(root, 'alvo', false);
    expect(over.matches).toHaveLength(200);
    expect(over.truncated).toBe(true);

    await rm(join(root, 'a.txt'));
    await seed({ 'b.txt': Array.from({ length: 200 }, () => 'alvo').join('\n') });
    const exact = await searchContent(root, 'alvo', false);
    expect(exact.matches).toHaveLength(200);
    expect(exact.truncated).toBe(false);
  });

  it('ignora binário, arquivo que não é UTF-8 e arquivo acima de 1 MiB', async () => {
    await seed({
      'binario.bin': Buffer.concat([Buffer.from('alvo'), Buffer.from([0, 1, 2])]),
      'latin1.txt': Buffer.from([0x61, 0x6c, 0x76, 0x6f, 0xe7]),
      'grande.txt': `alvo\n${'x'.repeat(1024 * 1024)}`,
      'limite.txt': `alvo\n${'x'.repeat(1024 * 1024 - 5)}`,
      'ok.txt': 'alvo',
    });
    const result = await searchContent(root, 'alvo', false);
    expect(result.matches.map((match) => match.path).sort()).toEqual(['limite.txt', 'ok.txt']);
  });

  it('ignora .git, node_modules, out, dist e coverage', async () => {
    await seed({
      '.git/config': 'alvo',
      'node_modules/x/index.js': 'alvo',
      'out/a.js': 'alvo',
      'dist/a.js': 'alvo',
      'coverage/a.json': 'alvo',
      'src/a.ts': 'alvo',
    });
    const result = await searchContent(root, 'alvo', false);
    expect(result.matches.map((match) => match.path)).toEqual(['src/a.ts']);
  });

  it('não deixa o laço de eventos parado durante uma busca em 5 000 arquivos', async () => {
    await seedMany('', 5_000, 'conteúdo sem o termo procurado\noutra linha\n');
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 10);
    try {
      const result = await searchContent(root, 'inexistente', false);
      expect(result).toEqual({ matches: [], truncated: false });
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('abortar no meio devolve o parcial sem lançar', async () => {
    // O arquivo da raiz é lido antes das pastas (percurso em largura); as 5 000 seguintes não têm o termo.
    await seed({ 'primeiro.txt': 'alvo' });
    await seedMany('', 5_000, 'sem o termo\n');
    const controller = new AbortController();
    const promise = searchContent(root, 'alvo', false, { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    const result = await promise;
    // Sem o aborto, a busca terminaria com truncated falso.
    expect(result.truncated).toBe(true);
    expect(result.matches).toEqual([{ path: 'primeiro.txt', line: 1, text: 'alvo' }]);
  }, 60_000);

  it('já abortado devolve vazio e truncated', async () => {
    await seed({ 'a.txt': 'alvo' });
    const controller = new AbortController();
    controller.abort();
    expect(await searchContent(root, 'alvo', false, { signal: controller.signal })).toEqual({
      matches: [],
      truncated: true,
    });
  });
});
