import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRepositoryInitializer } from '../src/index';
import {
  DEFAULT_GITIGNORE,
  INITIAL_COMMIT_MESSAGE,
  initRepository,
  previewRepositoryInit,
} from '../src/init-repository';

// Git de verdade, em pastas temporárias. A identidade vem de um arquivo global de teste, e o global vazio
// simula quem não configurou o Git. Nada do Git de quem roda os testes entra aqui (ADR 0009).
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

const scratch = mkdtempSync(join(tmpdir(), 'project-hub-init-teste-'));
const identityFile = join(scratch, 'com-identidade.gitconfig');
const noIdentityFile = join(scratch, 'sem-identidade.gitconfig');
writeFileSync(identityFile, '[user]\n\tname = Teste Project Hub\n\temail = teste@project-hub.invalid\n');
writeFileSync(noIdentityFile, '');

const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
const savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;

function git(cwd: string, args: string[]): string {
  const env = { ...process.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
}

function trackedFiles(cwd: string): string[] {
  return git(cwd, ['ls-files']).split('\n').filter((line) => line !== '').sort();
}

beforeAll(() => {
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
  restoreEnv('GIT_CONFIG_GLOBAL', savedGlobal);
  restoreEnv('GIT_CONFIG_NOSYSTEM', savedNoSystem);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('criar o repositório com o primeiro commit (Git real)', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'project-hub-pasta-'));
    process.env.GIT_CONFIG_GLOBAL = identityFile;
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  });

  it('cria o repositório na branch main, com um commit, sem o que o .gitignore básico deixa de fora', async () => {
    writeFileSync(join(folder, 'a.txt'), 'olá\n');
    writeFileSync(join(folder, '.env'), 'SEGREDO=1\n');
    mkdirSync(join(folder, 'node_modules'));
    writeFileSync(join(folder, 'node_modules', 'pacote.js'), 'x\n');

    await initRepository({ path: folder });

    expect(git(folder, ['branch', '--show-current']).trim()).toBe('main');
    expect(git(folder, ['log', '--format=%s']).trim()).toBe(INITIAL_COMMIT_MESSAGE);
    expect(trackedFiles(folder)).toEqual(['.gitignore', 'a.txt']);
    expect(readFileSync(join(folder, '.gitignore'), 'utf8')).toBe(DEFAULT_GITIGNORE);
  });

  it('não sobrescreve um .gitignore que já existe', async () => {
    writeFileSync(join(folder, '.gitignore'), 'dist/\n');
    writeFileSync(join(folder, 'a.txt'), 'olá\n');

    await initRepository({ path: folder });

    expect(readFileSync(join(folder, '.gitignore'), 'utf8')).toBe('dist/\n');
    expect(trackedFiles(folder)).toEqual(['.gitignore', 'a.txt']);
  });

  it('faz o commit inicial mesmo numa pasta vazia', async () => {
    await initRepository({ path: folder });

    expect(git(folder, ['log', '--format=%s']).trim()).toBe(INITIAL_COMMIT_MESSAGE);
    expect(trackedFiles(folder)).toEqual(['.gitignore']);
  });

  it('recusa uma pasta que já tem .git, e não a altera', async () => {
    git(folder, ['init', '--initial-branch=main']);

    await expect(initRepository({ path: folder })).rejects.toThrow('Já existe uma pasta .git');
    expect(existsSync(join(folder, '.gitignore'))).toBe(false);
    expect(() => git(folder, ['log'])).toThrow();
  });

  it('sem identidade configurada, não cria nem o repositório nem o .gitignore', async () => {
    process.env.GIT_CONFIG_GLOBAL = noIdentityFile;
    writeFileSync(join(folder, 'a.txt'), 'olá\n');

    await expect(initRepository({ path: folder })).rejects.toThrow('configure seu nome');
    expect(existsSync(join(folder, '.git'))).toBe(false);
    expect(existsSync(join(folder, '.gitignore'))).toBe(false);
  });

  it('a prévia lista os nomes sensíveis e não escreve nada', async () => {
    writeFileSync(join(folder, '.env'), 'SEGREDO=1\n');
    mkdirSync(join(folder, 'config'));
    mkdirSync(join(folder, 'certs'));
    writeFileSync(join(folder, 'config', 'app.key'), 'k\n');
    writeFileSync(join(folder, 'certs', 'server.pem'), 'p\n');
    writeFileSync(join(folder, 'src.ts'), 'export {};\n');
    mkdirSync(join(folder, 'node_modules'));
    writeFileSync(join(folder, 'node_modules', '.env'), 'x\n');

    const preview = await previewRepositoryInit(folder);

    expect(preview.identityConfigured).toBe(true);
    expect(preview.createsGitignore).toBe(true);
    expect([...preview.sensitiveFiles].sort()).toEqual(['.env', 'certs/server.pem', 'config/app.key']);
    expect(existsSync(join(folder, '.git'))).toBe(false);
    expect(existsSync(join(folder, '.gitignore'))).toBe(false);
  });

  it('a prévia avisa quando falta a identidade', async () => {
    process.env.GIT_CONFIG_GLOBAL = noIdentityFile;

    await expect(previewRepositoryInit(folder)).resolves.toMatchObject({
      identityConfigured: false,
    });
  });

  it('a porta devolve o resultado do contrato: a branch criada, ou o erro com código', async () => {
    const initializer = createRepositoryInitializer();

    await expect(initializer.init(folder)).resolves.toEqual({
      ok: true,
      data: { defaultBranch: 'main' },
    });
    await expect(initializer.init(folder)).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN' },
    });
  });
});
