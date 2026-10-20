import type { GitDetector } from '@project-hub/application';
import { GitError, runGit } from './run-git';

/** Branch do remoto `origin` que o Git guarda em `refs/remotes/origin/HEAD`. */
const REMOTE_PREFIX = 'origin/';

/**
 * Diz se `error` é o Git respondendo "esta pasta não é um repositório". Só esse caso vira `none`: o
 * texto está em inglês porque `runGit` fixa `LC_ALL=C`. Outras falhas (Git ausente, tempo esgotado,
 * pasta de outro dono recusada pelo Git) sobem, para a pasta não ser cadastrada como sem Git por engano.
 */
function isNotARepository(error: unknown): boolean {
  return (
    error instanceof GitError &&
    error.exitCode === 128 &&
    error.stderr.includes('not a git repository')
  );
}

/**
 * Uma pasta é Git só quando é a RAIZ de uma árvore de trabalho (R199). Uma subpasta de repositório é
 * tratada como pasta sem Git: sem isto, um repositório de dotfiles na pasta pessoal faria toda pasta
 * abaixo dela entrar como `git`. Worktree vinculado (`.git` como arquivo) e submódulo têm raiz própria
 * e continuam Git.
 *
 * `rev-parse --is-inside-work-tree --show-prefix` imprime duas linhas: `true` e o caminho da pasta
 * relativo à raiz da árvore de trabalho, que é vazio na própria raiz e, por exemplo, `pacote/` numa
 * subpasta. É o Git quem diz o prefixo, e não uma comparação de caminhos (maiúsculas, `\` e `/`,
 * links simbólicos e nomes curtos do Windows deixariam a conta insegura). Dentro de `.git` ou num
 * repositório bare a primeira linha é `false`.
 */
async function isWorkTreeRoot(path: string, gitBinary: string | undefined): Promise<boolean> {
  try {
    const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree', '--show-prefix'], {
      cwd: path,
      gitBinary,
    });
    const [isInside, prefix] = stdout.split(/\r?\n/);
    return isInside === 'true' && prefix === '';
  } catch (error) {
    if (isNotARepository(error)) return false;
    throw error;
  }
}

/** Branch que o remoto `origin` aponta como padrão, ou `undefined` se o repositório não a guarda. */
async function remoteDefaultBranch(
  path: string,
  gitBinary: string | undefined,
): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      cwd: path,
      gitBinary,
    });
    const remote = stdout.trim();
    if (remote.startsWith(REMOTE_PREFIX) && remote.length > REMOTE_PREFIX.length) {
      return remote.slice(REMOTE_PREFIX.length);
    }
    return undefined;
  } catch (error) {
    // Sem origin/HEAD o Git termina com erro: é o caso comum de um repositório sem remoto. Falha em
    // que o Git nem chegou a rodar (ausente, tempo esgotado) não passa por aqui.
    if (error instanceof GitError && error.exitCode !== undefined) return undefined;
    throw error;
  }
}

/** Branch em uso, ou `undefined` em HEAD destacado. */
async function currentBranch(
  path: string,
  gitBinary: string | undefined,
): Promise<string | undefined> {
  const { stdout } = await runGit(['branch', '--show-current'], { cwd: path, gitBinary });
  const branch = stdout.trim();
  return branch === '' ? undefined : branch;
}

/**
 * Detector de Git da porta `GitDetector`. A branch padrão é a que `origin/HEAD` aponta e, sem ela, a
 * branch em uso. Em HEAD destacado e sem remoto não há branch a guardar.
 */
export function createGitDetector(options: { gitBinary?: string | undefined } = {}): GitDetector {
  const { gitBinary } = options;
  return {
    async detect(path) {
      if (!(await isWorkTreeRoot(path, gitBinary))) return { kind: 'none' };

      const defaultBranch =
        (await remoteDefaultBranch(path, gitBinary)) ?? (await currentBranch(path, gitBinary));
      return defaultBranch === undefined ? { kind: 'git' } : { kind: 'git', defaultBranch };
    },
  };
}
