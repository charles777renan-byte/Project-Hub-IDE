import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGitPanelPort } from '../src/git-panel-port';
import { GitError } from '../src/run-git';

// Git de verdade, em pastas temporárias, com um remoto `--bare` local. A configuração global e a do sistema
// do Git de quem roda os testes ficam de fora. Nenhum teste toca a rede.
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

const scratch = mkdtempSync(join(tmpdir(), 'project-hub-porta-teste-'));
const emptyGlobalConfig = join(scratch, 'global-vazio.gitconfig');
writeFileSync(emptyGlobalConfig, '');
const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

/** O Git de verdade, para montar o cenário. Não passa pelo adaptador. */
function git(cwd: string, args: string[]): string {
  const env = { ...process.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
}

let repo: TempRepo;
const port = createGitPanelPort();

beforeEach(() => {
  repo = createTempRepo();
});

afterEach(() => {
  repo.cleanup();
});

describe('createGitPanelPort', () => {
  it('lê o estado, põe em stage, faz o commit e lista o log', async () => {
    writeFileSync(join(repo.path, 'novo.txt'), 'oi\n');

    const before = await port.status(repo.path);
    expect(before.branch).toBe('main');
    expect(before.files).toEqual([{ path: 'novo.txt', staged: null, unstaged: 'U' }]);

    await port.stage(repo.path, ['novo.txt']);
    expect((await port.status(repo.path)).files).toEqual([
      { path: 'novo.txt', staged: 'A', unstaged: null },
    ]);

    await port.unstage(repo.path, ['novo.txt']);
    expect((await port.status(repo.path)).files[0]?.staged).toBeNull();

    await port.stage(repo.path, ['novo.txt']);
    const committed = await port.commit(repo.path, 'feat: novo arquivo');
    expect(committed.commit).toBe(git(repo.path, ['rev-parse', 'HEAD']).trim());

    const log = await port.log(repo.path, 1);
    expect(log).toHaveLength(1);
    expect(log[0]?.subject).toBe('feat: novo arquivo');
  });

  it('desfaz a alteração de um arquivo acompanhado', async () => {
    writeFileSync(join(repo.path, 'a.txt'), 'mudou\n');
    await port.discard(repo.path, ['a.txt']);
    expect((await port.status(repo.path)).files).toEqual([]);
  });

  it('sem origin/main, as alterações da branch vêm sem base, e o diff do arquivo segue contra o HEAD', async () => {
    writeFileSync(join(repo.path, 'a.txt'), 'mudou\n');

    const diff = await port.fileDiff(repo.path, 'a.txt');

    expect(diff).toMatchObject({ path: 'a.txt', baseRef: 'HEAD', binary: false });
    expect(diff?.patch).toContain('+mudou');
    expect(await port.branchChanges(repo.path)).toMatchObject({ baseRef: null, files: [] });
  });

  it('repositório sem nenhum commit: o diff do arquivo é null', async () => {
    const fresh = mkdtempSync(join(scratch, 'novo-'));
    git(fresh, ['init', '--initial-branch=main']);
    writeFileSync(join(fresh, 'x.txt'), 'x\n');

    expect(await port.fileDiff(fresh, 'x.txt')).toBeNull();
  });

  it('push publica a branch, e fetch e pull rodam contra o remoto', async () => {
    const remote = mkdtempSync(join(scratch, 'remoto-'));
    git(remote, ['init', '--bare', '--initial-branch=main']);
    git(repo.path, ['remote', 'add', 'origin', remote]);

    expect(await port.push(repo.path)).toEqual({ branch: 'main' });
    expect((await port.status(repo.path)).upstream).toBe('origin/main');

    await expect(port.fetch(repo.path)).resolves.toBeUndefined();
    expect(await port.pull(repo.path)).toEqual({ updated: false });
  });

  it('originUrl lê o remote.origin.url, e devolve null quando não há origin', async () => {
    // Sem origin: a chave ausente sai com código 1, e isso é null, não erro.
    expect(await port.originUrl(repo.path)).toBeNull();

    git(repo.path, ['remote', 'add', 'origin', 'https://github.com/dono/repo.git']);
    expect(await port.originUrl(repo.path)).toBe('https://github.com/dono/repo.git');

    // Só o `origin` conta: outro remoto não vira o endereço.
    git(repo.path, ['remote', 'remove', 'origin']);
    git(repo.path, ['remote', 'add', 'upstream', 'https://github.com/outro/repo.git']);
    expect(await port.originUrl(repo.path)).toBeNull();
  });

  it('originUrl numa pasta que não é repositório devolve null', async () => {
    const plain = mkdtempSync(join(scratch, 'sem-git-'));
    expect(await port.originUrl(plain)).toBeNull();
  });

  it('não captura o GitError: ele sobe com o código do adaptador', async () => {
    const error: unknown = await port.commit(repo.path, 'nada em stage').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error).toMatchObject({ code: 'GIT_NOTHING_TO_COMMIT' });
  });
});
