import { execFileSync } from 'node:child_process';

/**
 * Variáveis que apontam o Git para um repositório. Se o processo de teste herdou uma delas, a consulta
 * leria o repositório dela, e não o que o teste passou.
 */
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

function git(cwd: string, args: string[]): string {
  const env = { ...process.env };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return execFileSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Nome do objeto (o commit inteiro, para HEAD e branches) a que `ref` aponta. Rejeita se não existe. */
export function revParse(repoPath: string, ref: string): string {
  return git(repoPath, ['rev-parse', '--verify', ref]);
}

/**
 * Diz se há uma branch local com esse nome. Tag e branch remota não contam. Qualquer falha que não
 * seja "não existe" (por exemplo, a pasta não ser um repositório) rejeita, em vez de virar `false`.
 */
export function branchExists(repoPath: string, branch: string): boolean {
  try {
    git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch (error) {
    // `--quiet` sai com 1, sem mensagem, quando a referência não existe.
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}
