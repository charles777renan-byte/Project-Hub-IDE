import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { failure, type RepositoryInitializer } from '@project-hub/application';
import type { AppResult, RepositoryInitPreview } from '@project-hub/contracts';
import { GitError, runGit, runGitInitRepository } from './run-git';

/** Mensagem do primeiro commit. Igual em todo repositório criado pelo aplicativo (ADR 0009). */
export const INITIAL_COMMIT_MESSAGE = 'Estado inicial do projeto';

/**
 * Conteúdo do `.gitignore` que o aplicativo cria quando a pasta não tem um (ADR 0009). Os nomes sensíveis ficam
 * de fora do primeiro commit por padrão; `findSensitiveFiles` usa a mesma lista de nomes.
 */
export const DEFAULT_GITIGNORE = ['node_modules/', '.env', '.env.*', '*.pem', '*.key', 'dist/', ''].join(
  '\n',
);

const IDENTITY_MESSAGE =
  'Antes de criar o repositório, configure seu nome e seu e-mail no Git: git config --global user.name "Seu nome" e git config --global user.email "voce@exemplo.com".';
const CREATE_FAILED = 'Não foi possível criar o repositório Git. A pasta voltou como estava.';
/** Pastas que a busca por arquivos sensíveis não entra: são do Git ou dependências, não código do projeto. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['.git', 'node_modules']);
const MAX_SCANNED_ENTRIES = 20_000;
const MAX_SENSITIVE_FILES = 50;

/** Nome sensível: `.env` e `.env.*`, certificados `*.pem` e chaves `*.key`. */
function isSensitiveName(name: string): boolean {
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.pem') || name.endsWith('.key');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lista os arquivos com nome sensível da pasta, em largura, sem entrar em `.git` nem em `node_modules` e sem
 * seguir links. Para em `MAX_SCANNED_ENTRIES` entradas. Os caminhos saem relativos, com `/`.
 */
export async function findSensitiveFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending: string[] = [''];
  let scanned = 0;
  while (pending.length > 0 && found.length < MAX_SENSITIVE_FILES && scanned < MAX_SCANNED_ENTRIES) {
    const relativeDir = pending.shift() ?? '';
    const entries = await readdir(join(root, relativeDir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      scanned += 1;
      const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(relativePath);
      } else if (entry.isFile() && isSensitiveName(entry.name)) {
        found.push(relativePath);
        if (found.length >= MAX_SENSITIVE_FILES) break;
      }
    }
  }
  return found;
}

/** Diz se `user.name` e `user.email` têm valor. A chave ausente sai com código 1, e isso é "não configurado". */
async function identityConfigured(path: string, gitBinary: string | undefined): Promise<boolean> {
  for (const key of ['user.name', 'user.email']) {
    try {
      const { stdout } = await runGit(['config', '--get', key], { cwd: path, gitBinary });
      if (stdout.trim() === '') return false;
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1) return false;
      throw error;
    }
  }
  return true;
}

/** O que a confirmação mostra. Não escreve nada: só lê a identidade, o `.gitignore` e os nomes da pasta. */
export async function previewRepositoryInit(
  path: string,
  gitBinary?: string,
): Promise<RepositoryInitPreview> {
  return {
    identityConfigured: await identityConfigured(path, gitBinary),
    createsGitignore: !(await exists(join(path, '.gitignore'))),
    sensitiveFiles: await findSensitiveFiles(path),
  };
}

/**
 * Cria o repositório da pasta com o primeiro commit (ADR 0009): `init` na branch `main`, `add --all` e o commit
 * sem hooks. Antes de tudo confere que não há `.git` e que a identidade está configurada. Se um passo falhar, remove
 * o `.git` e o `.gitignore` que este processo criou, e a pasta volta como estava.
 */
export async function initRepository(options: {
  path: string;
  gitBinary?: string | undefined;
}): Promise<void> {
  const { path, gitBinary } = options;
  const gitDir = join(path, '.git');
  if (await exists(gitDir)) {
    throw new GitError('UNKNOWN', 'Já existe uma pasta .git aqui. O Project Hub não a altera.');
  }
  if (!(await identityConfigured(path, gitBinary))) {
    throw new GitError('UNKNOWN', IDENTITY_MESSAGE);
  }

  const gitignore = join(path, '.gitignore');
  const createdGitignore = !(await exists(gitignore));
  if (createdGitignore) await writeFile(gitignore, DEFAULT_GITIGNORE, { flag: 'wx' });

  const run = { cwd: path, gitBinary };
  try {
    await runGitInitRepository(['init', '--initial-branch=main'], run);
    await runGitInitRepository(['add', '--all'], run);
    await runGitInitRepository(
      ['commit', '--no-verify', '--allow-empty', '-m', INITIAL_COMMIT_MESSAGE],
      run,
    );
  } catch (error) {
    // O `.git` não existia quando a função começou, então é do processo: pode sair sem risco.
    await rm(gitDir, { recursive: true, force: true }).catch(() => undefined);
    if (createdGitignore) await rm(gitignore, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Converte a falha do adaptador no resultado da aplicação, com o código e a mensagem seguros para exibir. */
function asFailure(error: unknown): AppResult<never> {
  if (error instanceof GitError) return failure(error.code, error.message);
  return failure('UNKNOWN', CREATE_FAILED);
}

/** Implementação da porta `RepositoryInitializer`, para a composição do processo principal. */
export function createRepositoryInitializer(
  options: { gitBinary?: string | undefined } = {},
): RepositoryInitializer {
  const { gitBinary } = options;
  return {
    async preview(path) {
      try {
        return { ok: true, data: await previewRepositoryInit(path, gitBinary) };
      } catch (error) {
        return asFailure(error);
      }
    },
    async init(path) {
      try {
        await initRepository({ path, gitBinary });
        return { ok: true, data: { defaultBranch: 'main' } };
      } catch (error) {
        return asFailure(error);
      }
    },
  };
}
