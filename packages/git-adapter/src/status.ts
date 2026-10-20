import { GitError, runGit } from './run-git';

/** Estado de um repositório, só para leitura. */
export type GitStatus = {
  /** Branch atual. Em HEAD destacado é `HEAD`: o Git não aceita uma branch com esse nome. */
  branch: string;
  /** Commit em que a árvore de trabalho está, inteiro. */
  baseCommit: string;
  /** Arquivos com alteração: modificados, preparados, novos e removidos. Um renomeado conta uma vez. */
  changedFiles: number;
  isDirty: boolean;
};

/**
 * Lê o formato `--porcelain=v2 --branch -z`: registros separados por NUL. Os que começam com `# `
 * são cabeçalhos da branch. Os demais são um arquivo cada (`1` alterado, `2` renomeado ou copiado,
 * `u` em conflito, `?` novo). O `2` traz o caminho antigo no campo seguinte, que não é um registro.
 */
function parseStatus(output: string): GitStatus {
  let oid: string | undefined;
  let head: string | undefined;
  let changedFiles = 0;

  const fields = output.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    if (field === '') continue;
    if (field.startsWith('# branch.oid ')) {
      oid = field.slice('# branch.oid '.length);
    } else if (field.startsWith('# branch.head ')) {
      head = field.slice('# branch.head '.length);
    } else if (!field.startsWith('# ')) {
      changedFiles += 1;
      if (field.startsWith('2 ')) index += 1;
    }
  }

  if (oid === undefined || head === undefined) {
    throw new GitError('UNKNOWN', 'O Git devolveu um status que o Project Hub não entende.');
  }
  if (oid === '(initial)') {
    throw new GitError('UNKNOWN', 'O repositório ainda não tem nenhum commit.');
  }
  return {
    branch: head === '(detached)' ? 'HEAD' : head,
    baseCommit: oid,
    changedFiles,
    isDirty: changedFiles > 0,
  };
}

/**
 * Diz se a árvore de trabalho em `path` tem arquivos que o Git ignora (`.env`, `node_modules`,
 * saídas de build). Leitura à parte de `getStatus`, que não os lista: o `git worktree remove` os
 * apaga junto com a pasta. No formato `--porcelain=v2 -z`, cada ignorado é um registro `! <caminho>`
 * (uma pasta inteira ignorada vem como um registro só). O campo que segue um registro `2 ` é o
 * caminho antigo de um renomeado, e não um registro: um nome antigo que comece com `! ` não conta.
 *
 * O `--untracked-files=normal` é explícito porque o `status.showUntrackedFiles=no` da configuração
 * do repositório faz o `--ignored` não listar nada, e um repositório de terceiros (seção 17.1) pode
 * trazer essa configuração: sem o argumento, um `.env` ignorado passaria despercebido. `getStatus`
 * já passa o seu `--untracked-files=all` pelo mesmo motivo.
 */
export async function hasIgnoredFiles(
  path: string,
  options: { gitBinary?: string | undefined } = {},
): Promise<boolean> {
  const { stdout } = await runGit(
    ['status', '--porcelain=v2', '--ignored', '--untracked-files=normal', '-z'],
    { cwd: path, gitBinary: options.gitBinary },
  );
  const fields = stdout.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    if (field.startsWith('! ')) return true;
    if (field.startsWith('2 ')) index += 1;
  }
  return false;
}

/**
 * Estado do repositório em `repoPath`, numa só chamada ao Git (RF-GIT-004). Cada arquivo de uma pasta
 * nova conta, e não a pasta. Só lê: o `status` roda sem regravar o índice.
 */
export async function getStatus(
  repoPath: string,
  options: { gitBinary?: string | undefined } = {},
): Promise<GitStatus> {
  const { stdout } = await runGit(
    ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'],
    { cwd: repoPath, gitBinary: options.gitBinary },
  );
  return parseStatus(stdout);
}
