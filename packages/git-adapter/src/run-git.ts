import { execFile, type ExecFileException } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ErrorCode } from '@project-hub/contracts';
import { withLockAwareness } from './git-locks';

const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * Tempo limite de `worktree add` e `worktree remove`. O checkout de um repositório grande leva bem
 * mais que o de uma leitura, e cortá-lo no meio deixaria um worktree pela metade.
 */
const WORKTREE_TIMEOUT_MS = 120_000;
/** Teto da saída. O padrão do Node é 1 MiB, pouco para o `status` de um repositório com muitas alterações. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const NOT_AVAILABLE_MESSAGE = 'Instale o Git e reinicie o Project Hub.';

/**
 * Variáveis que apontam o Git para um repositório. O Git sempre deve olhar para a pasta (`cwd`) que
 * recebeu: com uma delas herdada (repositório de dotfiles, hook), toda pasta pareceria um repositório.
 */
const REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

/**
 * Vai antes do subcomando em toda chamada. O `core.fsmonitor` da configuração de um repositório
 * não confiável (seção 17.1) é um comando que o `git status` executaria; `false` o desliga. Só o
 * adaptador passa `-c`: o do chamador cai na lista de permissão.
 */
const FSMONITOR_OFF = ['-c', 'core.fsmonitor=false'];

/** Chaves de identidade que `config --get` lê. O primeiro commit do repositório criado usa só elas (ADR 0009). */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(['user.name', 'user.email']);

/**
 * Chaves de `config --get` que a leitura aceita, uma por vez: a identidade do commit (ADR 0009) e o endereço
 * do `origin`, que o painel de código-fonte mostra (ADR 0010).
 */
const CONFIG_READ_KEYS: ReadonlySet<string> = new Set([...IDENTITY_KEYS, 'remote.origin.url']);

/** Opções que `symbolic-ref` aceita só para ler. Qualquer outra, como `-d` e `-m`, escreve ou apaga. */
const SYMBOLIC_REF_READ_OPTIONS = new Set(['--short', '-q', '--quiet']);

/**
 * Opções que `diff` aceita. `--no-ext-diff` e `--no-textconv` desligam programas que o repositório
 * configura (seção 17.1): sem eles, um diff externo ou um filtro de texto rodaria comando alheio.
 * `--no-renames` mantém a lista sem heurística de renomeação.
 */
const DIFF_READ_OPTIONS = new Set([
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-renames',
  '--numstat',
  '--name-status',
  '--patch',
  '-z',
]);

/**
 * O formato do `git log` do painel (ADR 0010), fixo: nome inteiro, nome curto, autor, data em ISO 8601,
 * etiquetas (`%D`, sem parênteses) e assunto, separados por NUL (`%x00`), um commit por linha. Nenhum desses
 * campos tem NUL nem quebra de linha (o assunto `%s` já vem numa linha só), então um assunto com `|` ou aspas
 * não quebra a leitura. É o único formato que a lista de permissão aceita.
 */
export const LOG_FORMAT = '--format=%H%x00%h%x00%an%x00%aI%x00%D%x00%s';

/** Quantos commits o `log` do painel lê, no máximo. */
export const MAX_LOG_ENTRIES = 50;

export type RunGitOptions = {
  /** Pasta onde o Git roda. */
  cwd: string;
  /** Executável do Git. O padrão é `git`, procurado no PATH. */
  gitBinary?: string | undefined;
  /** Tempo limite em milissegundos. O padrão é 15000. */
  timeoutMs?: number | undefined;
};

/**
 * Falha ao rodar o Git. Os campos `code` e `message` seguem o `AppError` do contrato (a mensagem é
 * segura para exibir). A saída do Git fica só em `stderr` e `stdout`, e nunca na mensagem, porque pode
 * trazer conteúdo do repositório (seção 17.1), que não é texto confiável. `stdout` só vem preenchido
 * quando o comando falhou depois de escrever nele: um hook `pre-push` que recusa escreve ali, e a
 * mensagem de `GIT_HOOK_FAILED` (git-write.ts) mostra as duas saídas.
 */
export class GitError extends Error {
  readonly code: ErrorCode;
  /** Código de saída do processo, quando o Git chegou a rodar e terminou com erro. */
  readonly exitCode: number | undefined;
  readonly stderr: string;
  /** Saída padrão do processo que falhou. Vazia quando o erro não vem de um processo que terminou. */
  readonly stdout: string;

  constructor(
    code: ErrorCode,
    message: string,
    details: {
      exitCode?: number | undefined;
      stderr?: string | undefined;
      stdout?: string | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'GitError';
    this.code = code;
    this.exitCode = details.exitCode;
    this.stderr = details.stderr ?? '';
    this.stdout = details.stdout ?? '';
  }
}

/**
 * Lista de permissão (RF-GIT-007, seção 11 de docs/regras-subagentes.md): só leitura. `branch` só
 * vale como `branch --show-current`, `symbolic-ref` só na forma de leitura, com um nome e sem as
 * opções que escrevem, e `diff` só contra `HEAD`, com as opções de `DIFF_READ_OPTIONS`.
 * `check-ignore` só vale como `check-ignore -- <caminhos>` (a leitura do `.worktreeinclude`): ao
 * menos um caminho, nenhum vazio, e sem `-z` (que o Git só aceita com `--stdin`), `--stdin`,
 * `--no-index` ou qualquer outra opção. As leituras do painel de código-fonte (ADR 0010) têm uma forma
 * exata cada: `log`, `rev-list`, `merge-base`, `ls-files` e o `diff` contra um commit (ver as funções
 * abaixo); `status` e `rev-parse` seguem abertos como antes. Tudo o que não está aqui é recusado antes de
 * criar um processo. Opções antes do subcomando (`-c`, `-C`, `--exec-path`) também caem: o subcomando
 * precisa ser o primeiro argumento. `worktree list --porcelain` (a lista de worktrees de `listWorktrees`)
 * é a leitura de `worktree`; nenhuma outra forma de `worktree` lê.
 */
function isReadOnly(args: readonly string[]): boolean {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case 'status':
    case 'rev-parse':
      return true;
    case 'branch':
      return rest.length === 1 && rest[0] === '--show-current';
    case 'symbolic-ref': {
      const options = rest.filter((arg) => arg.startsWith('-'));
      const names = rest.filter((arg) => !arg.startsWith('-'));
      return names.length === 1 && options.every((option) => SYMBOLIC_REF_READ_OPTIONS.has(option));
    }
    case 'diff':
      return isDiffRead(rest);
    case 'check-ignore': {
      // Depois do `--` só há caminhos, que o Git lê como arquivos e nunca como opção.
      const [separator, ...paths] = rest;
      return separator === '--' && paths.length > 0 && paths.every((path) => path !== '');
    }
    case 'config': {
      // Só a leitura de chaves conhecidas (`CONFIG_READ_KEYS`), uma por vez.
      const [flag, key, ...extra] = rest;
      return (
        flag === '--get' && key !== undefined && CONFIG_READ_KEYS.has(key) && extra.length === 0
      );
    }
    case 'worktree':
      // Só a lista de worktrees (`listWorktrees`), com `--porcelain` e nada mais. As formas que escrevem
      // são de `runGitWorktree`.
      return rest.length === 2 && rest[0] === 'list' && rest[1] === '--porcelain';
    case 'log':
      return isLogRead(rest);
    case 'rev-list': {
      // `rev-list --left-right --count <ref>...HEAD`: o `<ref>` nunca começa com `-`.
      const [leftRight, count, range, ...extra] = rest;
      return (
        leftRight === '--left-right' &&
        count === '--count' &&
        range !== undefined &&
        range.endsWith('...HEAD') &&
        isOperand(range.slice(0, -'...HEAD'.length)) &&
        extra.length === 0
      );
    }
    case 'merge-base': {
      // `merge-base HEAD <ref>`: sem `--is-ancestor`, `--all` e as demais opções.
      const [head, ref, ...extra] = rest;
      return head === 'HEAD' && isOperand(ref) && extra.length === 0;
    }
    case 'ls-files': {
      // `ls-files -z -- <caminhos>`: depois do `--` só há caminhos, que o Git lê como nomes.
      const [nulSeparated, separator, ...paths] = rest;
      return (
        nulSeparated === '-z' &&
        separator === '--' &&
        paths.length > 0 &&
        paths.every((path) => path !== '')
      );
    }
    default:
      return false;
  }
}

/** O nome inteiro de um commit (SHA-1 ou SHA-256): o que `merge-base` devolve. Nunca começa com `-`. */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/**
 * `diff` tem duas famílias de forma. Contra `HEAD`: as opções de `DIFF_READ_OPTIONS` e, depois de `--`,
 * só caminhos, que o Git lê como arquivos e nunca como opção. Contra a base do painel de código-fonte
 * (ADR 0010): o nome inteiro de um commit (o `merge-base` calculado pelo adaptador, e não um nome de
 * branch) e `HEAD`, nessa ordem, para comparar só o que está commitado (com um operando só o Git compara com a
 * pasta de trabalho). Duas formas exatas: `diff --name-status -z <commit> HEAD` e `diff --numstat -z <commit> HEAD`,
 * uma só das duas listas, com `-z`, sem `--` nem caminhos. O patch de um arquivo só existe contra `HEAD` (a
 * primeira família): a forma `diff <commit> HEAD --patch -- <caminho>` não tem chamador e é recusada.
 * As opções de cada forma saem de `DIFF_READ_OPTIONS`.
 */
function isDiffRead(rest: readonly string[]): boolean {
  const separator = rest.indexOf('--');
  const revisions = separator === -1 ? rest : rest.slice(0, separator);
  const paths = separator === -1 ? undefined : rest.slice(separator + 1);
  const operands = revisions.filter((arg) => !arg.startsWith('-'));
  const options = revisions.filter((arg) => arg.startsWith('-'));
  if (!options.every((option) => DIFF_READ_OPTIONS.has(option))) return false;
  if (operands.length === 1) return operands[0] === 'HEAD';

  const [commit, head, ...extra] = operands;
  if (commit === undefined || !COMMIT_ID.test(commit) || head !== 'HEAD' || extra.length > 0) {
    return false;
  }
  const lists = options.filter((option) => option === '--numstat' || option === '--name-status');
  return lists.length === 1 && options.includes('-z') && paths === undefined;
}

/**
 * `log -n <1 a 50> <LOG_FORMAT> --decorate=short`, nessa ordem e com esses argumentos, sem mais nenhum:
 * `--output` e as demais opções ficam de fora, e a lista não aceita nome de branch.
 */
function isLogRead(rest: readonly string[]): boolean {
  const [flag, count, format, decorate, ...extra] = rest;
  return (
    flag === '-n' &&
    count !== undefined &&
    /^[1-9][0-9]?$/u.test(count) &&
    Number(count) <= MAX_LOG_ENTRIES &&
    format === LOG_FORMAT &&
    decorate === '--decorate=short' &&
    extra.length === 0
  );
}

/** Um argumento que o Git lê como valor: não vazio e sem `-` na frente, que o faria virar opção. */
export function isOperand(arg: string | undefined): arg is string {
  return arg !== undefined && arg !== '' && !arg.startsWith('-');
}

/**
 * Lista de permissão de `runGitWorktree`: as duas formas que escrevem, e nenhuma outra.
 * `worktree add -b <branch> <pasta> <base>` cria uma branch nova e a pasta; `-B` (reescreve uma
 * branch que existe), `--force` e `--detach` caem porque a forma tem exatamente esses argumentos.
 * `worktree remove <pasta>` tem um argumento só, então `--force` não cabe. Nada de `branch -d`,
 * `push`, `fetch`, `pull`, `merge`, `commit`, `reset` ou `clean`. Os valores não começam com `-`,
 * para o Git nunca ler um nome de branch, uma pasta ou uma base como opção.
 */
function isWorktreeWrite(args: readonly string[]): boolean {
  const [command, subcommand, ...rest] = args;
  if (command !== 'worktree') return false;
  switch (subcommand) {
    case 'add': {
      const [flag, branch, path, base] = rest;
      return (
        rest.length === 4 &&
        flag === '-b' &&
        isOperand(branch) &&
        isOperand(path) &&
        isOperand(base)
      );
    }
    case 'remove':
      return rest.length === 1 && isOperand(rest[0]);
    default:
      return false;
  }
}

/**
 * Ambiente do processo: mensagens do Git em inglês (a detecção reconhece "not a git repository" no
 * texto), sem travas opcionais (o `status` não regrava o índice) e sem variáveis de repositório.
 * `extra` são variáveis que o adaptador acrescenta (nunca do chamador) e que vencem as herdadas, mas
 * não as de repositório, que são sempre removidas.
 */
function gitEnvironment(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    LC_ALL: 'C',
    GIT_OPTIONAL_LOCKS: '0',
  };
  // No Windows os nomes de variável não diferenciam maiúsculas: `git_dir` valeria como `GIT_DIR`.
  for (const name of Object.keys(env)) {
    if (REPOSITORY_VARIABLES.includes(name.toUpperCase())) delete env[name];
  }
  return env;
}

type Outcome =
  { error: null; stdout: string } | { error: ExecFileException; stdout: string; stderr: string };

/**
 * Roda o executável sem shell, com os argumentos em array, depois da lista de permissão. Nunca
 * rejeita: devolve o resultado.
 */
function execGit(
  file: string,
  args: readonly string[],
  config: readonly string[],
  options: RunGitOptions,
  env: Readonly<Record<string, string>>,
): Promise<Outcome> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...FSMONITOR_OFF, ...config, ...args],
      {
        cwd: options.cwd,
        env: gitEnvironment(env),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve(error === null ? { error: null, stdout } : { error, stdout, stderr });
      },
    );
  });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function toGitError(
  error: ExecFileException,
  stdout: string,
  stderr: string,
  args: readonly string[],
  options: RunGitOptions,
): Promise<GitError> {
  if (error.code === 'ENOENT') {
    // O Node também responde ENOENT quando a pasta de trabalho não existe: isso não é falta do Git.
    if (!(await isDirectory(options.cwd))) {
      return new GitError(
        'PROJECT_PATH_UNAVAILABLE',
        'A pasta do projeto não existe ou não está acessível.',
        {
          cause: error,
        },
      );
    }
    return new GitError('GIT_NOT_AVAILABLE', NOT_AVAILABLE_MESSAGE, { cause: error });
  }
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new GitError('UNKNOWN', 'A saída do Git passou do limite aceito.', {
      stdout,
      stderr,
      cause: error,
    });
  }
  if (error.killed === true) {
    const seconds = (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000;
    return new GitError('UNKNOWN', `O Git demorou mais de ${seconds} s e foi interrompido.`, {
      stdout,
      stderr,
      cause: error,
    });
  }
  if (typeof error.code === 'number') {
    return new GitError(
      'UNKNOWN',
      `O comando "git ${args[0] ?? ''}" terminou com erro (código ${error.code}).`,
      { exitCode: error.code, stdout, stderr, cause: error },
    );
  }
  return new GitError('UNKNOWN', 'Não foi possível executar o Git.', {
    stdout,
    stderr,
    cause: error,
  });
}

/**
 * Roda o comando que a lista de permissão do chamador já aprovou. É exportada só para o pacote (não
 * entra em `index.ts`): `runGit`, `runGitWorktree`, `runGitInitRepository` e `runGitWrite` chegam
 * aqui, cada uma depois da sua checagem. `config` são `-c chave=valor` que o adaptador acrescenta
 * depois do `-c core.fsmonitor=false`, e `env` são variáveis de ambiente que ele acrescenta; nenhum
 * dos dois vem do chamador.
 */
export async function runApproved(
  args: readonly string[],
  options: RunGitOptions,
  config: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): Promise<{ stdout: string }> {
  const outcome = await execGit(options.gitBinary ?? 'git', args, config, options, env);
  if (outcome.error === null) return { stdout: outcome.stdout };
  throw await toGitError(outcome.error, outcome.stdout, outcome.stderr, args, options);
}

/**
 * Roda um comando de leitura do Git em `options.cwd`, sem shell: o executável recebe os argumentos
 * em array, então nome de pasta ou de branch nunca vira comando. Comando fora da lista de permissão
 * rejeita com PERMISSION_DENIED, sem criar processo. Executável ausente rejeita com
 * GIT_NOT_AVAILABLE, e o aplicativo segue de pé.
 */
export async function runGit(
  args: readonly string[],
  options: RunGitOptions,
): Promise<{ stdout: string }> {
  if (!isReadOnly(args)) {
    throw new GitError(
      'PERMISSION_DENIED',
      'Comando do Git recusado: só são permitidos os de leitura.',
    );
  }
  return runApproved(args, options);
}

/**
 * Lista de permissão de `runGitInitRepository`: os três passos de criar o repositório do primeiro estado
 * (ADR 0009), nas formas fixas e nenhuma outra. `init` só com a branch `main`; `add` só com `--all`; `commit`
 * sem hooks, sem exigir mudança (`--allow-empty`) e com uma mensagem que não começa com `-`. Nada de `push`,
 * `reset`, `checkout` nem `commit` com `--amend`.
 */
function isInitWrite(args: readonly string[]): boolean {
  const [command, ...rest] = args;
  switch (command) {
    case 'init':
      return rest.length === 1 && rest[0] === '--initial-branch=main';
    case 'add':
      return rest.length === 1 && rest[0] === '--all';
    case 'commit': {
      const [noVerify, allowEmpty, flag, message, ...extra] = rest;
      return (
        noVerify === '--no-verify' &&
        allowEmpty === '--allow-empty' &&
        flag === '-m' &&
        isOperand(message) &&
        extra.length === 0
      );
    }
    default:
      return false;
  }
}

/**
 * Roda um passo de criação do repositório do primeiro estado (ADR 0009), com as mesmas proteções de
 * `runGit`: sem shell, argumentos em array, tempo limite e `-c core.fsmonitor=false`. Só as três formas de
 * `isInitWrite` passam; qualquer outra rejeita com PERMISSION_DENIED, sem criar processo.
 */
export async function runGitInitRepository(
  args: readonly string[],
  options: RunGitOptions,
): Promise<{ stdout: string }> {
  if (!isInitWrite(args)) {
    throw new GitError(
      'PERMISSION_DENIED',
      'Comando do Git recusado: só são permitidos os passos de criar o repositório.',
    );
  }
  return runApproved(args, { ...options, timeoutMs: options.timeoutMs ?? WORKTREE_TIMEOUT_MS });
}

/**
 * Roda um comando de escrita do Git sobre worktrees, com as mesmas proteções de `runGit`: sem
 * shell, argumentos em array, tempo limite, ambiente sem as variáveis de repositório e
 * `-c core.fsmonitor=false` antes do subcomando. Só duas formas valem, e nenhuma delas apaga uma
 * branch ou usa `--force`:
 *
 * - `['worktree', 'add', '-b', <branch>, <pasta>, <base>]`
 * - `['worktree', 'remove', <pasta>]`
 *
 * Qualquer outra rejeita com PERMISSION_DENIED, sem criar processo. O tempo limite padrão é maior
 * que o de `runGit`, porque o checkout leva mais que uma leitura.
 *
 * O `worktree add` faz um checkout, e o checkout roda o hook `post-checkout` do repositório, que num
 * repositório de terceiros (seção 17.1) é código alheio. Só nele o adaptador acrescenta
 * `-c core.hooksPath=<pasta vazia>`: uma pasta nova, criada por chamada na pasta temporária do
 * sistema (modo restrito, nome aleatório) e apagada ao fim, com sucesso ou falha. Se a pasta não puder
 * ser criada, o `add` rejeita com WORKTREE_CREATE_FAILED, sem criar processo. Por chamada, e não
 * uma fixa nem uma opção do chamador: ninguém consegue plantar hooks numa pasta de nome previsível,
 * e quem chama não tem como esquecer o `-c`. O `-c` de linha de comando vale mais que o
 * `core.hooksPath` da configuração do repositório. O `worktree remove` não faz checkout e não leva o `-c`.
 *
 * Os dois passam por `withLockAwareness` (git-locks.ts): worktree travado recusa com GIT_LOCKED e o
 * motivo, sem criar processo, e `index.lock` no repositório ganha novas tentativas curtas antes de
 * virar GIT_LOCKED (defensivo: não observado contra o Git para add e remove; ver git-locks.ts e a
 * ADR 0008). Nunca com `--force` nem `worktree unlock`.
 */
export async function runGitWorktree(
  args: readonly string[],
  options: RunGitOptions,
): Promise<{ stdout: string }> {
  if (!isWorktreeWrite(args)) {
    throw new GitError(
      'PERMISSION_DENIED',
      'Comando do Git recusado: só são permitidos criar e remover worktrees, nas formas fixas.',
    );
  }
  const withTimeout = { ...options, timeoutMs: options.timeoutMs ?? WORKTREE_TIMEOUT_MS };
  // Só o `remove` tem um worktree existente que pode estar travado (`git worktree lock`); o `add`
  // cria o seu. As duas formas sofrem com `index.lock` do repositório, que vale uma nova tentativa.
  const targets = {
    repo: options.cwd,
    ...(args[1] === 'remove' && args[2] !== undefined ? { worktree: args[2] } : {}),
  };
  if (args[1] !== 'add') return withLockAwareness(targets, () => runApproved(args, withTimeout));

  let noHooks: string | undefined;
  try {
    noHooks = await mkdtemp(join(tmpdir(), 'project-hub-sem-hooks-'));
    // A pasta de hooks fica fora das novas tentativas: é uma só, criada antes e apagada depois.
    const hooksConfig = ['-c', `core.hooksPath=${noHooks}`];
    return await withLockAwareness(targets, () => runApproved(args, withTimeout, hooksConfig));
  } catch (error) {
    // Sem a pasta de hooks vazia o `add` não pode rodar com segurança: nenhum processo é criado, e o
    // erro de fs (pasta temporária sem permissão ou cheia) não vaza cru. Falha do próprio Git sobe.
    if (noHooks === undefined) {
      throw new GitError(
        'WORKTREE_CREATE_FAILED',
        'Não foi possível preparar a criação do worktree.',
        { cause: error },
      );
    }
    throw error;
  } finally {
    // Limpeza de uma pasta vazia: se falhar, sobra uma pasta vazia na pasta temporária, e isso não
    // deve esconder o resultado do `worktree add`, que já aconteceu.
    if (noHooks !== undefined) {
      await rm(noHooks, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
