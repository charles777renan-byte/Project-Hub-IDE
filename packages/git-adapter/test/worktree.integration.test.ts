import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { branchExists, createTempRepo, revParse, type TempRepo } from '@project-hub/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStatus } from '../src/status';
import { createWorktree, removeWorktree } from '../src/worktree';
import { buildWorktreeNames } from '../src/worktree-naming';

// Git real: cada teste cria um repositório e uma raiz de worktrees na pasta temporária do sistema,
// fora do projeto, e apaga os dois no fim. Nenhum teste toca no repositório do Project Hub.

// `getStatus` segue real, mas um teste pode trocar a resposta de uma chamada para provar a segunda
// guarda da remoção: o `git worktree remove` sem --force.
vi.mock('../src/status', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/status')>();
  return { ...original, getStatus: vi.fn(original.getStatus) };
});

const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
const names = buildWorktreeNames({
  missionId: 'abcdef123456',
  title: 'Corrigir login',
  projectSlug: 'app',
});
const repos: TempRepo[] = [];
const folders: string[] = [];

function repo(): TempRepo {
  const made = createTempRepo();
  repos.push(made);
  return made;
}

/** Pasta nova na pasta temporária do sistema, apagada no `afterEach`. */
function newFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
}

/** Raiz de worktrees descartável. Fica fora do projeto e do repositório do teste. */
function worktreesRoot(): string {
  return newFolder('project-hub-worktrees-');
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Pastas que o Git registra como worktree do repositório, o checkout principal inclusive. */
function registeredWorktrees(repoPath: string): string[] {
  return git(repoPath, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length)));
}

/** Diz se `inner` está dentro de `outer` (ou é ele mesmo). */
function isInside(outer: string, inner: string): boolean {
  const path = relative(outer, inner);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function commit(repoPath: string, file: string): void {
  writeFileSync(join(repoPath, file), `conteudo de ${file}\n`);
  git(repoPath, 'add', file);
  git(repoPath, 'commit', '--no-verify', '-m', `adiciona ${file}`);
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
  for (const made of repos.splice(0)) made.cleanup();
});

describe('a raiz de worktrees dos testes', () => {
  it('fica na pasta temporária do sistema, fora do projeto', () => {
    const root = worktreesRoot();

    expect(isInside(realpathSync.native(tmpdir()), realpathSync.native(root))).toBe(true);
    expect(isInside(projectRoot, root)).toBe(false);
  });
});

describe('createWorktree', () => {
  it('cria pasta e branch e registra o commit base', async () => {
    const { path: repoPath } = repo();
    const root = worktreesRoot();

    const wt = await createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' });

    expect(wt.path).toBe(join(root, 'app', 'abcdef12-corrigir-login'));
    expect(existsSync(wt.path)).toBe(true);
    expect(wt.branch).toBe('ph/abcdef12-corrigir-login');
    expect(wt.baseCommit).toBe(revParse(repoPath, 'HEAD'));
    expect(branchExists(repoPath, names.branch)).toBe(true);
    // O worktree está nessa branch, nesse commit, com os arquivos da base.
    expect(git(wt.path, 'branch', '--show-current')).toBe(names.branch);
    expect(git(wt.path, 'rev-parse', 'HEAD')).toBe(wt.baseCommit);
    expect(readFileSync(join(wt.path, 'a.txt'), 'utf8')).toContain('conteudo inicial');
    expect(git(wt.path, 'status', '--porcelain')).toBe('');
    expect(registeredWorktrees(repoPath)).toHaveLength(2);
  });

  it('não mexe no checkout principal', async () => {
    const { path: repoPath } = repo();
    const before = revParse(repoPath, 'HEAD');

    await createWorktree({
      repoPath,
      worktreesRoot: worktreesRoot(),
      names,
      baseRef: 'HEAD',
    });

    expect(git(repoPath, 'branch', '--show-current')).toBe('main');
    expect(revParse(repoPath, 'HEAD')).toBe(before);
    expect(git(repoPath, 'status', '--porcelain')).toBe('');
  });

  it('parte do commit pedido, e não do HEAD', async () => {
    const { path: repoPath } = repo();
    const first = revParse(repoPath, 'HEAD');
    commit(repoPath, 'b.txt');
    expect(revParse(repoPath, 'HEAD')).not.toBe(first);

    const wt = await createWorktree({
      repoPath,
      worktreesRoot: worktreesRoot(),
      names,
      baseRef: 'HEAD~1',
    });

    expect(wt.baseCommit).toBe(first);
    expect(git(wt.path, 'rev-parse', 'HEAD')).toBe(first);
    expect(existsSync(join(wt.path, 'b.txt'))).toBe(false);
  });

  it.each(['main', 'refs/heads/main', 'v1', 'HEAD^{commit}'])(
    'aceita a base %s e registra o commit inteiro',
    async (baseRef) => {
      const { path: repoPath } = repo();
      git(repoPath, 'tag', 'v1');

      const wt = await createWorktree({
        repoPath,
        worktreesRoot: worktreesRoot(),
        names,
        baseRef,
      });

      expect(wt.baseCommit).toBe(revParse(repoPath, 'HEAD'));
      expect(wt.baseCommit).toMatch(/^[0-9a-f]{40,64}$/);
    },
  );

  it('cria também numa raiz com espaço e acento no caminho', async () => {
    const { path: repoPath } = repo();
    const root = newFolder('project hub ação worktrees-');

    const wt = await createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' });

    expect(existsSync(join(wt.path, 'a.txt'))).toBe(true);
    expect(wt.path.startsWith(root)).toBe(true);
  });

  it('segunda criação com os mesmos nomes falha com WORKTREE_COLLISION sem tocar na primeira', async () => {
    const { path: repoPath } = repo();
    const root = worktreesRoot();
    const input = { repoPath, worktreesRoot: root, names, baseRef: 'HEAD' };
    const first = await createWorktree(input);
    writeFileSync(join(first.path, 'meu-trabalho.txt'), 'não perder');
    const tip = revParse(repoPath, names.branch);

    await expect(createWorktree(input)).rejects.toMatchObject({
      name: 'GitError',
      code: 'WORKTREE_COLLISION',
    });

    expect(readFileSync(join(first.path, 'meu-trabalho.txt'), 'utf8')).toBe('não perder');
    expect(git(first.path, 'branch', '--show-current')).toBe(names.branch);
    expect(revParse(repoPath, names.branch)).toBe(tip);
    expect(registeredWorktrees(repoPath)).toHaveLength(2);
  });

  it('branch que já existe é colisão, mesmo com a pasta livre, e nenhuma pasta é criada', async () => {
    const { path: repoPath } = repo();
    const root = worktreesRoot();
    git(repoPath, 'branch', names.branch);

    await expect(
      createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' }),
    ).rejects.toMatchObject({ code: 'WORKTREE_COLLISION' });

    expect(readdirSync(root)).toEqual([]);
    expect(registeredWorktrees(repoPath)).toHaveLength(1);
  });

  it('a mesma branch em outra pasta também é colisão', async () => {
    const { path: repoPath } = repo();
    const root = worktreesRoot();
    await createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' });

    await expect(
      createWorktree({
        repoPath,
        worktreesRoot: root,
        names: { ...names, relativeDir: 'app/outra-pasta' },
        baseRef: 'HEAD',
      }),
    ).rejects.toMatchObject({ code: 'WORKTREE_COLLISION' });

    expect(existsSync(join(root, 'app', 'outra-pasta'))).toBe(false);
  });

  it.each([
    [
      'uma pasta com conteúdo',
      (target: string) => {
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, 'meu.txt'), 'x');
        return join(target, 'meu.txt');
      },
    ],
    [
      'um arquivo',
      (target: string) => {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, 'x');
        return target;
      },
    ],
  ])('o caminho já ocupado por %s é colisão, sem criar a branch', async (_case, occupy) => {
    const { path: repoPath } = repo();
    const root = worktreesRoot();
    const occupied = occupy(join(root, 'app', 'abcdef12-corrigir-login'));

    await expect(
      createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' }),
    ).rejects.toMatchObject({ code: 'WORKTREE_COLLISION' });

    expect(readFileSync(occupied, 'utf8')).toBe('x');
    expect(branchExists(repoPath, names.branch)).toBe(false);
    expect(registeredWorktrees(repoPath)).toHaveLength(1);
  });

  it('base inválida não deixa pasta nem branch para trás', async () => {
    const { path: repoPath } = repo();
    const root = worktreesRoot();
    const expectedPath = join(root, 'app', 'abcdef12-corrigir-login');

    await expect(
      createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'nao-existe' }),
    ).rejects.toMatchObject({ name: 'GitError', code: 'WORKTREE_CREATE_FAILED' });

    expect(existsSync(expectedPath)).toBe(false);
    expect(branchExists(repoPath, names.branch)).toBe(false);
    // Nem a pasta do projeto ficou na raiz.
    expect(readdirSync(root)).toEqual([]);
    expect(registeredWorktrees(repoPath)).toHaveLength(1);
  });

  it('falha do próprio Git na criação vira WORKTREE_CREATE_FAILED e não deixa nada para trás', async () => {
    const { path: repoPath } = repo();
    const root = worktreesRoot();
    // Nome de branch que o Git recusa ao criar, depois de a base e a colisão já terem passado.
    const invalid = { ...names, branch: 'ph/a..b' };

    await expect(
      createWorktree({ repoPath, worktreesRoot: root, names: invalid, baseRef: 'HEAD' }),
    ).rejects.toMatchObject({ name: 'GitError', code: 'WORKTREE_CREATE_FAILED' });

    expect(readdirSync(root)).toEqual([]);
    expect(registeredWorktrees(repoPath)).toHaveLength(1);
    expect(git(repoPath, 'branch', '--list')).toBe('* main');
  });

  it('pasta que não é repositório rejeita sem criar nada', async () => {
    const root = worktreesRoot();
    const notARepo = newFolder('project-hub-sem-git-');

    await expect(
      createWorktree({ repoPath: notARepo, worktreesRoot: root, names, baseRef: 'HEAD' }),
    ).rejects.toMatchObject({ name: 'GitError', code: 'WORKTREE_CREATE_FAILED' });

    expect(readdirSync(root)).toEqual([]);
  });

  // O checkout do `worktree add` roda o hook `post-checkout` do repositório, que num repositório de
  // terceiros é código alheio (seção 17.1). O controle prova que, sem o `-c core.hooksPath` do
  // adaptador, o Git roda o hook: sem ele o teste passaria mesmo se o hook nunca rodasse.
  describe('não roda o hook post-checkout do repositório', () => {
    /** Hook que grava um marcador quando roda. O caminho vai com `/`, que o `sh` do Git entende. */
    function installPostCheckout(hooksFolder: string, marker: string): void {
      mkdirSync(hooksFolder, { recursive: true });
      const script = join(hooksFolder, 'post-checkout');
      writeFileSync(script, `#!/bin/sh\necho rodou > "${marker.replaceAll('\\', '/')}"\n`);
      chmodSync(script, 0o755);
    }

    it.each([
      ['na pasta de hooks do repositório', (repoPath: string) => join(repoPath, '.git', 'hooks')],
      [
        'numa pasta indicada por core.hooksPath na configuração do repositório',
        (repoPath: string) => {
          const folder = newFolder('project-hub-hooks-');
          git(repoPath, 'config', 'core.hooksPath', folder.replaceAll('\\', '/'));
          return folder;
        },
      ],
    ])('hook %s', async (_case, hooksFolderOf) => {
      const { path: repoPath } = repo();
      const root = worktreesRoot();
      const marker = join(newFolder('project-hub-marcador-'), 'marcador.txt');
      installPostCheckout(hooksFolderOf(repoPath), marker);

      // Controle: um `worktree add` comum, sem o flag, roda o hook e grava o marcador.
      git(repoPath, 'worktree', 'add', '-b', 'controle', join(root, 'controle'), 'HEAD');
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);

      const wt = await createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' });

      expect(existsSync(wt.path)).toBe(true);
      expect(existsSync(join(wt.path, 'a.txt'))).toBe(true);
      expect(existsSync(marker)).toBe(false);
    });

    it('não deixa a pasta de hooks vazia para trás na pasta temporária', async () => {
      const { path: repoPath } = repo();
      const before = readdirSync(tmpdir()).filter((name) =>
        name.startsWith('project-hub-sem-hooks-'),
      );

      await createWorktree({ repoPath, worktreesRoot: worktreesRoot(), names, baseRef: 'HEAD' });

      const after = readdirSync(tmpdir()).filter((name) =>
        name.startsWith('project-hub-sem-hooks-'),
      );
      expect(after).toEqual(before);
    });
  });

  describe('recusa uma pasta que escapa da raiz, antes de chamar o Git', () => {
    // A pasta de fora é irmã da raiz e começa com o nome dela: uma checagem de prefixo, em vez de
    // `relative`, deixaria passar.
    it.each([
      [
        'relativa, subindo até a pasta de fora',
        (outside: string) => join('..', basename(outside), 'wt'),
      ],
      [
        'relativa, subindo no meio do caminho',
        (outside: string) => `app/../../${basename(outside)}/wt`,
      ],
      ['absoluta', (outside: string) => join(outside, 'wt')],
    ])('%s', async (_case, build) => {
      const { path: repoPath } = repo();
      const root = worktreesRoot();
      const outside = newFolder(`${basename(root)}-evil`);
      const relativeDir = build(outside);
      // O teste só vale se a pasta montada de fato cai fora da raiz, na pasta de fora.
      expect(resolve(root, relativeDir)).toBe(join(outside, 'wt'));
      expect(isInside(root, resolve(root, relativeDir))).toBe(false);

      await expect(
        createWorktree({
          repoPath,
          worktreesRoot: root,
          names: { ...names, relativeDir },
          baseRef: 'HEAD',
        }),
      ).rejects.toMatchObject({ name: 'GitError', code: 'PATH_OUTSIDE_ALLOWED_SCOPE' });

      expect(readdirSync(outside)).toEqual([]);
      expect(readdirSync(root)).toEqual([]);
      expect(branchExists(repoPath, names.branch)).toBe(false);
      expect(registeredWorktrees(repoPath)).toHaveLength(1);
    });
  });
});

/** Diz se este computador deixa criar link simbólico (o Windows sem Modo de Desenvolvedor recusa com EPERM). */
function canCreateSymlink(): boolean {
  const folder = mkdtempSync(join(tmpdir(), 'project-hub-link-'));
  try {
    writeFileSync(join(folder, 'alvo.txt'), 'x');
    symlinkSync(join(folder, 'alvo.txt'), join(folder, 'link.txt'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
const symlinkSupported = canCreateSymlink();

// O `.worktreeinclude` lista o que o Git ignora e o `worktree add` não traz (`.env`, `.vscode`). Cada
// teste monta um repositório com `.gitignore` versionado, para o Git de verdade decidir o que é ignorado.
describe('createWorktree: .worktreeinclude', () => {
  /** Repositório com `.gitignore` versionado e o `.worktreeinclude` (que fica sem versionar) com `include`. */
  function setUpRepo(gitignore: string, include?: string): string {
    const { path: repoPath } = repo();
    writeFileSync(join(repoPath, '.gitignore'), gitignore);
    git(repoPath, 'add', '.gitignore');
    git(repoPath, 'commit', '--no-verify', '-m', 'adiciona .gitignore');
    if (include !== undefined) writeFileSync(join(repoPath, '.worktreeinclude'), include);
    return repoPath;
  }

  function create(repoPath: string): ReturnType<typeof createWorktree> {
    return createWorktree({ repoPath, worktreesRoot: worktreesRoot(), names, baseRef: 'HEAD' });
  }

  it('copia para o worktree novo o .env e a pasta .vscode listados e ignorados', async () => {
    const repoPath = setUpRepo('.env\n.vscode/\n', '.env\n.vscode\n');
    writeFileSync(join(repoPath, '.env'), 'SEGREDO=1\n');
    mkdirSync(join(repoPath, '.vscode'));
    writeFileSync(join(repoPath, '.vscode', 'settings.json'), '{"a":1}\n');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual(['.env', '.vscode']);
    expect(wt.included.skipped).toEqual([]);
    expect(wt.included.warning).toBeUndefined();
    expect(readFileSync(join(wt.path, '.env'), 'utf8')).toBe('SEGREDO=1\n');
    expect(readFileSync(join(wt.path, '.vscode', 'settings.json'), 'utf8')).toBe('{"a":1}\n');
    // A cópia não cria diferença: o que veio é ignorado, e o status continua limpo.
    expect(git(wt.path, 'status', '--porcelain')).toBe('');
    // O original continua onde estava.
    expect(readFileSync(join(repoPath, '.env'), 'utf8')).toBe('SEGREDO=1\n');
  });

  // Sem `-z`, o Git cita o nome com acento (`"configura\303\247\303\243o.env"`): a leitura tem de desfazer a citação.
  it('copia um arquivo ignorado cujo nome tem acento e espaço', async () => {
    const repoPath = setUpRepo(
      'configuração.env\ncom espaço.env\n',
      'configuração.env\ncom espaço.env\n',
    );
    writeFileSync(join(repoPath, 'configuração.env'), 'acento\n');
    writeFileSync(join(repoPath, 'com espaço.env'), 'espaço\n');

    const wt = await create(repoPath);

    expect(wt.included.skipped).toEqual([]);
    expect(wt.included.copied).toEqual(['configuração.env', 'com espaço.env']);
    expect(readFileSync(join(wt.path, 'configuração.env'), 'utf8')).toBe('acento\n');
    expect(readFileSync(join(wt.path, 'com espaço.env'), 'utf8')).toBe('espaço\n');
  });

  it('copia um arquivo dentro de uma pasta ignorada, criando a pasta no destino', async () => {
    const repoPath = setUpRepo('config/\n', 'config/local.json\n');
    mkdirSync(join(repoPath, 'config'));
    writeFileSync(join(repoPath, 'config', 'local.json'), '{}\n');
    writeFileSync(join(repoPath, 'config', 'outro.json'), '{}\n');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual(['config/local.json']);
    expect(readFileSync(join(wt.path, 'config', 'local.json'), 'utf8')).toBe('{}\n');
    expect(existsSync(join(wt.path, 'config', 'outro.json'))).toBe(false);
  });

  it('não copia arquivo versionado nem arquivo que o Git não ignora', async () => {
    const repoPath = setUpRepo('.env\n', 'README.md\nsolto.txt\n');
    commit(repoPath, 'README.md');
    writeFileSync(join(repoPath, 'solto.txt'), 'solto');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual([]);
    expect(wt.included.skipped).toEqual(
      expect.arrayContaining([
        { path: 'README.md', reason: 'nao-ignorado' },
        { path: 'solto.txt', reason: 'nao-ignorado' },
      ]),
    );
    expect(wt.included.skipped).toHaveLength(2);
    // O arquivo não ignorado ficaria como "novo" no worktree: não foi levado.
    expect(existsSync(join(wt.path, 'solto.txt'))).toBe(false);
    expect(git(wt.path, 'status', '--porcelain')).toBe('');
  });

  it('lista caminho inseguro e inexistente em skipped e cria o worktree mesmo assim', async () => {
    const repoPath = setUpRepo('.env\n', '../fora\n.git/config\nnao-existe.env\n');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual([]);
    expect(wt.included.skipped).toEqual([
      { path: '../fora', reason: 'caminho-inseguro' },
      { path: '.git/config', reason: 'caminho-inseguro' },
      { path: 'nao-existe.env', reason: 'inexistente' },
    ]);
    expect(existsSync(wt.path)).toBe(true);
    expect(git(wt.path, 'branch', '--show-current')).toBe(names.branch);
  });

  it('lista os padrões com curinga como não suportados, sem copiar nada', async () => {
    const repoPath = setUpRepo('.env\n.env.local\n', '.env*\n');
    writeFileSync(join(repoPath, '.env'), 'x');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual([]);
    expect(wt.included.skipped).toEqual([{ path: '.env*', reason: 'padrao-nao-suportado' }]);
    expect(existsSync(join(wt.path, '.env'))).toBe(false);
  });

  it.skipIf(!symlinkSupported)('não segue link simbólico', async () => {
    const outside = newFolder('project-hub-fora-');
    writeFileSync(join(outside, 'segredo.txt'), 'de fora');
    const repoPath = setUpRepo('.env-link\n', '.env-link\n');
    symlinkSync(join(outside, 'segredo.txt'), join(repoPath, '.env-link'), 'file');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual([]);
    expect(wt.included.skipped).toEqual([{ path: '.env-link', reason: 'link-simbolico' }]);
    expect(existsSync(join(wt.path, '.env-link'))).toBe(false);
  });

  // `junction` é a ligação de pasta do Windows, que não pede privilégio; no resto dos sistemas é um link comum.
  it('não segue um link simbólico no meio do caminho', async () => {
    const outside = newFolder('project-hub-fora-');
    writeFileSync(join(outside, 'segredo.env'), 'de fora');
    const repoPath = setUpRepo('desvio/\nsegredo.env\n', 'desvio/segredo.env\n');
    symlinkSync(outside, join(repoPath, 'desvio'), 'junction');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual([]);
    expect(wt.included.skipped).toEqual([{ path: 'desvio/segredo.env', reason: 'link-simbolico' }]);
    expect(existsSync(join(wt.path, 'desvio'))).toBe(false);
  });

  it('deixa para trás o link simbólico que está dentro de uma pasta copiada', async () => {
    const outside = newFolder('project-hub-fora-');
    const repoPath = setUpRepo('dados/\n', 'dados\n');
    mkdirSync(join(repoPath, 'dados'));
    writeFileSync(join(repoPath, 'dados', 'real.txt'), 'real');
    symlinkSync(outside, join(repoPath, 'dados', 'desvio'), 'junction');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual(['dados']);
    expect(readFileSync(join(wt.path, 'dados', 'real.txt'), 'utf8')).toBe('real');
    expect(existsSync(join(wt.path, 'dados', 'desvio'))).toBe(false);
  });

  // O arquivo era versionado numa base mais antiga e hoje é ignorado no checkout principal: o worktree
  // parte da base antiga, já traz o arquivo, e a cópia não o sobrescreve.
  it('não sobrescreve o que já existe no worktree', async () => {
    const repoPath = setUpRepo('.env\n', '.env\n');
    writeFileSync(join(repoPath, '.env'), 'versao do commit antigo');
    git(repoPath, 'add', '--force', '.env');
    git(repoPath, 'commit', '--no-verify', '-m', 'versiona .env');
    git(repoPath, 'rm', '--cached', '.env');
    git(repoPath, 'commit', '--no-verify', '-m', 'deixa de versionar .env');
    writeFileSync(join(repoPath, '.env'), 'versao local');

    const wt = await createWorktree({
      repoPath,
      worktreesRoot: worktreesRoot(),
      names,
      baseRef: 'HEAD~1',
    });

    expect(wt.included.copied).toEqual([]);
    expect(wt.included.skipped).toEqual([{ path: '.env', reason: 'ja-existe' }]);
    expect(readFileSync(join(wt.path, '.env'), 'utf8')).toBe('versao do commit antigo');
  });

  // `config/local.json` aparece antes da pasta que o contém. A pasta é copiada primeiro, inteira, e a
  // entrada de dentro já está coberta: não é copiada de novo, nem listada, nem vira `ja-existe`.
  it('entradas que se sobrepõem: a pasta vem inteira e a entrada de dentro não é listada', async () => {
    const repoPath = setUpRepo('config/\n', 'config/local.json\nconfig\n');
    mkdirSync(join(repoPath, 'config'));
    writeFileSync(join(repoPath, 'config', 'local.json'), 'local');
    writeFileSync(join(repoPath, 'config', 'other.json'), 'outro');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual(['config']);
    expect(wt.included.skipped).toEqual([]);
    expect(wt.included.warning).toBeUndefined();
    expect(readFileSync(join(wt.path, 'config', 'local.json'), 'utf8')).toBe('local');
    expect(readFileSync(join(wt.path, 'config', 'other.json'), 'utf8')).toBe('outro');
  });

  it('duas entradas na mesma pasta ignorada são copiadas, sem ja-existe da pasta criada pela primeira', async () => {
    const repoPath = setUpRepo('config/\n', 'config/a.json\nconfig/b.json\n');
    mkdirSync(join(repoPath, 'config'));
    writeFileSync(join(repoPath, 'config', 'a.json'), 'a');
    writeFileSync(join(repoPath, 'config', 'b.json'), 'b');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual(['config/a.json', 'config/b.json']);
    expect(wt.included.skipped).toEqual([]);
  });

  it.skipIf(!symlinkSupported)(
    'um .worktreeinclude que é link simbólico não é lista, e não gera aviso',
    async () => {
      const outside = newFolder('project-hub-fora-');
      writeFileSync(join(outside, 'lista.txt'), '.env\n');
      const repoPath = setUpRepo('.env\n');
      writeFileSync(join(repoPath, '.env'), 'x');
      symlinkSync(join(outside, 'lista.txt'), join(repoPath, '.worktreeinclude'), 'file');

      const wt = await create(repoPath);

      expect(wt.included).toEqual({ copied: [], skipped: [] });
      expect(existsSync(join(wt.path, '.env'))).toBe(false);
    },
  );

  it('sem .worktreeinclude, included vem vazio e sem aviso', async () => {
    const repoPath = setUpRepo('.env\n');
    writeFileSync(join(repoPath, '.env'), 'x');

    const wt = await create(repoPath);

    expect(wt.included).toEqual({ copied: [], skipped: [] });
    expect(existsSync(join(wt.path, '.env'))).toBe(false);
  });

  it('.worktreeinclude maior que 256 KiB é ignorado com aviso', async () => {
    const repoPath = setUpRepo('.env\n', `.env\n${'#'.repeat(256 * 1024)}`);
    writeFileSync(join(repoPath, '.env'), 'x');

    const wt = await create(repoPath);

    expect(wt.included.copied).toEqual([]);
    expect(wt.included.skipped).toEqual([]);
    expect(wt.included.warning).toBe('O .worktreeinclude passa de 256 KiB e foi ignorado.');
    expect(existsSync(wt.path)).toBe(true);
    expect(existsSync(join(wt.path, '.env'))).toBe(false);
  });

  it('uma pasta com o nome .worktreeinclude não é lista, e não gera aviso', async () => {
    const repoPath = setUpRepo('.env\n');
    mkdirSync(join(repoPath, '.worktreeinclude'));

    const wt = await create(repoPath);

    expect(wt.included).toEqual({ copied: [], skipped: [] });
  });

  // 120 caminhos de ~80 caracteres passam dos 8000 de um lote do `check-ignore`: a consulta vai em mais
  // de uma chamada, e todos os ignorados têm de voltar.
  it('consulta o Git em mais de um lote quando a lista é grande', async () => {
    const files = Array.from(
      { length: 120 },
      (_, index) => `ignorados/arquivo-com-um-nome-bem-comprido-para-encher-o-lote-${index}.txt`,
    );
    const repoPath = setUpRepo('ignorados/\n', `${files.join('\n')}\n`);
    mkdirSync(join(repoPath, 'ignorados'));
    for (const file of files) writeFileSync(join(repoPath, file), file);
    expect(files.join(' ').length).toBeGreaterThan(8000);

    const wt = await create(repoPath);

    expect(wt.included.skipped).toEqual([]);
    expect(wt.included.copied).toEqual(files);
    expect(readFileSync(join(wt.path, files[119] as string), 'utf8')).toBe(files[119]);
  });
});

describe('removeWorktree', () => {
  async function setUp(): Promise<{
    repoPath: string;
    root: string;
    wt: { path: string; branch: string; baseCommit: string };
  }> {
    const { path: repoPath } = repo();
    const root = worktreesRoot();
    const wt = await createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' });
    return { repoPath, root, wt };
  }

  it.each([
    [
      'arquivo versionado modificado',
      (path: string) => writeFileSync(join(path, 'a.txt'), 'mudou'),
    ],
    [
      'arquivo novo, ainda sem versionar',
      (path: string) => writeFileSync(join(path, 'novo.txt'), 'x'),
    ],
    [
      'alteração já na área de preparo',
      (path: string) => {
        writeFileSync(join(path, 'a.txt'), 'preparado');
        git(path, 'add', 'a.txt');
      },
    ],
    ['arquivo versionado apagado', (path: string) => rmSync(join(path, 'a.txt'))],
  ])('worktree com %s não é removido', async (_case, makeDirty) => {
    const { repoPath, wt } = await setUp();
    makeDirty(wt.path);

    await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
      name: 'GitError',
      code: 'WORKTREE_HAS_UNSAVED_CHANGES',
    });

    expect(existsSync(wt.path)).toBe(true);
    // A alteração continua lá: nada foi desfeito.
    expect(git(wt.path, 'status', '--porcelain')).not.toBe('');
    expect(branchExists(repoPath, names.branch)).toBe(true);
    expect(registeredWorktrees(repoPath)).toHaveLength(2);
  });

  it('worktree com alteração não salva não é removido', async () => {
    const { repoPath, wt } = await setUp();
    writeFileSync(join(wt.path, 'a.txt'), 'trabalho que não pode se perder');

    await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
      code: 'WORKTREE_HAS_UNSAVED_CHANGES',
    });

    expect(existsSync(wt.path)).toBe(true);
    expect(readFileSync(join(wt.path, 'a.txt'), 'utf8')).toBe('trabalho que não pode se perder');
  });

  it('worktree limpo é removido e a branch continua existindo', async () => {
    const { repoPath, wt } = await setUp();

    await expect(removeWorktree({ repoPath, worktreePath: wt.path })).resolves.toBeUndefined();

    expect(existsSync(wt.path)).toBe(false);
    expect(registeredWorktrees(repoPath)).toHaveLength(1);
    expect(branchExists(repoPath, names.branch)).toBe(true);
    expect(revParse(repoPath, names.branch)).toBe(wt.baseCommit);
  });

  it('depois da remoção os mesmos nomes colidem, porque a branch fica', async () => {
    const { repoPath, root, wt } = await setUp();
    await removeWorktree({ repoPath, worktreePath: wt.path });

    await expect(
      createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' }),
    ).rejects.toMatchObject({ code: 'WORKTREE_COLLISION' });

    expect(existsSync(wt.path)).toBe(false);
  });

  // Segunda guarda: se o status disser "limpo" e mesmo assim houver alteração (ela chegou depois da
  // leitura), o `git worktree remove` sem --force recusa por conta própria.
  it('o Git recusa sem --force quando o status chega a dizer que está limpo', async () => {
    const { repoPath, wt } = await setUp();
    writeFileSync(join(wt.path, 'a.txt'), 'chegou depois do status');
    vi.mocked(getStatus).mockResolvedValueOnce({
      branch: names.branch,
      baseCommit: wt.baseCommit,
      changedFiles: 0,
      isDirty: false,
    });

    await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
      name: 'GitError',
      code: 'WORKTREE_HAS_UNSAVED_CHANGES',
    });

    expect(getStatus).toHaveBeenCalled();
    expect(existsSync(wt.path)).toBe(true);
    expect(readFileSync(join(wt.path, 'a.txt'), 'utf8')).toBe('chegou depois do status');
    expect(branchExists(repoPath, names.branch)).toBe(true);
  });

  it('removeWorktree recusa com GIT_LOCKED e o motivo quando o worktree foi travado', async () => {
    const { repoPath, wt } = await setUp();
    git(repoPath, 'worktree', 'lock', '--reason', 'em uso', wt.path);

    await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
      name: 'GitError',
      code: 'GIT_LOCKED',
      message: expect.stringContaining('em uso'),
    });

    expect(existsSync(wt.path)).toBe(true);
    expect(registeredWorktrees(repoPath)).toHaveLength(2);
  });

  it('o checkout principal não é removido', async () => {
    const { path: repoPath } = repo();

    // Quem recusa é o `git worktree remove` ("is a main working tree"), sem --force.
    await expect(removeWorktree({ repoPath, worktreePath: repoPath })).rejects.toMatchObject({
      name: 'GitError',
      code: 'UNKNOWN',
      exitCode: 128,
    });

    expect(existsSync(join(repoPath, '.git'))).toBe(true);
    expect(existsSync(join(repoPath, 'a.txt'))).toBe(true);
  });

  it('uma pasta que não é worktree não é apagada', async () => {
    const { path: repoPath } = repo();
    const plain = newFolder('project-hub-pasta-comum-');
    writeFileSync(join(plain, 'importante.txt'), 'x');

    // Quem recusa é a leitura do status ("not a git repository"): a pasta nem chega ao `remove`.
    await expect(removeWorktree({ repoPath, worktreePath: plain })).rejects.toMatchObject({
      name: 'GitError',
      code: 'UNKNOWN',
      exitCode: 128,
    });

    expect(readFileSync(join(plain, 'importante.txt'), 'utf8')).toBe('x');
  });

  it('um worktree de outro repositório não é removido a partir deste', async () => {
    const { path: repoPath } = repo();
    const { repoPath: otherRepo, wt } = await setUp();

    // O worktree está limpo, então quem recusa é o `git worktree remove` ("is not a working tree").
    await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
      name: 'GitError',
      code: 'UNKNOWN',
      exitCode: 128,
    });

    expect(existsSync(wt.path)).toBe(true);
    expect(registeredWorktrees(otherRepo)).toHaveLength(2);
  });

  it('recusa um caminho de worktree relativo, sem tocar em nada', async () => {
    const { repoPath, wt } = await setUp();

    await expect(
      removeWorktree({ repoPath, worktreePath: names.relativeDir }),
    ).rejects.toMatchObject({ name: 'GitError', code: 'VALIDATION_FAILED' });

    expect(existsSync(wt.path)).toBe(true);
    expect(registeredWorktrees(repoPath)).toHaveLength(2);
  });

  // R198: arquivo ou pasta ignorado pelo Git (`node_modules`, `.env`, build) não é trabalho não salvo.
  // O `git worktree remove` sem --force não os trata como sujeira e os apaga junto com a pasta.
  describe('com arquivos ignorados pelo Git (R198)', () => {
    async function setUpWithIgnoreRules(): Promise<Awaited<ReturnType<typeof setUp>>> {
      const { path: repoPath } = repo();
      writeFileSync(join(repoPath, '.gitignore'), '.env\nnode_modules/\nbuild/\n');
      git(repoPath, 'add', '.gitignore');
      git(repoPath, 'commit', '--no-verify', '-m', 'ignora .env, node_modules e build');
      const root = worktreesRoot();
      const wt = await createWorktree({ repoPath, worktreesRoot: root, names, baseRef: 'HEAD' });
      return { repoPath, root, wt };
    }

    function makeNodeModules(path: string): void {
      mkdirSync(join(path, 'node_modules', 'pacote'), { recursive: true });
      writeFileSync(join(path, 'node_modules', 'pacote', 'index.js'), 'modulo');
    }

    it.each([
      ['.env', (path: string) => writeFileSync(join(path, '.env'), 'SEGREDO=1')],
      ['node_modules', makeNodeModules],
      [
        'build',
        (path: string) => {
          mkdirSync(join(path, 'build'));
          writeFileSync(join(path, 'build', 'saida.js'), 'saida');
        },
      ],
    ])(
      'worktree com %s ignorado é removido sem --force, e a branch continua',
      async (_case, makeIgnored) => {
        const { repoPath, wt } = await setUpWithIgnoreRules();
        makeIgnored(wt.path);
        // Controle: o Git de fato vê o arquivo como ignorado, e o status comum diz que está limpo.
        expect(git(wt.path, 'status', '--porcelain')).toBe('');
        expect(git(wt.path, 'status', '--porcelain', '--ignored')).toMatch(/^!! /);

        await expect(removeWorktree({ repoPath, worktreePath: wt.path })).resolves.toBeUndefined();

        expect(existsSync(wt.path)).toBe(false);
        expect(registeredWorktrees(repoPath)).toHaveLength(1);
        expect(branchExists(repoPath, names.branch)).toBe(true);
        expect(revParse(repoPath, names.branch)).toBe(wt.baseCommit);
      },
    );

    it('vários ignorados juntos (.env e node_modules) não impedem a remoção', async () => {
      const { repoPath, wt } = await setUpWithIgnoreRules();
      writeFileSync(join(wt.path, '.env'), 'SEGREDO=1');
      makeNodeModules(wt.path);

      await expect(removeWorktree({ repoPath, worktreePath: wt.path })).resolves.toBeUndefined();

      expect(existsSync(wt.path)).toBe(false);
    });

    it('regra de ignorar só no repositório (info/exclude) também vale', async () => {
      const { repoPath, wt } = await setUp();
      writeFileSync(join(repoPath, '.git', 'info', 'exclude'), '*.log\n', { flag: 'a' });
      writeFileSync(join(wt.path, 'saida.log'), 'x');
      expect(git(wt.path, 'status', '--porcelain')).toBe('');

      await expect(removeWorktree({ repoPath, worktreePath: wt.path })).resolves.toBeUndefined();

      expect(existsSync(wt.path)).toBe(false);
    });

    it('com status.showUntrackedFiles=no na configuração, o ignorado também não impede', async () => {
      const { repoPath, wt } = await setUpWithIgnoreRules();
      git(repoPath, 'config', 'status.showUntrackedFiles', 'no');
      writeFileSync(join(wt.path, '.env'), 'SEGREDO=1');

      await expect(removeWorktree({ repoPath, worktreePath: wt.path })).resolves.toBeUndefined();

      expect(existsSync(wt.path)).toBe(false);
    });

    // O que bloqueava continua bloqueando, mesmo com ignorados ao lado: só o ignorado deixou de contar.
    it.each([
      [
        'arquivo versionado modificado',
        (path: string) => writeFileSync(join(path, 'a.txt'), 'mudou'),
      ],
      [
        'arquivo novo que o Git não ignora',
        (path: string) => writeFileSync(join(path, 'novo.txt'), 'x'),
      ],
      ['arquivo versionado apagado', (path: string) => rmSync(join(path, 'a.txt'))],
      ['arquivo versionado renomeado', (path: string) => git(path, 'mv', 'a.txt', 'renomeado.txt')],
    ])('worktree com %s e com ignorados continua não removido', async (_case, makeDirty) => {
      const { repoPath, wt } = await setUpWithIgnoreRules();
      writeFileSync(join(wt.path, '.env'), 'SEGREDO=1');
      makeNodeModules(wt.path);
      makeDirty(wt.path);

      await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
        name: 'GitError',
        code: 'WORKTREE_HAS_UNSAVED_CHANGES',
      });

      expect(existsSync(wt.path)).toBe(true);
      expect(existsSync(join(wt.path, '.env'))).toBe(true);
      expect(existsSync(join(wt.path, 'node_modules', 'pacote', 'index.js'))).toBe(true);
      expect(registeredWorktrees(repoPath)).toHaveLength(2);
    });

    // Com `status.showUntrackedFiles=no` o `git worktree remove` não vê o arquivo novo e o apagaria:
    // quem protege é a guarda de `getStatus`, que passa `--untracked-files=all`.
    it('com status.showUntrackedFiles=no, arquivo novo não ignorado ainda recusa a remoção', async () => {
      const { repoPath, wt } = await setUpWithIgnoreRules();
      git(repoPath, 'config', 'status.showUntrackedFiles', 'no');
      writeFileSync(join(wt.path, 'novo.txt'), 'trabalho novo');
      writeFileSync(join(wt.path, '.env'), 'SEGREDO=1');
      // Controle: a configuração esconde o arquivo novo do status comum do Git.
      expect(git(wt.path, 'status', '--porcelain')).toBe('');

      await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
        name: 'GitError',
        code: 'WORKTREE_HAS_UNSAVED_CHANGES',
      });

      expect(existsSync(wt.path)).toBe(true);
      expect(readFileSync(join(wt.path, 'novo.txt'), 'utf8')).toBe('trabalho novo');
      expect(registeredWorktrees(repoPath)).toHaveLength(2);
    });

    it('worktree com arquivo em conflito e com ignorados não é removido', async () => {
      const { repoPath, wt } = await setUpWithIgnoreRules();
      // A mesma linha de a.txt muda em `main` e na branch do worktree, e o merge deixa o conflito.
      writeFileSync(join(repoPath, 'a.txt'), 'versao de main\n');
      git(repoPath, 'commit', '--no-verify', '-am', 'muda em main');
      writeFileSync(join(wt.path, 'a.txt'), 'versao do worktree\n');
      git(wt.path, 'commit', '--no-verify', '-am', 'muda no worktree');
      expect(() => git(wt.path, 'merge', '--no-edit', 'main')).toThrow();
      expect(git(wt.path, 'status', '--porcelain')).toMatch(/^UU a\.txt/);
      writeFileSync(join(wt.path, '.env'), 'SEGREDO=1');

      await expect(removeWorktree({ repoPath, worktreePath: wt.path })).rejects.toMatchObject({
        name: 'GitError',
        code: 'WORKTREE_HAS_UNSAVED_CHANGES',
      });

      expect(existsSync(wt.path)).toBe(true);
      expect(existsSync(join(wt.path, '.env'))).toBe(true);
    });
  });
});
