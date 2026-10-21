import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GitError } from './run-git';

/**
 * Esperas, em milissegundos, entre as tentativas de um comando que falhou com `index.lock` no
 * repositório. Outro processo do Git (a IDE, um `git status` em segundo plano) costuma segurar a
 * trava por frações de segundo, então poucas esperas curtas bastam: passando delas, a trava é de
 * alguém que vai demorar, e quem decide é a pessoa.
 */
export const INDEX_LOCK_RETRY_DELAYS_MS: readonly number[] = [200, 400, 800];

const NO_REASON = 'sem motivo informado';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
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
 * Pasta administrativa do Git de `dir`. Num repositório comum é a própria `<dir>/.git`. Num worktree
 * ligado, `.git` é um arquivo com a linha `gitdir: <caminho>`, e o caminho (que pode ser relativo à
 * pasta do worktree) aponta para `<repo>/.git/worktrees/<nome>`, onde o Git guarda o arquivo
 * `locked`. Sem `.git`, ou com um `.git` que não aponta para lugar nenhum, devolve `undefined`.
 */
export async function gitAdminDir(dir: string): Promise<string | undefined> {
  const dotGit = join(dir, '.git');
  if (await isDirectory(dotGit)) return dotGit;
  try {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'));
    return match?.[1] === undefined ? undefined : resolve(dir, match[1]);
  } catch {
    return undefined;
  }
}

/**
 * Motivo da trava do worktree em `dir`, o texto do arquivo `locked` que o `git worktree lock` grava,
 * ou `undefined` se ele não está travado. Uma trava sem `--reason` deixa o arquivo vazio. Erro de
 * leitura conta como "sem trava": esta checagem só existe para dar uma mensagem melhor, e o Git
 * continua sendo quem recusa de fato.
 */
export async function adminLockReason(dir: string): Promise<string | undefined> {
  const admin = await gitAdminDir(dir);
  if (admin === undefined) return undefined;
  try {
    const reason = (await readFile(join(admin, 'locked'), 'utf8')).trim();
    return reason === '' ? NO_REASON : reason;
  } catch {
    return undefined;
  }
}

async function refuseIfWorktreeLocked(worktree: string | undefined): Promise<void> {
  if (worktree === undefined) return;
  const reason = await adminLockReason(worktree);
  if (reason !== undefined) {
    throw new GitError(
      'GIT_LOCKED',
      `O worktree está travado pelo Git (${reason}). Destrave-o e tente de novo.`,
    );
  }
}

/** A falha do Git que cita `index.lock` no `stderr`. Qualquer outra não é desta trava. */
function isIndexLockFailure(error: unknown): error is GitError {
  return error instanceof GitError && error.stderr.includes('index.lock');
}

async function indexLockExists(repo: string): Promise<boolean> {
  const admin = await gitAdminDir(repo);
  return admin !== undefined && (await exists(join(admin, 'index.lock')));
}

/**
 * Roda `run` sabendo explicar as duas travas do Git, sem nunca forçar nenhuma (destravar é ação da
 * pessoa):
 *
 * 1. worktree travado (`git worktree lock`): o Git recusa remover, mas com uma mensagem seca. Com
 *    `targets.worktree`, a trava é conferida antes de rodar, sem criar processo, e de novo se o
 *    comando falhar, caso ela tenha surgido no meio. Vira GIT_LOCKED com o motivo;
 * 2. `index.lock` no repositório: outro processo do Git está escrevendo o índice. Só conta como
 *    esta trava a falha que é um GitError com `index.lock` no `stderr` E com o arquivo presente na
 *    pasta administrativa. O arquivo sozinho não basta: ele pode existir por um instante e a falha
 *    ser outra, como a recusa tardia do `git worktree remove` por alteração não salva, e relabelar
 *    essa falha esconderia a causa verdadeira de quem a classifica pelo `stderr`. Sendo a trava,
 *    espera e tenta de novo, nos tempos de `delaysMs`. Se ela persistir depois da última espera,
 *    vira GIT_LOCKED, com `stderr` e `exitCode` copiados do erro do Git e o erro em `cause`.
 *
 * Só a recusa do worktree travado (`git worktree lock`, GIT_LOCKED) foi verificada contra o Git de
 * verdade. A nova tentativa do `index.lock` é defensiva e NÃO foi observada para `worktree add` nem
 * `worktree remove`: com `.git/index.lock` presente, os dois saem com código 0 no Git 2.54.0, então
 * ela pode nunca rodar (ADR 0008).
 *
 * Qualquer outra falha sobe como veio, sem esperar. O `stderr` em inglês é estável porque o
 * adaptador fixa `LC_ALL=C`. `sleep` existe para os testes não esperarem de verdade.
 */
export async function withLockAwareness<T>(
  targets: { repo: string; worktree?: string },
  run: () => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? INDEX_LOCK_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

  await refuseIfWorktreeLocked(targets.worktree);
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      await refuseIfWorktreeLocked(targets.worktree);
      if (!isIndexLockFailure(error) || !(await indexLockExists(targets.repo))) throw error;
      const delay = delaysMs[attempt];
      if (delay === undefined) {
        throw new GitError(
          'GIT_LOCKED',
          'Outro processo do Git está usando o repositório. Feche-o e tente de novo.',
          { exitCode: error.exitCode, stderr: error.stderr, cause: error },
        );
      }
      await sleep(delay);
    }
  }
}
