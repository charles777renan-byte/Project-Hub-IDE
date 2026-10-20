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
 * Estado do repositório em `repoPath`, numa só chamada ao Git (RF-GIT-004). Cada arquivo de uma pasta
 * nova conta, e não a pasta. Arquivo ou pasta ignorado pelo Git (`.env`, `node_modules`) não conta
 * (R198). Só lê: o `status` roda sem regravar o índice.
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
