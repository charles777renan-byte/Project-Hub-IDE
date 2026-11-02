import { stat } from 'node:fs/promises';
import { isAbsolute, posix, resolve } from 'node:path';
import { GitError, runGit } from './run-git';
import { runGitWrite } from './run-git-write';

/**
 * Operações de escrita do painel de código-fonte (ADR 0010): stage, commit, push, pull e fetch na pasta
 * do projeto. Cada função monta uma das formas fixas de `runGitWrite` (que recusa qualquer outra e já
 * passa por `withLockAwareness`) e traduz a falha do Git num código estável com mensagem em português.
 *
 * Nenhuma função monta comando a partir de texto da tela: o renderer escolhe a operação e informa
 * caminhos ou a mensagem do commit; o nome da branch é lido do repositório, aqui no processo principal.
 */

export type WriteOptions = {
  /** Pasta do projeto, onde o Git roda. */
  repo: string;
  /** Executável do Git. O padrão é `git`, procurado no PATH. */
  gitBinary?: string | undefined;
};

/** Qual operação falhou. A mensagem de alguns erros muda com ela. */
export type WriteContext = 'stage' | 'commit' | 'push' | 'pull' | 'fetch';

/** Maior mensagem de commit que `runGitWrite` aceita (ADR 0010). */
const MAX_COMMIT_MESSAGE_CHARS = 10_000;
/** Teto da saída do hook que entra na mensagem de erro. */
const MAX_HOOK_OUTPUT_CHARS = 4_000;

/** Hooks que podem recusar um commit e um push, e a operação a que cada grupo pertence. */
const HOOKS: Readonly<Partial<Record<WriteContext, readonly string[]>>> = {
  commit: ['pre-commit', 'prepare-commit-msg', 'commit-msg'],
  push: ['pre-push'],
};

const IDENTITY_MESSAGE =
  'Antes de fazer o commit, configure seu nome e seu e-mail no Git: git config --global user.name "Seu nome" e git config --global user.email "voce@exemplo.com".';
const AUTH_MESSAGE =
  'O Git pediu usuário e senha, e o Project Hub não consegue digitá-los. Entre no remoto pelo terminal ou configure uma credencial do Git (por exemplo, o Git Credential Manager) e tente de novo.';
const NOTHING_TO_COMMIT_MESSAGE =
  'Não há nada em stage para commitar. Adicione ao stage os arquivos que entram no commit.';
const DETACHED_HEAD_MESSAGE =
  'O repositório não está em nenhuma branch (HEAD solto). Volte para uma branch pelo terminal e tente de novo.';
const NO_COMMIT_MESSAGE =
  'A branch ainda não tem nenhum commit, então não há o que enviar. Faça o primeiro commit e envie de novo.';
const NOT_FAST_FORWARD_MESSAGES = {
  push: 'O remoto tem commits que a sua branch não tem, e o envio foi recusado. Resolva no terminal (git pull, com merge ou rebase) e envie de novo.',
  pull: 'A sua branch e a do remoto divergiram, então ela não pode avançar sozinha. Resolva no terminal (merge ou rebase).',
} as const;

function validationError(message: string): GitError {
  return new GitError('VALIDATION_FAILED', message);
}

/** Caminho relativo à pasta do projeto, em POSIX: sem `/` na frente, sem unidade, sem `\` e sem `..`. */
export function isRelativePosixPath(path: string): boolean {
  return (
    path !== '' &&
    !isAbsolute(path) &&
    !path.startsWith('/') &&
    !/^[A-Za-z]:/u.test(path) &&
    !path.includes('\\') &&
    !path.split('/').includes('..')
  );
}

/**
 * Valida os caminhos e devolve os que vão para o Git. Um nome que começa com `-` (`-x`) viraria opção, e
 * `runGitWrite` o recusa; `./-x` é o mesmo arquivo e passa (também em `:0:./-x`).
 */
function checkedPaths(paths: readonly string[]): string[] {
  if (paths.length === 0) throw validationError('Nenhum arquivo foi informado.');
  const bad = paths.find((path) => !isRelativePosixPath(path));
  if (bad !== undefined) {
    throw validationError(`Caminho inválido: "${bad}". Use caminhos relativos à pasta do projeto.`);
  }
  return paths.map((path) => (path.startsWith('-') ? `./${path}` : path));
}

function assertCommitMessage(message: string): void {
  if (message.trim() === '') throw validationError('A mensagem do commit não pode ficar vazia.');
  if (Array.from(message).length > MAX_COMMIT_MESSAGE_CHARS) {
    throw validationError(
      `A mensagem do commit passa de ${MAX_COMMIT_MESSAGE_CHARS.toLocaleString('pt-BR')} caracteres.`,
    );
  }
  if (message.startsWith('-')) {
    throw validationError('A mensagem do commit não pode começar com "-".');
  }
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** OSC (`ESC ] ... BEL` ou `ESC ] ... ESC \`): título de janela e hiperlink. Sai inteira, com o conteúdo. */
const OSC_SEQUENCE = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'gu');
/** CSI (`ESC [ ... letra`), na forma geral: cor, cursor (`ESC[?25l`), apagar linha. */
const CSI_SEQUENCE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'gu');
/** CSI e OSC de 8 bits (U+009B e U+009D): o filtro de C1 deixaria o corpo visível. */
const CSI_8BIT = /\u009b[0-?]*[ -/]*[@-~]/gu;
const OSC_8BIT = new RegExp(`\u009d[^${BEL}\u009c]*(?:${BEL}|\u009c)`, 'gu');
/** Outro `ESC` com um caractere final, e bytes intermediários opcionais (`ESC c`, `ESC =`, `ESC ( B`). */
const SHORT_ESCAPE = new RegExp(`${ESC}[ -/]*[0-~]`, 'gu');
/** Quanto da saída bruta é limpo: o resumo de um hook costuma estar no fim, e a saída pode ter megabytes. */
const MAX_RAW_OUTPUT_CHARS = 32_000;

/** Controles C1 (U+0080 a U+009F) e de direção de texto (U+202A a U+202E, U+2066 a U+2069). */
function isHiddenControl(code: number): boolean {
  return (
    (code >= 0x80 && code <= 0x9f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/**
 * Linhas que são do Git e não do hook: o resumo do push, o endereço do remoto (`To <endereço>`, um token só,
 * como o Git escreve) e a rejeição (` ! [`). Uma linha de hook como `To do: revisar` fica.
 */
function isGitOwnLine(line: string): boolean {
  return (
    /^To \S+$/u.test(line) ||
    line.startsWith(' ! [') ||
    line.startsWith('error: failed to push some refs')
  );
}

/**
 * A saída do hook como cabe numa mensagem. É conteúdo não confiável (seção 17.1), então: pega só o fim da
 * saída bruta, remove sequências de escape (CSI, OSC), controles, C1 e direção de texto, troca `\r` por
 * quebra de linha, descarta as linhas do próprio Git e fica com os últimos `MAX_HOOK_OUTPUT_CHARS`
 * caracteres.
 */
function hookOutputForMessage(output: string): string {
  const tail = Array.from(output).slice(-MAX_RAW_OUTPUT_CHARS).join('');
  const text = tail
    .replace(OSC_SEQUENCE, '')
    .replace(OSC_8BIT, '')
    .replace(CSI_8BIT, '')
    .replace(CSI_SEQUENCE, '')
    .replace(SHORT_ESCAPE, '')
    .replace(/\r\n?/gu, '\n');
  const printable = Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (isHiddenControl(code)) return false;
      return char === '\n' || char === '\t' || (code >= 0x20 && code !== 0x7f);
    })
    .join('');
  const clean = printable
    .split('\n')
    .filter((line) => !isGitOwnLine(line))
    .join('\n')
    .trim();
  const chars = Array.from(clean);
  return chars.length <= MAX_HOOK_OUTPUT_CHARS
    ? clean
    : `…${chars.slice(-MAX_HOOK_OUTPUT_CHARS).join('')}`;
}

function hasAny(text: string, patterns: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

const AUTH_PATTERNS = [
  'terminal prompts disabled',
  'could not read Username',
  'Authentication failed',
];
const NOT_FAST_FORWARD_PATTERNS = [
  'non-fast-forward',
  'fetch first',
  'Not possible to fast-forward',
];
const IDENTITY_PATTERNS = [
  'Author identity unknown',
  'Please tell me who you are',
  'unable to auto-detect',
  'auto-detection is disabled',
  'empty ident name',
];
const NOTHING_PATTERNS = [
  'nothing to commit',
  'nothing added to commit',
  'no changes added to commit',
];
const DETACHED_PATTERNS = ['You are not currently on a branch'];
/**
 * A linha com que o Git informa que o envio de uma referência foi recusado: ' ! [rejected]  HEAD -> main
 * (fetch first)' (recusa do cliente) ou ' ! [remote rejected] HEAD -> main (motivo)' (recusa do servidor).
 * O espaço na frente, as duas referências e o motivo entre parênteses são do Git: o hook que imprime só
 * `! [rejected] ...` não casa. Quando o `pre-push` local recusa, o Git não escreve linha nenhuma assim: ele
 * nem chega ao servidor.
 */
const GIT_REJECTION_LINE = /^ ! \[(?:remote )?rejected\]\s+\S+\s+->\s+\S+\s+\((.+)\)\s*$/u;
const REMOTE_REFUSED_MESSAGE = 'O remoto recusou o envio desta branch.';

/** Os motivos das linhas de recusa do Git no `stderr` de um push. */
function rejectionReasons(stderr: string): string[] {
  return stderr
    .split(/\r?\n/u)
    .map((line) => GIT_REJECTION_LINE.exec(line)?.[1])
    .filter((reason): reason is string => reason !== undefined);
}

/**
 * Traduz a falha do Git para o código e a mensagem do painel. Só mexe no erro genérico (`UNKNOWN`) que
 * o Git deu ao terminar com código diferente de zero (`exitCode`); um erro que já tem código próprio
 * (`GIT_LOCKED`, `PERMISSION_DENIED`, `GIT_NOT_AVAILABLE`...) sobe como veio.
 *
 * `hookPresent` diz que existe um hook local da operação (commit: `pre-commit`, `prepare-commit-msg`,
 * `commit-msg`; push: `pre-push`). A saída de um hook é texto de terceiros e pode dizer qualquer coisa
 * (`Authentication failed` num teste que falhou), então com hook presente a saída do hook não passa pelos
 * padrões de texto. Quem decide é o código de saída: o Git sai com 1 quando um hook recusa, e com 128 nos
 * `fatal:` dele (`HEAD.lock`, gpg, objeto não gravado, rede, autenticação).
 *
 * 0. Push, saída 1 e linha de recusa no formato do Git (`GIT_REJECTION_LINE`), com ou sem hook: o motivo decide.
 *    `non-fast-forward` ou `fetch first`: `GIT_NOT_FAST_FORWARD`; `hook declined` (hook do servidor):
 *    `GIT_HOOK_FAILED`; qualquer outro (`branch is currently checked out`, `permission denied`,
 *    `already exists`, `stale info`...): `UNKNOWN` com mensagem fixa, sem o texto do Git.
 * 1. Hook presente e saída 1:
 *    a. o `stdout` ou o `stderr` diz que não há nada para commitar (o Git escreve isso no `stdout`):
 *       `GIT_NOTHING_TO_COMMIT`;
 *    b. todo o resto: `GIT_HOOK_FAILED`, com a saída limpa do hook na mensagem.
 * 2. Qualquer outro caso (sem hook, ou saída diferente de 1): as classes de sempre, lidas só no `stderr`:
 *    autenticação, avanço impossível, HEAD solto, identidade e nada para commitar. Se nada casar, o erro sobe como veio, com a
 *    mensagem fixa em português do adaptador: o texto do Git nunca entra nela.
 *
 * A saída bruta só entra na mensagem de `GIT_HOOK_FAILED`: é a do hook, e é isso que a pessoa precisa ler. Nos
 * demais, a mensagem é fixa, e o `stderr` e o `stdout` ficam só nos campos do erro.
 */
export function translateGitWriteError(
  error: unknown,
  context: WriteContext,
  options: { hookPresent?: boolean } = {},
): unknown {
  if (!(error instanceof GitError) || error.code !== 'UNKNOWN' || error.exitCode === undefined) {
    return error;
  }
  const details = {
    exitCode: error.exitCode,
    stderr: error.stderr,
    stdout: error.stdout,
    cause: error,
  };
  const { stderr, stdout } = error;
  // Um hook pode escrever em qualquer das duas saídas (o `pre-push` escreve no `stdout`).
  const output = [stdout, stderr].filter((text) => text !== '').join('\n');

  if (context === 'push' && error.exitCode === 1) {
    const reasons = rejectionReasons(stderr);
    if (reasons.length > 0) {
      if (reasons.some((reason) => /non-fast-forward|fetch first/u.test(reason))) {
        return notFastForward(context, details);
      }
      if (reasons.some((reason) => /hook declined/iu.test(reason))) {
        return hookFailed(context, output, details);
      }
      return new GitError('UNKNOWN', REMOTE_REFUSED_MESSAGE, details);
    }
  }

  if (options.hookPresent === true && error.exitCode === 1) {
    if (hasAny(output, NOTHING_PATTERNS)) {
      return new GitError('GIT_NOTHING_TO_COMMIT', NOTHING_TO_COMMIT_MESSAGE, details);
    }
    return hookFailed(context, output, details);
  }

  if (hasAny(stderr, AUTH_PATTERNS)) {
    return new GitError('GIT_AUTH_REQUIRED', AUTH_MESSAGE, details);
  }
  if (hasAny(stderr, NOT_FAST_FORWARD_PATTERNS)) return notFastForward(context, details);
  if (hasAny(stderr, DETACHED_PATTERNS)) {
    return new GitError('GIT_DETACHED_HEAD', DETACHED_HEAD_MESSAGE, details);
  }
  if (hasAny(stderr, IDENTITY_PATTERNS)) return new GitError('UNKNOWN', IDENTITY_MESSAGE, details);
  if (hasAny(stderr, NOTHING_PATTERNS)) {
    return new GitError('GIT_NOTHING_TO_COMMIT', NOTHING_TO_COMMIT_MESSAGE, details);
  }
  return error;
}

type TranslatedDetails = { exitCode: number; stderr: string; stdout: string; cause: unknown };

function notFastForward(context: WriteContext, details: TranslatedDetails): GitError {
  const message =
    context === 'pull' ? NOT_FAST_FORWARD_MESSAGES.pull : NOT_FAST_FORWARD_MESSAGES.push;
  return new GitError('GIT_NOT_FAST_FORWARD', message, details);
}

function hookFailed(context: WriteContext, output: string, details: TranslatedDetails): GitError {
  const operation = context === 'push' ? 'o envio' : 'o commit';
  const text = hookOutputForMessage(output);
  const message = `Um hook do Git recusou ${operation}.${text === '' ? '' : `\n\n${text}`}`;
  return new GitError('GIT_HOOK_FAILED', message, details);
}

/** Diz se algum hook de `names` existe no repositório. Respeita `core.hooksPath` (é o Git quem resolve o caminho). */
async function hookExists(options: WriteOptions, names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    try {
      const { stdout } = await runGit(['rev-parse', '--git-path', `hooks/${name}`], {
        cwd: options.repo,
        gitBinary: options.gitBinary,
      });
      // Relativo à pasta do projeto, ou absoluto quando `core.hooksPath` é um caminho absoluto.
      const path = resolve(options.repo, stdout.trim());
      if ((await stat(path)).isFile()) return true;
    } catch {
      // Sem o arquivo (ou sem poder lê-lo) não há hook: a falha segue com o erro original do Git.
    }
  }
  return false;
}

/** Roda a escrita e, se falhar, devolve o erro já traduzido. */
async function write(
  options: WriteOptions,
  args: readonly string[],
  context: WriteContext,
): Promise<void> {
  try {
    await runGitWrite(args, { cwd: options.repo, gitBinary: options.gitBinary });
  } catch (error) {
    const hooks = HOOKS[context];
    const hookPresent =
      error instanceof GitError &&
      error.code === 'UNKNOWN' &&
      error.exitCode === 1 &&
      hooks !== undefined
        ? await hookExists(options, hooks)
        : false;
    throw translateGitWriteError(error, context, { hookPresent });
  }
}

/** Branch atual, lida do repositório. HEAD solto (sem branch) vira `GIT_DETACHED_HEAD`. */
async function currentBranch(options: WriteOptions): Promise<string> {
  const { stdout } = await runGit(['branch', '--show-current'], {
    cwd: options.repo,
    gitBinary: options.gitBinary,
  });
  const branch = stdout.trim();
  if (branch === '') throw new GitError('GIT_DETACHED_HEAD', DETACHED_HEAD_MESSAGE);
  return branch;
}

/** Há um merge em andamento (`MERGE_HEAD`)? `rev-parse --verify --quiet` sai com 1 quando não há. */
async function mergeInProgress(options: WriteOptions): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], {
      cwd: options.repo,
      gitBinary: options.gitBinary,
    });
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

/**
 * Há algo em stage? Lê o `status --porcelain=v2 -z`: nos registros `1` e `2` a coluna X é o estado do
 * índice contra o HEAD, e `.` é "sem mudança". Registro `u` é conflito, que o commit recusa por conta
 * própria. O `commit` sem nada em stage escreve a causa no `stdout`, que o adaptador não guarda; por isso
 * a checagem é feita antes, e não pelo texto do erro.
 */
async function hasStagedChanges(options: WriteOptions): Promise<boolean> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '-z', '--untracked-files=no'], {
    cwd: options.repo,
    gitBinary: options.gitBinary,
  });
  const fields = stdout.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    if (field.startsWith('2 ')) index += 1; // o caminho de origem do renomeado vem num campo à parte
    if ((field.startsWith('1 ') || field.startsWith('2 ')) && field[2] !== '.') return true;
    if (field.startsWith('u ')) return true;
  }
  return false;
}

/**
 * Caminhos em conflito (`u` no `status --porcelain=v2 -z`): o campo é `u XY sub m1 m2 m3 mW h1 h2 h3 <caminho>`,
 * e o caminho vem depois do décimo espaço (pode ter espaços). Nos registros `2` o caminho de origem vem num
 * campo à parte, que não é um registro.
 */
async function unmergedPaths(options: WriteOptions): Promise<Set<string>> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '-z', '--untracked-files=no'], {
    cwd: options.repo,
    gitBinary: options.gitBinary,
  });
  const unmerged = new Set<string>();
  const fields = stdout.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    if (field.startsWith('2 ')) index += 1;
    if (!field.startsWith('u ')) continue;
    let start = 0;
    for (let spaces = 0; spaces < 10; spaces += 1) start = field.indexOf(' ', start) + 1;
    unmerged.add(field.slice(start));
  }
  return unmerged;
}

/**
 * Confere, de uma vez, o que o índice sabe dos `paths` (já validados por `checkedPaths`), com
 * `ls-files -z -- :(literal)<caminho>…`. O prefixo `:(literal)` faz o nome valer como ele é: sem ele, `a[1].txt`
 * casaria `a1.txt`. Pasta não é entrada do índice: o `ls-files` lista os arquivos de dentro dela, e por isso
 * só vale uma linha da saída que seja exatamente o caminho pedido (sem o `./` da frente, que o Git tira).
 * Um arquivo em conflito está no índice, só que em estágios de 1 a 3, e o `restore` o recusa: quem diz que há
 * conflito é o `status`, e não a contagem de linhas do `ls-files`.
 */
async function indexStateOf(
  options: WriteOptions,
  paths: readonly string[],
  requestedPaths: readonly string[],
): Promise<{ untracked: string[]; conflicted: string[] }> {
  const { stdout } = await runGit(
    ['ls-files', '-z', '--', ...paths.map((path) => `:(literal)${path}`)],
    { cwd: options.repo, gitBinary: options.gitBinary },
  );
  const listed = new Set(stdout.split('\0').filter((name) => name !== ''));
  const unmerged = await unmergedPaths(options);
  const untracked: string[] = [];
  const conflicted: string[] = [];
  paths.forEach((path, index) => {
    const requested = requestedPaths[index] ?? path;
    const name = posix.normalize(path);
    if (!listed.has(name)) untracked.push(requested);
    else if (unmerged.has(name)) conflicted.push(requested);
  });
  return { untracked, conflicted };
}

/**
 * Põe em stage: os `paths` (`add -- <caminhos>`) ou, sem `paths`, tudo (`add -A`). Os caminhos são nomes
 * de arquivo, nunca padrões. Nome com espaço, acento ou aspas funciona.
 */
export async function stagePaths(
  options: WriteOptions & { paths?: readonly string[] },
): Promise<void> {
  if (options.paths === undefined) return write(options, ['add', '-A'], 'stage');
  const paths = checkedPaths(options.paths);
  return write(options, ['add', '--', ...paths], 'stage');
}

/** Tira do stage os `paths` (`restore --staged -- <caminhos>`). O arquivo no disco não muda. */
export async function unstagePaths(
  options: WriteOptions & { paths: readonly string[] },
): Promise<void> {
  const paths = checkedPaths(options.paths);
  return write(options, ['restore', '--staged', '--', ...paths], 'stage');
}

/**
 * Desfaz as alterações do disco nos `paths` (`restore -- <caminhos>`), voltando ao que está no índice.
 * Só vale para arquivo rastreado e sem conflito: se algum caminho não estiver no índice (pasta incluída) ou
 * estiver em conflito, recusa tudo com `VALIDATION_FAILED`, antes de restaurar qualquer um. Não existe `clean` (ADR 0010).
 */
export async function discardPaths(
  options: WriteOptions & { paths: readonly string[] },
): Promise<void> {
  const paths = checkedPaths(options.paths);
  const { untracked, conflicted } = await indexStateOf(options, paths, options.paths);
  const problems: string[] = [];
  if (untracked.length > 0) {
    problems.push(
      `Só é possível desfazer arquivos que o Git já acompanha. Não acompanhados: ${untracked.join(', ')}.`,
    );
  }
  if (conflicted.length > 0) {
    problems.push(
      `Arquivos em conflito não podem ser desfeitos por aqui. Resolva o conflito antes: ${conflicted.join(', ')}.`,
    );
  }
  if (problems.length > 0) throw validationError(problems.join(' '));
  return write(options, ['restore', '--', ...paths], 'stage');
}

/**
 * Cria um commit com o que está em stage (`commit -m <mensagem>`), sem `--amend`, `--no-verify` nem `-a`.
 * Os hooks rodam: se um recusar, nenhum commit é criado, o índice fica como estava e o erro
 * (`GIT_HOOK_FAILED`) traz a saída dele. Devolve o nome completo do commit criado.
 */
export async function commitStaged(
  options: WriteOptions & { message: string },
): Promise<{ commit: string }> {
  assertCommitMessage(options.message);
  // Com um merge em andamento o Git decide se há o que concluir, mesmo sem nada em stage contra o HEAD.
  if (!(await mergeInProgress(options)) && !(await hasStagedChanges(options))) {
    throw new GitError('GIT_NOTHING_TO_COMMIT', NOTHING_TO_COMMIT_MESSAGE);
  }
  await write(options, ['commit', '-m', options.message], 'commit');
  const { stdout } = await runGit(['rev-parse', 'HEAD'], {
    cwd: options.repo,
    gitBinary: options.gitBinary,
  });
  return { commit: stdout.trim() };
}

/**
 * Envia a branch atual com `push -u origin HEAD`. O destino é dado na linha de comando, então `push.default`
 * e `branch.<nome>.pushRemote` não valem; e `HEAD` (e não o nome da branch) é o que o Git não casa com um
 * `remote.origin.push` do repositório, que pode vir de fora (seção 17.1). Conferido com o Git 2.54: com
 * `remote.origin.push = +refs/heads/main:refs/heads/main` (ou `+refs/heads/*:refs/heads/*`), `push origin main`
 * e `push origin refs/heads/main` saem como `(forced update)`, e `push origin HEAD` é recusado se o remoto
 * avançou. A branch é lida do repositório antes (HEAD solto vira `GIT_DETACHED_HEAD`), e sem nenhum commit
 * nela o envio nem começa (`VALIDATION_FAILED`). Nunca força: se o remoto avançou, o erro é
 * `GIT_NOT_FAST_FORWARD`. O `pre-push` roda.
 */
export async function pushBranch(options: WriteOptions): Promise<{ branch: string }> {
  const branch = await currentBranch(options);
  if ((await headOrUndefined(options)) === undefined) {
    throw validationError(NO_COMMIT_MESSAGE);
  }
  await write(options, ['push', '-u', 'origin', 'HEAD'], 'push');
  return { branch };
}

/**
 * Traz os commits do remoto só se a branch puder avançar (`pull --ff-only`): nunca cria commit de merge.
 * Branch divergida vira `GIT_NOT_FAST_FORWARD`. `updated` diz se o HEAD mudou.
 */
export async function pullFastForward(options: WriteOptions): Promise<{ updated: boolean }> {
  await currentBranch(options);
  const before = await headOrUndefined(options);
  await write(options, ['pull', '--ff-only'], 'pull');
  return { updated: before !== (await headOrUndefined(options)) };
}

/** Atualiza as refs remotas e poda as apagadas (`fetch --prune origin`). Não mexe na branch local. */
export async function fetchOrigin(options: WriteOptions): Promise<void> {
  return write(options, ['fetch', '--prune', 'origin'], 'fetch');
}

async function headOrUndefined(options: WriteOptions): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(['rev-parse', 'HEAD'], {
      cwd: options.repo,
      gitBinary: options.gitBinary,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}
