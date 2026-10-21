import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { GitError, runGit } from './run-git';

/** Como o arquivo aparece no diff: `untracked` é um arquivo que ainda não entrou no Git. */
export type WorktreeFileStatus = 'added' | 'modified' | 'deleted' | 'untracked';

export type WorktreeDiffFile = {
  /** Caminho relativo à raiz do worktree, como o Git o escreve. */
  path: string;
  status: WorktreeFileStatus;
  added: number;
  removed: number;
  /** Arquivo binário: não há prévia do conteúdo. */
  binary: boolean;
  /** O conteúdo passou do limite, e a prévia mostra só o começo. */
  truncated: boolean;
  /** Diff unificado, só com os trechos (`@@`). Ausente em binário e quando o arquivo não pode ser lido. */
  patch?: string;
};

export type WorktreeDiff = {
  files: WorktreeDiffFile[];
  /** Há mais arquivos alterados do que o limite. A lista traz só os primeiros. */
  truncatedFiles: boolean;
};

export type WorktreeDiffOptions = {
  /** Bytes lidos ou comparados por arquivo. Padrão: 256 KiB. */
  maxFileBytes?: number;
  /** Quantos arquivos entram na lista. Padrão: 200. */
  maxFiles?: number;
  /** Executável do Git. O padrão é `git`, procurado no PATH. */
  gitBinary?: string | undefined;
};

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 200;

/**
 * Opções de todo `git diff`. `--no-renames` faz um renomeado aparecer como apagado e criado, o que
 * deixa a lista sem heurística. `--no-ext-diff` e `--no-textconv` são as proteções de `DIFF_READ_OPTIONS`.
 */
const DIFF_FLAGS = ['--no-renames', '--no-ext-diff', '--no-textconv', '--no-color'];

type TrackedRecord = {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
  status: WorktreeFileStatus;
};

/** Lê o `--numstat -z`: um registro por arquivo, `adicionadas⇥removidas⇥caminho`. Binário vem com `-`. */
function parseNumstat(output: string): Array<Omit<TrackedRecord, 'status'>> {
  const records: Array<Omit<TrackedRecord, 'status'>> = [];
  for (const record of output.split('\0')) {
    if (record === '') continue;
    const first = record.indexOf('\t');
    const second = record.indexOf('\t', first + 1);
    if (first === -1 || second === -1) {
      throw new GitError('UNKNOWN', 'O Git devolveu um diff que o Project Hub não entende.');
    }
    const addedText = record.slice(0, first);
    const binary = addedText === '-';
    records.push({
      path: record.slice(second + 1),
      added: binary ? 0 : Number(addedText),
      removed: binary ? 0 : Number(record.slice(first + 1, second)),
      binary,
    });
  }
  return records;
}

/** Lê o `--name-status -z`: pares `estado NUL caminho`, sem renomeações por causa de `--no-renames`. */
function parseNameStatus(output: string): Map<string, WorktreeFileStatus> {
  const fields = output.split('\0');
  const statuses = new Map<string, WorktreeFileStatus>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const letter = (fields[index] ?? '').charAt(0);
    const path = fields[index + 1] ?? '';
    if (letter === '' || path === '') continue;
    statuses.set(path, statusOf(letter));
  }
  return statuses;
}

function statusOf(letter: string): WorktreeFileStatus {
  switch (letter) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    default:
      return 'modified';
  }
}

/** Os arquivos não rastreados do `status -z`: os registros `? caminho`. */
function parseUntracked(output: string): string[] {
  return output
    .split('\0')
    .filter((field) => field.startsWith('? '))
    .map((field) => field.slice(2))
    .sort();
}

/** O diff de um arquivo começa no primeiro trecho. O cabeçalho (`diff --git`, `index`, `---`) fica de fora. */
function hunksOf(patch: string): string {
  const match = /^@@/m.exec(patch);
  return match === null ? '' : patch.slice(match.index);
}

/** Corta o texto no limite de bytes. Corte no meio de um caractere sai como caractere de substituição. */
function limitText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return { text, truncated: false };
  return { text: bytes.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

/** `:(literal)` faz o caminho valer como ele é, sem curinga e sem `:` como sintaxe de pathspec. */
function literal(path: string): string {
  return `:(literal)${path}`;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Lê o começo de um arquivo novo, dentro da pasta do worktree. Um link simbólico nunca é lido, nem
 * o que aponta para dentro, e um caminho que sai da pasta é recusado. Arquivo que sumiu ou não pode
 * ser lido devolve `undefined`: o diff mostra o arquivo sem prévia.
 */
async function readInside(
  worktreePath: string,
  path: string,
  maxBytes: number,
): Promise<{ bytes: Buffer; truncated: boolean } | undefined> {
  const full = join(worktreePath, path);
  try {
    if ((await lstat(full)).isSymbolicLink()) return undefined;
    const [root, real] = await Promise.all([realpath(worktreePath), realpath(full)]);
    if (!isInside(root, real)) return undefined;
    const handle = await open(real, 'r');
    try {
      const { size } = await handle.stat();
      const buffer = Buffer.alloc(Math.min(size, maxBytes));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return { bytes: buffer.subarray(0, bytesRead), truncated: size > maxBytes };
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

async function trackedFile(
  git: { cwd: string; gitBinary: string | undefined },
  record: TrackedRecord,
  maxFileBytes: number,
): Promise<WorktreeDiffFile> {
  const base = {
    path: record.path,
    status: record.status,
    added: record.added,
    removed: record.removed,
  };
  if (record.binary) return { ...base, binary: true, truncated: false };
  const { stdout } = await runGit(
    ['diff', 'HEAD', '--patch', ...DIFF_FLAGS, '--', literal(record.path)],
    git,
  );
  const limited = limitText(hunksOf(stdout), maxFileBytes);
  return { ...base, binary: false, truncated: limited.truncated, patch: limited.text };
}

async function untrackedFile(
  worktreePath: string,
  path: string,
  maxFileBytes: number,
): Promise<WorktreeDiffFile> {
  const base: WorktreeDiffFile = {
    path,
    status: 'untracked',
    added: 0,
    removed: 0,
    binary: false,
    truncated: false,
  };
  const content = await readInside(worktreePath, path, maxFileBytes);
  if (content === undefined) return base;
  if (content.bytes.includes(0)) return { ...base, binary: true };

  // Com o corte, a última linha pode estar pela metade: sai da prévia.
  const lines = content.bytes.toString('utf8').split('\n');
  if (content.truncated) lines.pop();
  else if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return { ...base, truncated: content.truncated };

  const patch = [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');
  return {
    ...base,
    added: lines.length,
    truncated: content.truncated,
    patch: `${patch}\n`,
  };
}

/**
 * Alterações do worktree em relação ao `HEAD`: arquivos rastreados (modificados, adicionados,
 * apagados) e não rastreados. Só lê. O Git roda com a lista de permissão de `runGit`, sem diff
 * externo nem filtro de texto (seção 17.1), e cada arquivo é lido com o limite de `maxFileBytes`.
 */
export async function getWorktreeDiff(
  worktreePath: string,
  options: WorktreeDiffOptions = {},
): Promise<WorktreeDiff> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const git = { cwd: worktreePath, gitBinary: options.gitBinary };

  const numstat = await runGit(['diff', 'HEAD', '--numstat', '-z', ...DIFF_FLAGS], git);
  const nameStatus = await runGit(['diff', 'HEAD', '--name-status', '-z', ...DIFF_FLAGS], git);
  const status = await runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], git);

  const statuses = parseNameStatus(nameStatus.stdout);
  const tracked = parseNumstat(numstat.stdout).map((record) => ({
    ...record,
    status: statuses.get(record.path) ?? 'modified',
  }));
  const untracked = parseUntracked(status.stdout);

  const files: WorktreeDiffFile[] = [];
  for (const record of tracked.slice(0, maxFiles)) {
    files.push(await trackedFile(git, record, maxFileBytes));
  }
  for (const path of untracked.slice(0, Math.max(0, maxFiles - files.length))) {
    files.push(await untrackedFile(worktreePath, path, maxFileBytes));
  }
  return { files, truncatedFiles: tracked.length + untracked.length > maxFiles };
}
