import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ErrorCode } from '@project-hub/contracts';
import { createTempRepo, revParse, type TempRepo } from '@project-hub/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  commitStaged,
  discardPaths,
  fetchOrigin,
  pullFastForward,
  pushBranch,
  stagePaths,
  translateGitWriteError,
  unstagePaths,
} from '../src/git-write';
import { GitError } from '../src/run-git';

// Git de verdade, em pastas temporárias, com um remoto `--bare` local. A configuração global e a do
// sistema do Git de quem roda os testes ficam de fora (hooks globais, `pull.rebase`, credenciais), como
// no teste de criar o repositório (ADR 0009). Nenhum teste toca a rede.
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

const scratch = mkdtempSync(join(tmpdir(), 'project-hub-escrita-teste-'));
const emptyGlobalConfig = join(scratch, 'global-vazio.gitconfig');
writeFileSync(emptyGlobalConfig, '');

const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;

// Variáveis do ambiente de quem roda os testes que mudariam o resultado: um programa de senha herdado
// (o terminal de uma IDE define GIT_ASKPASS) em vez de "terminal prompts disabled", um proxy no lugar do
// servidor local, ou uma identidade que o teste de "sem identidade" precisa que não exista.
const INHERITED_VARIABLES = [
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
];
const savedInherited = new Map(INHERITED_VARIABLES.map((name) => [name, process.env[name]]));

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  for (const name of INHERITED_VARIABLES) delete process.env[name];
});

afterAll(() => {
  restoreEnv('GIT_CONFIG_GLOBAL', savedGlobal);
  restoreEnv('GIT_CONFIG_NOSYSTEM', savedNoSystem);
  for (const [name, value] of savedInherited) restoreEnv(name, value);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

/** O Git de verdade, para montar o cenário e conferir o resultado. Não passa pelo adaptador. */
function git(cwd: string, args: string[]): string {
  const env = { ...process.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
}

/** Caminhos no índice, sem a citação de acentos do Git (`-z`). */
function indexFiles(cwd: string): string[] {
  return git(cwd, ['ls-files', '-z'])
    .split('\0')
    .filter((name) => name !== '')
    .sort();
}

/** Caminhos em stage (índice contra HEAD). */
function stagedFiles(cwd: string): string[] {
  return git(cwd, ['diff', '--cached', '--name-only', '-z'])
    .split('\0')
    .filter((name) => name !== '')
    .sort();
}

function commitCount(cwd: string): number {
  return Number(git(cwd, ['rev-list', '--count', 'HEAD']).trim());
}

function writeHook(repo: string, name: string, body: string): void {
  const file = join(repo, '.git', 'hooks', name);
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

function newScratchDir(prefix: string): string {
  return mkdtempSync(join(scratch, prefix));
}

async function failureOf(promise: Promise<unknown>): Promise<GitError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GitError);
    return error as GitError;
  }
  throw new Error('esperava uma rejeição, e a chamada terminou sem erro');
}

let repo: TempRepo;
let repoPath: string;

beforeEach(() => {
  repo = createTempRepo();
  repoPath = repo.path;
});

afterEach(() => {
  repo.cleanup();
});

/** Um remoto `--bare` local, com a `main` do repositório já enviada e a `origin` apontando para ele. */
function addBareRemote(): string {
  const remote = newScratchDir('remoto-');
  git(remote, ['init', '--bare', '--initial-branch=main']);
  git(repoPath, ['remote', 'add', 'origin', remote]);
  git(repoPath, ['push', '-u', 'origin', 'main']);
  return remote;
}

/** Outro clone do remoto, com identidade, para simular outra pessoa enviando commits. */
function cloneOther(remote: string): string {
  const other = join(newScratchDir('outro-'), 'clone');
  git(scratch, ['clone', remote, other]);
  git(other, ['config', 'user.name', 'Outra Pessoa']);
  git(other, ['config', 'user.email', 'outra@project-hub.invalid']);
  git(other, ['config', 'core.autocrlf', 'false']);
  return other;
}

function commitFile(cwd: string, name: string, content: string, message: string): void {
  writeFileSync(join(cwd, name), content);
  git(cwd, ['add', '--', name]);
  git(cwd, ['commit', '--no-verify', '-m', message]);
}

describe('stagePaths', () => {
  it('com caminhos: só eles entram no índice, com espaço, acento, aspas simples e colchetes', async () => {
    const names = ['com espaço.txt', 'acentuação-ção.txt', "aspas'simples.txt", 'a[1].txt'];
    for (const name of [...names, 'a1.txt', 'fora.txt']) writeFileSync(join(repoPath, name), 'x\n');

    await stagePaths({ repo: repoPath, paths: names });

    // `a[1].txt` é um nome, e não um padrão: `a1.txt` não entra junto.
    expect(indexFiles(repoPath)).toEqual([...names, 'a.txt'].sort());
  });

  it('sem caminhos (add -A): entra tudo, novo, alterado e apagado', async () => {
    writeFileSync(join(repoPath, 'novo com espaço.txt'), 'x\n');
    writeFileSync(join(repoPath, 'a.txt'), 'alterado\n');
    mkdirSync(join(repoPath, 'pasta'));
    writeFileSync(join(repoPath, 'pasta', 'ação.txt'), 'y\n');

    await stagePaths({ repo: repoPath });

    expect(stagedFiles(repoPath)).toEqual(['a.txt', 'novo com espaço.txt', 'pasta/ação.txt']);
  });

  it('lista vazia de caminhos: VALIDATION_FAILED, sem rodar o Git', async () => {
    const error = await failureOf(stagePaths({ repo: repoPath, paths: [] }));

    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['absoluto', '/etc/passwd'],
    ['de unidade', 'C:/Windows/system.ini'],
    ['que sai do projeto', '../fora.txt'],
    ['com barra invertida', 'pasta\\a.txt'],
    ['vazio', ''],
  ])('caminho %s: VALIDATION_FAILED', async (_label, path) => {
    const error = await failureOf(stagePaths({ repo: repoPath, paths: [path] }));

    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('arquivo cujo nome começa com hífen: entra no índice, e não vira opção do Git', async () => {
    writeFileSync(join(repoPath, '-x'), 'x\n');

    await stagePaths({ repo: repoPath, paths: ['-x'] });

    expect(indexFiles(repoPath)).toEqual(['-x', 'a.txt']);
  });
});

describe('unstagePaths', () => {
  it('tira do stage só o caminho pedido', async () => {
    writeFileSync(join(repoPath, 'um.txt'), '1\n');
    writeFileSync(join(repoPath, 'dois com espaço.txt'), '2\n');
    await stagePaths({ repo: repoPath });

    await unstagePaths({ repo: repoPath, paths: ['um.txt'] });

    expect(stagedFiles(repoPath)).toEqual(['dois com espaço.txt']);
    // O arquivo continua no disco: tirar do stage não desfaz o trabalho.
    expect(existsSync(join(repoPath, 'um.txt'))).toBe(true);
  });

  it('arquivo cujo nome começa com hífen', async () => {
    writeFileSync(join(repoPath, '-x'), 'x\n');
    await stagePaths({ repo: repoPath, paths: ['-x'] });

    await unstagePaths({ repo: repoPath, paths: ['-x'] });

    expect(stagedFiles(repoPath)).toEqual([]);
  });
});

describe('discardPaths', () => {
  it('restaura o arquivo rastreado ao conteúdo do índice', async () => {
    writeFileSync(join(repoPath, 'a.txt'), 'trabalho perdido\n');

    await discardPaths({ repo: repoPath, paths: ['a.txt'] });

    expect(git(repoPath, ['status', '--porcelain']).trim()).toBe('');
    expect(git(repoPath, ['show', 'HEAD:a.txt'])).toBe('conteudo inicial\n');
  });

  it('restaura um arquivo apagado', async () => {
    rmSync(join(repoPath, 'a.txt'));

    await discardPaths({ repo: repoPath, paths: ['a.txt'] });

    expect(existsSync(join(repoPath, 'a.txt'))).toBe(true);
  });

  it('recusa arquivo não rastreado com VALIDATION_FAILED, sem apagá-lo', async () => {
    writeFileSync(join(repoPath, 'novo.txt'), 'nunca commitado\n');

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['novo.txt'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('novo.txt');
    expect(existsSync(join(repoPath, 'novo.txt'))).toBe(true);
  });

  it('com um caminho rastreado e outro não: recusa tudo, e o rastreado não é restaurado', async () => {
    writeFileSync(join(repoPath, 'a.txt'), 'alterado\n');
    writeFileSync(join(repoPath, 'novo.txt'), 'x\n');

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['a.txt', 'novo.txt'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(git(repoPath, ['status', '--porcelain']).includes(' M a.txt')).toBe(true);
  });

  it('caminho que não existe em lugar nenhum: VALIDATION_FAILED', async () => {
    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['fantasma.txt'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('arquivo cujo nome começa com hífen', async () => {
    commitFile(repoPath, '-x', 'original\n', 'Com hífen');
    writeFileSync(join(repoPath, '-x'), 'alterado\n');

    await discardPaths({ repo: repoPath, paths: ['-x'] });

    expect(git(repoPath, ['status', '--porcelain']).trim()).toBe('');
  });

  it('pasta e nome com colchetes: restaura o arquivo certo, e não um padrão', async () => {
    mkdirSync(join(repoPath, 'pasta[1]'));
    commitFile(repoPath, 'pasta[1]/a[1].txt', 'original\n', 'Com colchetes');
    commitFile(repoPath, 'pasta[1]/a1.txt', 'outro\n', 'Irmão');
    writeFileSync(join(repoPath, 'pasta[1]', 'a[1].txt'), 'alterado\n');
    writeFileSync(join(repoPath, 'pasta[1]', 'a1.txt'), 'alterado também\n');

    await discardPaths({ repo: repoPath, paths: ['pasta[1]/a[1].txt'] });

    expect(git(repoPath, ['status', '--porcelain']).trim()).toBe('M pasta[1]/a1.txt');
  });

  it('arquivo não rastreado de nome parecido com o de um rastreado: recusa, e o outro fica como está', async () => {
    // `a[1].txt` não é rastreado, mas `a1.txt` é: se o nome valesse como padrão, a conferência passaria.
    commitFile(repoPath, 'a1.txt', 'original\n', 'Irmão');
    writeFileSync(join(repoPath, 'a1.txt'), 'alterado\n');
    writeFileSync(join(repoPath, 'a[1].txt'), 'nunca commitado\n');

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['a[1].txt'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('a[1].txt');
    expect(git(repoPath, ['status', '--porcelain']).includes(' M a1.txt')).toBe(true);
    expect(existsSync(join(repoPath, 'a[1].txt'))).toBe(true);
  });

  it('pasta com arquivos rastreados: recusa a lista toda, e nada é restaurado', async () => {
    mkdirSync(join(repoPath, 'pasta'));
    commitFile(repoPath, 'pasta/b.txt', 'original\n', 'Dentro da pasta');
    writeFileSync(join(repoPath, 'pasta', 'b.txt'), 'alterado\n');
    writeFileSync(join(repoPath, 'a.txt'), 'alterado\n');

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['a.txt', 'pasta'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('pasta');
    expect(git(repoPath, ['status', '--porcelain']).split('\n').sort()).toEqual([
      '',
      ' M a.txt',
      ' M pasta/b.txt',
    ]);
  });

  it('pasta com barra no fim: recusa', async () => {
    mkdirSync(join(repoPath, 'pasta'));
    commitFile(repoPath, 'pasta/b.txt', 'original\n', 'Dentro da pasta');
    writeFileSync(join(repoPath, 'pasta', 'b.txt'), 'alterado\n');

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['pasta/'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(git(repoPath, ['status', '--porcelain']).trim()).toBe('M pasta/b.txt');
  });

  it('arquivo em conflito (estágios 1 a 3 no índice): recusa a lista toda, e nada é restaurado', async () => {
    git(repoPath, ['checkout', '-b', 'outra']);
    commitFile(repoPath, 'a.txt', 'versão da outra\n', 'Muda na outra');
    git(repoPath, ['checkout', 'main']);
    commitFile(repoPath, 'a.txt', 'versão da main\n', 'Muda na main');
    commitFile(repoPath, 'b.txt', 'original\n', 'Outro arquivo');
    expect(() => git(repoPath, ['merge', 'outra'])).toThrow();
    expect(git(repoPath, ['status', '--porcelain']).trim()).toBe('UU a.txt');
    writeFileSync(join(repoPath, 'b.txt'), 'alterado\n');

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['b.txt', 'a.txt'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('a.txt');
    expect(git(repoPath, ['status', '--porcelain']).split('\n').sort()).toEqual([
      '',
      ' M b.txt',
      'UU a.txt',
    ]);
  });

  it('arquivo em conflito sozinho: recusa com VALIDATION_FAILED, e não com o erro cru do Git', async () => {
    git(repoPath, ['checkout', '-b', 'outra']);
    commitFile(repoPath, 'a.txt', 'versão da outra\n', 'Muda na outra');
    git(repoPath, ['checkout', 'main']);
    commitFile(repoPath, 'a.txt', 'versão da main\n', 'Muda na main');
    expect(() => git(repoPath, ['merge', 'outra'])).toThrow();

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['a.txt'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('conflito com um estágio só no índice (por exemplo "adicionado por nós"): também recusa', async () => {
    // Uma entrada só, no estágio 2: o `ls-files` a lista uma vez, como a de um arquivo comum.
    const blob = git(repoPath, ['rev-parse', 'HEAD:a.txt']).trim();
    execFileSync('git', ['update-index', '--index-info'], {
      cwd: repoPath,
      input: `100644 ${blob} 2\tsozinho.txt\n`,
    });
    expect(git(repoPath, ['status', '--porcelain']).includes('AU sozinho.txt')).toBe(true);

    const error = await failureOf(discardPaths({ repo: repoPath, paths: ['sozinho.txt'] }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toContain('sozinho.txt');
  });

  // O ":" não existe em nome de arquivo no Windows.
  it.skipIf(process.platform === 'win32')('pasta e nome com ":"', async () => {
    mkdirSync(join(repoPath, 'pasta:2'));
    commitFile(repoPath, 'pasta:2/a:b.txt', 'original\n', 'Com dois pontos');
    writeFileSync(join(repoPath, 'pasta:2', 'a:b.txt'), 'alterado\n');

    await discardPaths({ repo: repoPath, paths: ['pasta:2/a:b.txt'] });

    expect(git(repoPath, ['status', '--porcelain']).trim()).toBe('');
  });
});

describe('commitStaged', () => {
  it('cria o commit com a mensagem e devolve o nome dele', async () => {
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath, paths: ['b.txt'] });

    const { commit } = await commitStaged({ repo: repoPath, message: 'Adiciona b\n\nCom corpo.' });

    expect(commit).toBe(revParse(repoPath, 'HEAD'));
    expect(git(repoPath, ['log', '-1', '--format=%B']).trim()).toBe('Adiciona b\n\nCom corpo.');
    expect(commitCount(repoPath)).toBe(2);
  });

  it('os hooks rodam: um pre-commit que passa deixa a marca, e o commit sai', async () => {
    writeHook(repoPath, 'pre-commit', 'echo rodou > "$(git rev-parse --git-dir)/marca-pre-commit"');
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });

    await commitStaged({ repo: repoPath, message: 'Com hook' });

    expect(existsSync(join(repoPath, '.git', 'marca-pre-commit'))).toBe(true);
    expect(commitCount(repoPath)).toBe(2);
  });

  it('pre-commit que sai com erro: nenhum commit, GIT_HOOK_FAILED com a saída do hook, índice intacto', async () => {
    writeHook(repoPath, 'pre-commit', 'echo "lint falhou: sobrou um console.log"\nexit 1');
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath, paths: ['b.txt'] });
    const before = commitCount(repoPath);
    const staged = stagedFiles(repoPath);

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Vai falhar' }));

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('lint falhou: sobrou um console.log');
    expect(commitCount(repoPath)).toBe(before);
    expect(stagedFiles(repoPath)).toEqual(staged);
  });

  it('core.hooksPath absoluto: o pre-commit de lá que recusa, sem a palavra "hook" na saída, é GIT_HOOK_FAILED', async () => {
    const hooksDir = newScratchDir('hooks-globais-');
    const file = join(hooksDir, 'pre-commit');
    writeFileSync(file, '#!/bin/sh\necho "lint falhou: arquivo fora do padrão" >&2\nexit 1\n');
    chmodSync(file, 0o755);
    git(repoPath, ['config', 'core.hooksPath', hooksDir]);
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Vai falhar' }));

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('lint falhou: arquivo fora do padrão');
    expect(commitCount(repoPath)).toBe(1);
  });

  it('falha de assinatura (gpg) com um pre-commit presente que passa: não é GIT_HOOK_FAILED', async () => {
    writeHook(repoPath, 'pre-commit', 'exit 0');
    git(repoPath, ['config', 'commit.gpgsign', 'true']);
    git(repoPath, ['config', 'gpg.program', join(scratch, 'gpg-que-nao-existe')]);
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Sem assinatura' }));

    expect(error.code).toBe('UNKNOWN');
    expect(commitCount(repoPath)).toBe(1);
  });

  it('sem nada em stage: GIT_NOTHING_TO_COMMIT', async () => {
    const before = commitCount(repoPath);

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Nada' }));

    expect(error.code).toBe('GIT_NOTHING_TO_COMMIT');
    expect(commitCount(repoPath)).toBe(before);
  });

  it('só com alteração fora do stage: GIT_NOTHING_TO_COMMIT, sem usar o -a', async () => {
    writeFileSync(join(repoPath, 'a.txt'), 'alterado\n');
    writeFileSync(join(repoPath, 'novo.txt'), 'x\n');

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Nada em stage' }));

    expect(error.code).toBe('GIT_NOTHING_TO_COMMIT');
    expect(commitCount(repoPath)).toBe(1);
  });

  it('sem identidade: a mensagem manda configurar user.name e user.email com git config --global', async () => {
    git(repoPath, ['config', '--unset', 'user.name']);
    git(repoPath, ['config', '--unset', 'user.email']);
    // Sem isto o Git tentaria montar um nome e um e-mail a partir do usuário e da máquina.
    git(repoPath, ['config', 'user.useConfigOnly', 'true']);
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Sem identidade' }));

    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toContain('git config --global user.name');
    expect(error.message).toContain('git config --global user.email');
    expect(commitCount(repoPath)).toBe(1);
  });

  it('pre-commit que imprime "Authentication failed" e sai com 1: GIT_HOOK_FAILED, e não GIT_AUTH_REQUIRED', async () => {
    writeHook(repoPath, 'pre-commit', 'echo "Authentication failed no teste de login" >&2\nexit 1');
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Vai falhar' }));

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('Authentication failed no teste de login');
  });

  it('pre-commit que passa e .git/HEAD.lock ocupado: UNKNOWN, sem caminho nem texto do Git na mensagem', async () => {
    writeHook(repoPath, 'pre-commit', 'exit 0');
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });
    writeFileSync(join(repoPath, '.git', 'HEAD.lock'), '');

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Travado' }));

    expect(error.code).toBe('UNKNOWN');
    expect(error.message).not.toContain(repoPath);
    expect(error.message).not.toContain(repoPath.replaceAll('\\', '/'));
    expect(error.message).not.toMatch(
      /fatal|cannot lock|Unable to create|File exists|HEAD\.lock/iu,
    );
    // O texto do Git continua no erro, para o registro do processo principal.
    expect(error.stderr).toContain('HEAD');
  });

  it('conclusão de um merge sem alteração em stage: o Git decide, e o commit sai', async () => {
    git(repoPath, ['checkout', '-b', 'outra']);
    commitFile(repoPath, 'a.txt', 'versão da outra\n', 'Na outra');
    git(repoPath, ['checkout', 'main']);
    commitFile(repoPath, 'a.txt', 'versão da main\n', 'Na main');
    expect(() => git(repoPath, ['merge', 'outra'])).toThrow();
    // Resolve o conflito com o conteúdo que a main já tinha: nada fica em stage contra o HEAD.
    writeFileSync(join(repoPath, 'a.txt'), 'versão da main\n');
    git(repoPath, ['add', '--', 'a.txt']);
    expect(stagedFiles(repoPath)).toEqual([]);

    const { commit } = await commitStaged({ repo: repoPath, message: 'Conclui o merge' });

    expect(commit).toBe(revParse(repoPath, 'HEAD'));
    expect(git(repoPath, ['rev-list', '--merges', '--count', 'HEAD']).trim()).toBe('1');
  });

  it.each([
    ['vazia', ''],
    ['só com espaços', '   \n '],
    ['que começa com hífen', '- item da lista'],
    ['com mais de 10 000 caracteres', 'x'.repeat(10_001)],
  ])('mensagem %s: VALIDATION_FAILED, sem rodar o commit', async (_label, message) => {
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });

    const error = await failureOf(commitStaged({ repo: repoPath, message }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(commitCount(repoPath)).toBe(1);
  });

  it('index.lock ocupado: GIT_LOCKED, e nada entra no commit', async () => {
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    await stagePaths({ repo: repoPath });
    writeFileSync(join(repoPath, '.git', 'index.lock'), '');

    const error = await failureOf(commitStaged({ repo: repoPath, message: 'Travado' }));

    expect(error.code).toBe('GIT_LOCKED');
    expect(commitCount(repoPath)).toBe(1);
  });
});

describe('pushBranch', () => {
  it('envia a branch com push -u origin <branch>: o remoto recebe o commit e a branch passa a ter upstream', async () => {
    const remote = newScratchDir('remoto-');
    git(remote, ['init', '--bare', '--initial-branch=main']);
    git(repoPath, ['remote', 'add', 'origin', remote]);

    const result = await pushBranch({ repo: repoPath });

    expect(result).toEqual({ branch: 'main' });
    expect(git(remote, ['rev-parse', 'main']).trim()).toBe(revParse(repoPath, 'HEAD'));
    expect(git(repoPath, ['rev-parse', '--abbrev-ref', 'main@{upstream}']).trim()).toBe(
      'origin/main',
    );
  });

  it('depois de já ter upstream: envia o commit novo', async () => {
    const remote = addBareRemote();
    commitFile(repoPath, 'b.txt', 'b\n', 'Segundo commit');

    await pushBranch({ repo: repoPath });

    expect(git(remote, ['rev-parse', 'main']).trim()).toBe(revParse(repoPath, 'HEAD'));
  });

  it('depois de o remoto avançar por outro clone: GIT_NOT_FAST_FORWARD, e o remoto não é reescrito', async () => {
    const remote = addBareRemote();
    const other = cloneOther(remote);
    commitFile(other, 'dele.txt', 'dele\n', 'Commit do outro');
    git(other, ['push']);
    const remoteHead = git(remote, ['rev-parse', 'main']).trim();
    commitFile(repoPath, 'meu.txt', 'meu\n', 'Commit meu');

    const error = await failureOf(pushBranch({ repo: repoPath }));

    expect(error.code).toBe('GIT_NOT_FAST_FORWARD');
    expect(git(remote, ['rev-parse', 'main']).trim()).toBe(remoteHead);
  });

  it('com pre-push presente que passa e o remoto adiantado: GIT_NOT_FAST_FORWARD, e não GIT_HOOK_FAILED', async () => {
    const remote = addBareRemote();
    const other = cloneOther(remote);
    commitFile(other, 'dele.txt', 'dele\n', 'Commit do outro');
    git(other, ['push']);
    const remoteHead = git(remote, ['rev-parse', 'main']).trim();
    commitFile(repoPath, 'meu.txt', 'meu\n', 'Commit meu');
    writeHook(repoPath, 'pre-push', 'exit 0');

    const error = await failureOf(pushBranch({ repo: repoPath }));

    expect(error.code).toBe('GIT_NOT_FAST_FORWARD');
    expect(git(remote, ['rev-parse', 'main']).trim()).toBe(remoteHead);
  });

  // Conferido no Git 2.54: com qualquer um destes "+", `push origin main` sairia como forced update.
  it.each([['+refs/heads/main:refs/heads/main'], ['+refs/heads/*:refs/heads/*']])(
    'remote.origin.push = %s no repositório: o envio continua sem forçar',
    async (configured) => {
      const remote = addBareRemote();
      const other = cloneOther(remote);
      commitFile(other, 'dele.txt', 'dele\n', 'Commit do outro');
      git(other, ['push']);
      const remoteHead = git(remote, ['rev-parse', 'main']).trim();
      commitFile(repoPath, 'meu.txt', 'meu\n', 'Commit meu');
      git(repoPath, ['config', 'remote.origin.push', configured]);

      const error = await failureOf(pushBranch({ repo: repoPath }));

      expect(error.code).toBe('GIT_NOT_FAST_FORWARD');
      expect(git(remote, ['rev-parse', 'main']).trim()).toBe(remoteHead);
    },
  );

  it('pre-push que passa e o remoto recusando a branch em uso (receive.denyCurrentBranch): UNKNOWN, sem texto do servidor', async () => {
    // Um remoto comum (com árvore de trabalho) que já tem a história do repositório e a main em uso.
    const remote = join(newScratchDir('remoto-comum-'), 'repo');
    git(scratch, ['clone', repoPath, remote]);
    git(remote, ['config', 'receive.denyCurrentBranch', 'refuse']);
    git(repoPath, ['remote', 'add', 'origin', remote]);
    writeHook(repoPath, 'pre-push', 'exit 0');
    commitFile(repoPath, 'b.txt', 'b\n', 'Segundo commit');
    const remoteHead = git(remote, ['rev-parse', 'main']).trim();

    const error = await failureOf(pushBranch({ repo: repoPath }));

    expect(error.code).toBe('UNKNOWN');
    expect(error.message).not.toMatch(/remote|refus|checked|rejected|push some refs/iu);
    expect(error.message).toContain('O remoto recusou o envio');
    expect(git(remote, ['rev-parse', 'main']).trim()).toBe(remoteHead);
  });

  it.each([
    ['em stdout (echo sem >&2)', 'echo "testes falharam antes do push"'],
    ['em stderr (echo >&2)', 'echo "testes falharam antes do push" >&2'],
  ])(
    'pre-push que sai com erro, escrevendo %s: GIT_HOOK_FAILED com a saída do hook, e o remoto não recebe',
    async (_label, echo) => {
      const remote = addBareRemote();
      const remoteHead = git(remote, ['rev-parse', 'main']).trim();
      writeHook(repoPath, 'pre-push', `${echo}\nexit 1`);
      commitFile(repoPath, 'b.txt', 'b\n', 'Segundo commit');

      const error = await failureOf(pushBranch({ repo: repoPath }));

      expect(error.code).toBe('GIT_HOOK_FAILED');
      expect(error.message).toContain('testes falharam antes do push');
      expect(git(remote, ['rev-parse', 'main']).trim()).toBe(remoteHead);
    },
  );

  it('pre-push que imprime "! [rejected] main -> main" sem o motivo do Git e sai com 1: GIT_HOOK_FAILED', async () => {
    addBareRemote();
    writeHook(repoPath, 'pre-push', 'echo "! [rejected] main -> main"\nexit 1');
    commitFile(repoPath, 'b.txt', 'b\n', 'Segundo commit');

    const error = await failureOf(pushBranch({ repo: repoPath }));

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('! [rejected] main -> main');
  });

  it('remoto que não existe, com um pre-push presente que passa: UNKNOWN, e não GIT_HOOK_FAILED', async () => {
    writeHook(repoPath, 'pre-push', 'exit 0');
    git(repoPath, ['remote', 'add', 'origin', join(scratch, 'remoto-que-nao-existe.git')]);

    const error = await failureOf(pushBranch({ repo: repoPath }));

    expect(error.code).toBe('UNKNOWN');
  });

  it('repositório sem nenhum commit, com um pre-push que passa: VALIDATION_FAILED, sem rodar o push', async () => {
    const empty = newScratchDir('sem-commit-');
    git(empty, ['init', '--initial-branch=main']);
    const marker = join(empty, '.git', 'marca-pre-push');
    writeHook(empty, 'pre-push', `echo rodou > "${marker.replaceAll('\\', '/')}"`);
    git(empty, ['remote', 'add', 'origin', newScratchDir('remoto-vazio-')]);

    const error = await failureOf(pushBranch({ repo: empty }));

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toMatch(/commit/u);
    expect(existsSync(marker)).toBe(false);
  });

  it('com HEAD solto: GIT_DETACHED_HEAD, sem rodar o push', async () => {
    addBareRemote();
    git(repoPath, ['checkout', '--detach']);

    const error = await failureOf(pushBranch({ repo: repoPath }));

    expect(error.code).toBe('GIT_DETACHED_HEAD');
  });
});

describe('pullFastForward', () => {
  it('avança a branch que está atrás e diz que atualizou', async () => {
    const remote = addBareRemote();
    const other = cloneOther(remote);
    commitFile(other, 'dele.txt', 'dele\n', 'Commit do outro');
    git(other, ['push']);

    const result = await pullFastForward({ repo: repoPath });

    expect(result).toEqual({ updated: true });
    expect(revParse(repoPath, 'HEAD')).toBe(git(remote, ['rev-parse', 'main']).trim());
    expect(existsSync(join(repoPath, 'dele.txt'))).toBe(true);
  });

  it('com a branch em dia: não atualiza nada', async () => {
    addBareRemote();

    const result = await pullFastForward({ repo: repoPath });

    expect(result).toEqual({ updated: false });
  });

  it('com a branch divergida: GIT_NOT_FAST_FORWARD, sem commit de merge e sem mexer na branch', async () => {
    const remote = addBareRemote();
    const other = cloneOther(remote);
    commitFile(other, 'dele.txt', 'dele\n', 'Commit do outro');
    git(other, ['push']);
    commitFile(repoPath, 'meu.txt', 'meu\n', 'Commit meu');
    const head = revParse(repoPath, 'HEAD');

    const error = await failureOf(pullFastForward({ repo: repoPath }));

    expect(error.code).toBe('GIT_NOT_FAST_FORWARD');
    expect(revParse(repoPath, 'HEAD')).toBe(head);
    expect(git(repoPath, ['rev-list', '--merges', '--count', 'HEAD']).trim()).toBe('0');
    expect(existsSync(join(repoPath, 'dele.txt'))).toBe(false);
  });

  it('com HEAD solto: GIT_DETACHED_HEAD', async () => {
    addBareRemote();
    git(repoPath, ['checkout', '--detach']);

    const error = await failureOf(pullFastForward({ repo: repoPath }));

    expect(error.code).toBe('GIT_DETACHED_HEAD');
  });
});

describe('fetchOrigin', () => {
  it('atualiza as refs remotas e poda as apagadas no remoto', async () => {
    const remote = addBareRemote();
    const other = cloneOther(remote);
    git(other, ['checkout', '-b', 'feature']);
    commitFile(other, 'dele.txt', 'dele\n', 'Commit na feature');
    git(other, ['push', '-u', 'origin', 'feature']);

    await fetchOrigin({ repo: repoPath });

    expect(revParse(repoPath, 'refs/remotes/origin/feature')).toBe(revParse(other, 'HEAD'));
    // O fetch não mexe na branch local.
    expect(commitCount(repoPath)).toBe(1);

    git(other, ['push', 'origin', '--delete', 'feature']);
    await fetchOrigin({ repo: repoPath });

    expect(git(repoPath, ['branch', '--remotes', '--list', 'origin/feature']).trim()).toBe('');
  });

  it('index.lock ocupado: GIT_LOCKED não aparece, porque o fetch não escreve no índice', async () => {
    addBareRemote();
    writeFileSync(join(repoPath, '.git', 'index.lock'), '');

    await expect(fetchOrigin({ repo: repoPath })).resolves.toBeUndefined();
  });
});

describe('index.lock ocupado', () => {
  it('stagePaths: GIT_LOCKED, e o índice fica como estava', async () => {
    writeFileSync(join(repoPath, 'b.txt'), 'b\n');
    writeFileSync(join(repoPath, '.git', 'index.lock'), '');

    const error = await failureOf(stagePaths({ repo: repoPath, paths: ['b.txt'] }));

    expect(error.code).toBe('GIT_LOCKED');
    expect(indexFiles(repoPath)).toEqual(['a.txt']);
  });
});

describe('pedido de senha (servidor HTTP local que responde 401)', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="teste"' });
      response.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/projeto.git`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it.each([
    ['fetchOrigin', (): Promise<unknown> => fetchOrigin({ repo: repoPath })],
    ['pullFastForward', (): Promise<unknown> => pullFastForward({ repo: repoPath })],
    ['pushBranch', (): Promise<unknown> => pushBranch({ repo: repoPath })],
  ])('%s: GIT_AUTH_REQUIRED em vez de travar esperando senha', async (_name, run) => {
    git(repoPath, ['remote', 'add', 'origin', url]);

    const error = await failureOf(run());

    expect(error.code).toBe('GIT_AUTH_REQUIRED');
    expect(error.message).not.toContain(url);
  });
});

describe('translateGitWriteError', () => {
  function failure(
    stderr: string,
    code: ErrorCode = 'UNKNOWN',
    exitCode = 1,
    stdout = '',
  ): GitError {
    return new GitError(code, 'O comando "git x" terminou com erro.', { exitCode, stderr, stdout });
  }

  it.each([
    ["fatal: could not read Username for 'https://x.invalid': terminal prompts disabled"],
    ['fatal: could not read Username for ...'],
    ['fatal: Authentication failed for https://x.invalid/a.git/'],
    ['fatal: terminal prompts disabled'],
  ])('autenticação: %s', (stderr) => {
    expect((translateGitWriteError(failure(stderr), 'push') as GitError).code).toBe(
      'GIT_AUTH_REQUIRED',
    );
  });

  it.each([
    ['! [rejected]        main -> main (non-fast-forward)'],
    ['! [rejected]        main -> main (fetch first)'],
    ['fatal: Not possible to fast-forward, aborting.'],
  ])('avanço impossível: %s', (stderr) => {
    expect((translateGitWriteError(failure(stderr), 'push') as GitError).code).toBe(
      'GIT_NOT_FAST_FORWARD',
    );
  });

  it('a mensagem de avanço impossível manda resolver no terminal', () => {
    const pull = translateGitWriteError(failure('fatal: Not possible to fast-forward'), 'pull');

    expect((pull as GitError).message).toContain('terminal');
  });

  it('não traduz o que já tem código próprio (GIT_LOCKED, PERMISSION_DENIED)', () => {
    const locked = failure('index.lock', 'GIT_LOCKED');

    expect(translateGitWriteError(locked, 'commit')).toBe(locked);
  });

  it('saída de hook remoto recusando o push vira GIT_HOOK_FAILED', () => {
    const error = translateGitWriteError(
      failure(
        'remote: pre-receive hook declined\nTo x\n ! [remote rejected] main -> main (pre-receive hook declined)',
      ),
      'push',
    ) as GitError;

    expect(error.code).toBe('GIT_HOOK_FAILED');
  });

  it('falha de rede (saída 128) com um hook local presente: não é GIT_HOOK_FAILED, nem com "hook" no endereço', () => {
    const network = failure(
      "fatal: unable to access 'https://x.invalid/webhook-service.git/': Could not resolve host: x.invalid",
      'UNKNOWN',
      128,
    );

    expect(translateGitWriteError(network, 'push', { hookPresent: true })).toBe(network);
    expect(translateGitWriteError(network, 'push')).toBe(network);
  });

  it('saída diferente de 1 com um hook presente (HEAD.lock, saída 128): sobe como veio, sem texto do Git', () => {
    const locked = failure(
      "fatal: cannot lock ref 'HEAD': Unable to create 'C:/p/.git/HEAD.lock': File exists.",
      'UNKNOWN',
      128,
    );

    expect(translateGitWriteError(locked, 'commit', { hookPresent: true })).toBe(locked);
    expect(locked.message).not.toContain('HEAD.lock');
  });

  it('hook presente e saída 1: a rejeição de avanço do Git (com o motivo) vence a do hook', () => {
    const rejected = failure(
      " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'x'",
    );

    expect((translateGitWriteError(rejected, 'push', { hookPresent: true }) as GitError).code).toBe(
      'GIT_NOT_FAST_FORWARD',
    );
  });

  it('hook presente e saída 1: "! [rejected]" que o hook imprime, sem o formato do Git, é do hook', () => {
    const fromHook = failure('! [rejected] main -> main\nerror: failed to push some refs to x');

    const error = translateGitWriteError(fromHook, 'push', { hookPresent: true }) as GitError;

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('! [rejected] main -> main');
  });

  it.each([
    ['nothing to commit, working tree clean'],
    ['nothing added to commit but untracked files present'],
    ['no changes added to commit'],
  ])('hook presente, saída 1 e "%s" só no stdout: GIT_NOTHING_TO_COMMIT', (text) => {
    const error = translateGitWriteError(
      failure('', 'UNKNOWN', 1, `On branch main\n${text}\n`),
      'commit',
      {
        hookPresent: true,
      },
    ) as GitError;

    expect(error.code).toBe('GIT_NOTHING_TO_COMMIT');
  });

  it('sem hook, o stdout não é lido: o resto sobe como veio', () => {
    const unknown = failure('', 'UNKNOWN', 1, 'On branch main\nnothing to commit\n');

    expect(translateGitWriteError(unknown, 'commit')).toBe(unknown);
  });

  it.each([
    ['Authentication failed'],
    ['could not read Username'],
    ['non-fast-forward'],
    ['Author identity unknown'],
    ['empty ident name'],
    ['You are not currently on a branch'],
  ])('hook presente, saída 1 e a saída do hook diz "%s": GIT_HOOK_FAILED', (text) => {
    const error = translateGitWriteError(
      failure(`${text} (impresso pelo teste do hook)`),
      'commit',
      {
        hookPresent: true,
      },
    ) as GitError;

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain(text);
  });

  it('a mensagem de hook junta stdout e stderr', () => {
    const error = translateGitWriteError(
      failure('do stderr', 'UNKNOWN', 1, 'do stdout'),
      'commit',
      { hookPresent: true },
    ) as GitError;

    expect(error.message).toContain('do stdout');
    expect(error.message).toContain('do stderr');
  });

  it('limpa a saída do hook: cursor, hiperlink e título (OSC), retorno de carro, C1 e direção de texto', () => {
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    const stderr = [
      `a${esc}[?25lb${esc}[31mc${esc}[0m`,
      `${esc}]8;;http://evil.example${bel}link${esc}]8;;${bel}`,
      `${esc}]0;titulo${esc}\\depois`,
      'progresso 10%\rprogresso 100%',
      'c1\u0085x',
      'bidi\u202eabc\u2066d',
      'To https://servidor/projeto.git',
      ' ! [remote rejected] main -> main (hook declined)',
      "error: failed to push some refs to 'x'",
      'linha final do hook',
    ].join('\n');

    const error = translateGitWriteError(failure(stderr), 'push', {
      hookPresent: true,
    }) as GitError;

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('abc');
    expect(error.message).toContain('link');
    expect(error.message).toContain('depois');
    expect(error.message).toContain('progresso 10%\nprogresso 100%');
    expect(error.message).toContain('c1x');
    expect(error.message).toContain('bidiabcd');
    expect(error.message).toContain('linha final do hook');
    for (const resíduo of [
      '[?25l',
      '[31m',
      ']8;;',
      'evil.example',
      'titulo',
      '\u0085',
      '\u202e',
      '\u2066',
      'To https',
      '[remote rejected]',
      'failed to push some refs',
      esc,
      bel,
      '\r',
    ]) {
      expect(error.message).not.toContain(resíduo);
    }
  });

  it('passando do teto, a mensagem guarda o fim da saída do hook, e não o começo', () => {
    const stderr = `COMECO-${'x'.repeat(10_000)}-FIM`;

    const error = translateGitWriteError(failure(stderr), 'commit', {
      hookPresent: true,
    }) as GitError;

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('-FIM');
    expect(error.message).not.toContain('COMECO');
    expect(error.message.length).toBeLessThan(4_200);
  });

  it('push com pre-push presente que recusa (saída 1, só "failed to push some refs") é GIT_HOOK_FAILED', () => {
    const error = translateGitWriteError(
      failure("saída do hook\nerror: failed to push some refs to 'x'"),
      'push',
      { hookPresent: true },
    ) as GitError;

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('saída do hook');
    expect(error.message).not.toContain('failed to push some refs');
  });

  it.each([
    [
      'remote: error: refusing to update checked out branch: refs/heads/main',
      ' ! [remote rejected] HEAD -> main (branch is currently checked out)',
    ],
    ['remote: Permission to x denied', ' ! [remote rejected] HEAD -> main (permission denied)'],
    ['', ' ! [rejected]        HEAD -> main (already exists)'],
    ['', ' ! [rejected]        HEAD -> main (stale info)'],
    ['', ' ! [remote rejected] HEAD -> main (shallow update not allowed)'],
  ])(
    'pre-push presente, saída 1 e recusa do servidor que não é de hook (%s / %s): UNKNOWN com mensagem fixa em português',
    (remoteLine, rejectedLine) => {
      const stderr = [
        remoteLine,
        'To /caminho/do/remoto',
        rejectedLine,
        "error: failed to push some refs to '/caminho/do/remoto'",
      ]
        .filter((line) => line !== '')
        .join('\n');

      const error = translateGitWriteError(failure(stderr), 'push', {
        hookPresent: true,
      }) as GitError;

      expect(error.code).toBe('UNKNOWN');
      expect(error.message).toBe('O remoto recusou o envio desta branch.');
    },
  );

  it('pre-push presente, saída 1 e "hook declined" do servidor: continua GIT_HOOK_FAILED', () => {
    const error = translateGitWriteError(
      failure(
        'remote: regra do servidor\nTo /x\n ! [remote rejected] HEAD -> main (pre-receive hook declined)',
      ),
      'push',
      { hookPresent: true },
    ) as GitError;

    expect(error.code).toBe('GIT_HOOK_FAILED');
    expect(error.message).toContain('remote: regra do servidor');
  });

  it('pre-push presente e "! [remote rejected] ... (fetch first)" também é GIT_NOT_FAST_FORWARD', () => {
    const error = translateGitWriteError(
      failure(' ! [remote rejected] HEAD -> main (non-fast-forward)'),
      'push',
      { hookPresent: true },
    ) as GitError;

    expect(error.code).toBe('GIT_NOT_FAST_FORWARD');
  });

  it('a linha "To <endereço>" do Git sai da mensagem de hook, mas a linha "To do: revisar" do hook fica', () => {
    const error = translateGitWriteError(
      failure('To do: revisar o lint\nTo https://servidor/projeto.git\nTo fix, run npm run lint'),
      'commit',
      { hookPresent: true },
    ) as GitError;

    expect(error.message).toContain('To do: revisar o lint');
    expect(error.message).toContain('To fix, run npm run lint');
    expect(error.message).not.toContain('servidor/projeto.git');
  });

  it('ESC com um caractere só (ESC c), CSI de 8 bits e OSC de 8 bits não deixam resíduo visível', () => {
    const esc = String.fromCharCode(27);
    const stderr = [`a${esc}cb`, `c\u009b31md\u009b?25le`, `f\u009d0;titulo\u009cg`, 'fim'].join(
      '\n',
    );

    const error = translateGitWriteError(failure(stderr), 'commit', {
      hookPresent: true,
    }) as GitError;

    expect(error.message).toContain('ab');
    expect(error.message).toContain('cde');
    expect(error.message).toContain('fg');
    expect(error.message).not.toContain('31m');
    expect(error.message).not.toContain('?25l');
    expect(error.message).not.toContain('titulo');
    expect(error.message).not.toContain(esc);
  });

  it('todas as marcas de direção de texto (U+202A a U+202E, U+2066 a U+2069) saem da mensagem', () => {
    const marks = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map(
      (code) => String.fromCodePoint(code),
    );
    const stderr = `a${marks.join('b')}c`;

    const error = translateGitWriteError(failure(stderr), 'commit', {
      hookPresent: true,
    }) as GitError;

    for (const mark of marks) expect(error.message).not.toContain(mark);
    expect(error.message).toContain('abbbbbbbbc');
  });

  it('saída maior que a pré-poda (32 000 caracteres): a mensagem guarda o fim e fica no teto de 4000', () => {
    const stderr = `COMECO-${'x'.repeat(100_000)}-FIM`;

    const error = translateGitWriteError(failure(stderr), 'commit', {
      hookPresent: true,
    }) as GitError;

    expect(error.message).toContain('-FIM');
    expect(error.message).not.toContain('COMECO');
    const output = error.message.split('\n\n')[1] ?? '';
    expect(Array.from(output).length).toBeLessThanOrEqual(4_001);
  });

  it('o stderr bruto não vai para a mensagem de erros que não são de hook', () => {
    const error = translateGitWriteError(
      failure('fatal: Authentication failed for https://usuario:segredo@x.invalid/a.git/'),
      'push',
    ) as GitError;

    expect(error.message).not.toContain('segredo');
  });

  it('o que não reconhece sobe como veio', () => {
    const unknown = failure('fatal: algo que ninguém previu');

    expect(translateGitWriteError(unknown, 'commit')).toBe(unknown);
  });
});
