import { isRelativePosixPath } from './git-write';
import { GitError, isOperand, LOG_FORMAT, MAX_LOG_ENTRIES, runGit } from './run-git';

/**
 * Leituras do painel de código-fonte (ADR 0010): estado, log, alterações da branch e diff contra a base.
 * Todas passam por `runGit` (só leitura, formas exatas) e devolvem dados simples. O texto bruto do Git nunca
 * entra na mensagem de um erro: uma saída que o painel não entende vira um `GitError` com texto fixo.
 */

export type ReadOptions = {
  /** Pasta do projeto, onde o Git roda. */
  repo: string;
  /** Executável do Git. O padrão é `git`, procurado no PATH. */
  gitBinary?: string | undefined;
};

/** Estado no stage: o índice contra o HEAD. `R` é renomeado (o caminho é o novo). */
export type StagedState = 'M' | 'A' | 'D' | 'R';
/** Estado fora do stage: a pasta de trabalho contra o índice. `U` é um arquivo que o Git ainda não acompanha. */
export type UnstagedState = 'M' | 'D' | 'U';

export type PanelFile = {
  /** Caminho relativo à pasta do projeto, como o Git o escreve. */
  path: string;
  staged: StagedState | null;
  unstaged: UnstagedState | null;
};

export type GitPanelStatus = {
  /** Branch atual; `null` com o HEAD destacado. */
  branch: string | null;
  /** Branch remota que a atual acompanha (por exemplo `origin/main`), ou `null`. */
  upstream: string | null;
  /** Commits à frente e atrás do upstream; `null` sem upstream ou quando a ref remota sumiu. */
  ahead: number | null;
  behind: number | null;
  /** Com o que a branch é comparada: o upstream, ou `origin/main`; `null` quando nenhum dos dois existe. */
  baseRef: string | null;
  /** Linhas somadas e removidas em relação à base (arquivos binários não contam); `null` sem base. */
  linesAdded: number | null;
  linesRemoved: number | null;
  files: PanelFile[];
};

export type BranchLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  /** Data do autor em ISO 8601 (`2026-11-02T18:51:40-03:00`). */
  date: string;
  /** Etiquetas do commit, como o Git as escreve: `HEAD -> main`, `tag: v1.0`, `origin/main`. */
  refs: string[];
  subject: string;
};

export type BranchChangeStatus = 'M' | 'A' | 'D';

export type BranchChangeFile = {
  path: string;
  status: BranchChangeStatus;
  /** Linhas somadas e removidas; `null` em arquivo binário. */
  added: number | null;
  removed: number | null;
};

export type BranchChanges = {
  baseRef: string | null;
  /** Ponto de partida da branch em relação à base; `null` sem base ou sem ancestral comum. */
  mergeBase: string | null;
  files: BranchChangeFile[];
};

export type FileDiffAgainstBase = {
  path: string;
  baseRef: string;
  /** Só os trechos (`@@`), em diff unificado. Vazio em binário e em arquivo sem mudança. */
  patch: string;
  binary: boolean;
  /** O patch passou do limite, e vem só o começo. */
  truncated: boolean;
};

/** Bytes de patch por arquivo. */
const DEFAULT_MAX_PATCH_BYTES = 256 * 1024;
/** A base, quando a branch não tem upstream (a "branch padrão" fica como `main` até haver leitura de `origin/HEAD`). */
const DEFAULT_BASE_REF = 'origin/main';
/**
 * Opções de todo `git diff` do painel. `--no-renames` mantém a lista sem heurística (um renomeado é um apagado e
 * um criado); `--no-ext-diff` e `--no-textconv` desligam programas que o repositório configura (seção 17.1).
 */
const DIFF_FLAGS = ['--no-renames', '--no-ext-diff', '--no-textconv', '--no-color'];

function unreadable(what: string): GitError {
  return new GitError('UNKNOWN', `O Git devolveu ${what} que o Project Hub não entende.`);
}

/** O que vem depois do `count`-ésimo espaço: o caminho de um registro do status, que pode ter espaços. */
function afterSpaces(field: string, count: number): string {
  let start = 0;
  for (let spaces = 0; spaces < count; spaces += 1) {
    const space = field.indexOf(' ', start);
    if (space === -1) throw unreadable('um status');
    start = space + 1;
  }
  return field.slice(start);
}

function stagedState(letter: string | undefined): StagedState | null {
  switch (letter) {
    case '.':
    case undefined:
      return null;
    case 'A':
    case 'C': // cópia: aparece como arquivo novo
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    default:
      return 'M'; // M, T (troca de tipo)
  }
}

function unstagedState(letter: string | undefined): UnstagedState | null {
  switch (letter) {
    case '.':
    case undefined:
      return null;
    case 'D':
      return 'D';
    case 'A': // `git add -N`: o arquivo é novo, e o conteúdo ainda não está no índice
      return 'U';
    default:
      return 'M'; // M, T, R, C
  }
}

export type ParsedStatus = {
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  /** O HEAD aponta para um commit (falso num repositório recém-criado, sem nenhum). */
  hasCommits: boolean;
  files: PanelFile[];
};

/**
 * Lê o `status --porcelain=v2 --branch -z`: registros separados por NUL. Os `# ` são cabeçalhos da branch; os
 * demais são um arquivo cada (`1` alterado, `2` renomeado ou copiado, `u` em conflito, `?` novo, `!` ignorado). O
 * `2` traz o caminho antigo no campo seguinte, que não é um registro. O caminho vai até o fim do campo e pode ter
 * espaços, acento e até quebra de linha (o `-z` não cita nada). Conflito (`u`) entra como `M` fora do stage.
 */
export function parsePorcelainStatus(output: string): ParsedStatus {
  let oid: string | undefined;
  let head: string | undefined;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  const files: PanelFile[] = [];

  const fields = output.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    if (field === '') continue;
    if (field.startsWith('# branch.oid ')) {
      oid = field.slice('# branch.oid '.length);
    } else if (field.startsWith('# branch.head ')) {
      head = field.slice('# branch.head '.length);
    } else if (field.startsWith('# branch.upstream ')) {
      upstream = field.slice('# branch.upstream '.length);
    } else if (field.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/u.exec(field);
      if (match === null) throw unreadable('um status');
      ahead = Number(match[1]);
      behind = Number(match[2]);
    } else if (field.startsWith('1 ')) {
      files.push({
        path: afterSpaces(field, 8),
        staged: stagedState(field[2]),
        unstaged: unstagedState(field[3]),
      });
    } else if (field.startsWith('2 ')) {
      files.push({
        path: afterSpaces(field, 9),
        staged: stagedState(field[2]),
        unstaged: unstagedState(field[3]),
      });
      index += 1; // o caminho de origem do renomeado
    } else if (field.startsWith('u ')) {
      files.push({ path: afterSpaces(field, 10), staged: null, unstaged: 'M' });
    } else if (field.startsWith('? ')) {
      files.push({ path: field.slice(2), staged: null, unstaged: 'U' });
    }
  }

  if (oid === undefined || head === undefined) throw unreadable('um status');
  return {
    branch: head === '(detached)' ? null : head,
    upstream,
    ahead,
    behind,
    hasCommits: oid !== '(initial)',
    files,
  };
}

/** O primeiro candidato que é uma ref de commit. `rev-parse --verify --quiet` sai com 1 quando não existe. */
async function firstExistingRef(
  options: ReadOptions,
  candidates: ReadonlyArray<string | null>,
): Promise<string | null> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate === null || !isOperand(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await runGit(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
        cwd: options.repo,
        gitBinary: options.gitBinary,
      });
      return candidate;
    } catch (error) {
      if (!(error instanceof GitError && error.exitCode === 1)) throw error;
    }
  }
  return null;
}

/**
 * A base do painel e o ponto de partida da branch em relação a ela. A base é o upstream; sem upstream (ou com a
 * ref remota apagada), `origin/main`; sem nenhum dos dois, não há base. `merge-base` sai com 1 quando os
 * históricos não têm ancestral comum: `mergeBase` fica `null`, e isso não é erro.
 */
async function resolveBase(
  options: ReadOptions,
  parsed: Pick<ParsedStatus, 'upstream' | 'hasCommits'>,
): Promise<{ baseRef: string | null; mergeBase: string | null }> {
  if (!parsed.hasCommits) return { baseRef: null, mergeBase: null };
  const baseRef = await firstExistingRef(options, [parsed.upstream, DEFAULT_BASE_REF]);
  if (baseRef === null) return { baseRef: null, mergeBase: null };
  try {
    const { stdout } = await runGit(['merge-base', 'HEAD', baseRef], {
      cwd: options.repo,
      gitBinary: options.gitBinary,
    });
    const mergeBase = stdout.trim();
    return { baseRef, mergeBase: mergeBase === '' ? null : mergeBase };
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return { baseRef, mergeBase: null };
    throw error;
  }
}

/** Só o cabeçalho da branch: o status sem olhar a pasta de trabalho atrás de arquivos novos. */
async function readBranchHeader(options: ReadOptions): Promise<ParsedStatus> {
  const { stdout } = await runGit(
    ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=no'],
    { cwd: options.repo, gitBinary: options.gitBinary },
  );
  return parsePorcelainStatus(stdout);
}

type NumstatRecord = { path: string; added: number | null; removed: number | null };

/** Lê o `--numstat -z --no-renames`: `adicionadas⇥removidas⇥caminho` por arquivo. Binário vem com `-`. */
function parseNumstat(output: string): NumstatRecord[] {
  const records: NumstatRecord[] = [];
  for (const record of output.split('\0')) {
    if (record === '') continue;
    const first = record.indexOf('\t');
    const second = record.indexOf('\t', first + 1);
    if (first === -1 || second === -1) throw unreadable('um diff');
    const added = record.slice(0, first);
    const removed = record.slice(first + 1, second);
    records.push({
      path: record.slice(second + 1),
      added: added === '-' ? null : Number(added),
      removed: removed === '-' ? null : Number(removed),
    });
  }
  return records;
}

/** Lê o `--name-status -z --no-renames`: pares `estado NUL caminho`. */
function parseNameStatus(output: string): Array<{ path: string; status: BranchChangeStatus }> {
  const fields = output.split('\0');
  const records: Array<{ path: string; status: BranchChangeStatus }> = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const letter = (fields[index] ?? '').charAt(0);
    const path = fields[index + 1] ?? '';
    if (letter === '' || path === '') continue;
    records.push({ path, status: letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M' });
  }
  return records;
}

/** Os arquivos que a pasta de trabalho mudou desde `mergeBase`, com o estado e as linhas de cada um. */
async function changesSince(options: ReadOptions, mergeBase: string): Promise<BranchChangeFile[]> {
  const git = { cwd: options.repo, gitBinary: options.gitBinary };
  const nameStatus = await runGit(['diff', '--name-status', '-z', ...DIFF_FLAGS, mergeBase], git);
  const numstat = await runGit(['diff', '--numstat', '-z', ...DIFF_FLAGS, mergeBase], git);
  const lines = new Map(parseNumstat(numstat.stdout).map((record) => [record.path, record]));
  return parseNameStatus(nameStatus.stdout).map(({ path, status }) => ({
    path,
    status,
    added: lines.get(path)?.added ?? null,
    removed: lines.get(path)?.removed ?? null,
  }));
}

function sum(values: ReadonlyArray<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/**
 * O estado do painel de código-fonte: branch, upstream, à frente e atrás, a base, as linhas somadas e removidas
 * em relação a ela e os arquivos alterados (em stage e fora dele). Sem base, `linesAdded` e `linesRemoved` são
 * `null`, sem erro. Só lê (o `status` roda sem regravar o índice).
 */
export async function getGitPanelStatus(options: ReadOptions): Promise<GitPanelStatus> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '--branch', '-z'], {
    cwd: options.repo,
    gitBinary: options.gitBinary,
  });
  const parsed = parsePorcelainStatus(stdout);
  const { baseRef, mergeBase } = await resolveBase(options, parsed);
  const changes = mergeBase === null ? null : await changesSince(options, mergeBase);
  return {
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    baseRef,
    linesAdded: changes === null ? null : sum(changes.map((file) => file.added)),
    linesRemoved: changes === null ? null : sum(changes.map((file) => file.removed)),
    files: parsed.files,
  };
}

/** `limit` como o Git aceita: um inteiro de 1 a 50. Sem número (ou infinito), o máximo. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return MAX_LOG_ENTRIES;
  return Math.min(MAX_LOG_ENTRIES, Math.max(1, Math.floor(limit)));
}

/**
 * Os últimos commits da branch atual, do mais novo para o mais antigo (no máximo 50). O formato é fixo e
 * separado por NUL (`LOG_FORMAT`), então um assunto com `|` ou aspas não quebra a leitura. Repositório sem
 * nenhum commit devolve lista vazia.
 */
export async function getBranchLog(
  options: ReadOptions & { limit?: number },
): Promise<BranchLogEntry[]> {
  let stdout: string;
  try {
    ({ stdout } = await runGit(
      ['log', '-n', String(clampLimit(options.limit)), LOG_FORMAT, '--decorate=short'],
      { cwd: options.repo, gitBinary: options.gitBinary },
    ));
  } catch (error) {
    if (error instanceof GitError && error.stderr.includes('does not have any commits yet')) {
      return [];
    }
    throw error;
  }
  const entries: BranchLogEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const fields = line.split('\0');
    if (fields.length !== 6) throw unreadable('um log');
    const [sha, shortSha, author, date, refs, subject] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    entries.push({
      sha,
      shortSha,
      author,
      date,
      refs: refs === '' ? [] : refs.split(', '),
      subject,
    });
  }
  return entries;
}

/**
 * Os arquivos que a branch mudou desde o ponto de partida (`merge-base`) em relação à base, com o estado e as
 * linhas de cada um. Sem base, ou sem ancestral comum com ela, a lista vem vazia e `baseRef`/`mergeBase`
 * dizem o que faltou, sem erro.
 */
export async function getBranchChanges(options: ReadOptions): Promise<BranchChanges> {
  const parsed = await readBranchHeader(options);
  const { baseRef, mergeBase } = await resolveBase(options, parsed);
  if (mergeBase === null) return { baseRef, mergeBase: null, files: [] };
  return { baseRef, mergeBase, files: await changesSince(options, mergeBase) };
}

/** Corta o texto no limite de bytes, na última quebra de linha inteira. */
function limitText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return { text, truncated: false };
  const cut = bytes.subarray(0, maxBytes).toString('utf8');
  const lastBreak = cut.lastIndexOf('\n');
  return { text: lastBreak === -1 ? cut : cut.slice(0, lastBreak + 1), truncated: true };
}

/** `:(literal)` faz o caminho valer como ele é, sem curinga e sem `:` como sintaxe de pathspec. */
function literal(path: string): string {
  return `:(literal)${path}`;
}

/**
 * O diff de um arquivo contra a base, só os trechos (`@@`), sem o cabeçalho. Binário vem sem prévia. Sem base
 * devolve `null`. O caminho é relativo à pasta do projeto (senão, `VALIDATION_FAILED`).
 */
export async function getFileDiffAgainstBase(
  options: ReadOptions & { path: string; maxBytes?: number },
): Promise<FileDiffAgainstBase | null> {
  if (!isRelativePosixPath(options.path)) {
    throw new GitError(
      'VALIDATION_FAILED',
      `Caminho inválido: "${options.path}". Use caminhos relativos à pasta do projeto.`,
    );
  }
  const parsed = await readBranchHeader(options);
  const { baseRef, mergeBase } = await resolveBase(options, parsed);
  if (baseRef === null || mergeBase === null) return null;

  const { stdout } = await runGit(
    ['diff', mergeBase, '--patch', ...DIFF_FLAGS, '--', literal(options.path)],
    { cwd: options.repo, gitBinary: options.gitBinary },
  );
  const hunks = /^@@/mu.exec(stdout);
  if (hunks === null) {
    const binary = /^Binary files .* differ$/mu.test(stdout) || stdout.includes('GIT binary patch');
    return { path: options.path, baseRef, patch: '', binary, truncated: false };
  }
  const limited = limitText(stdout.slice(hunks.index), options.maxBytes ?? DEFAULT_MAX_PATCH_BYTES);
  return {
    path: options.path,
    baseRef,
    patch: limited.text,
    binary: false,
    truncated: limited.truncated,
  };
}
