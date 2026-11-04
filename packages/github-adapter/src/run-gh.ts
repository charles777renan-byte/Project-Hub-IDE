import { execFile, type ExecFileException } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { ErrorCode } from '@project-hub/contracts';

/** Tempo limite das leituras (`pr list`, `pr view`). */
const READ_TIMEOUT_MS = 15_000;
/** Tempo limite das escritas (`pr comment`, `pr merge`): o merge pode esperar o GitHub calcular o estado. */
const WRITE_TIMEOUT_MS = 60_000;
/** Teto da saída. Um PR com muitos checks e comentários chega a alguns MiB; passar disso é anormal. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Os campos de `pr view`, fixos: a lista de permissão só aceita exatamente esta (a mesma do desenho da aba
 * Checks). `parse-pr.ts` lê só estes.
 */
export const PR_VIEW_FIELDS =
  'number,title,state,isDraft,mergeable,mergeStateStatus,url,updatedAt,headRefName,baseRefName,additions,deletions,statusCheckRollup,comments,reviewDecision';

/** Formas de `pr merge`: nunca `--admin`, `--auto` nem `--delete-branch`. */
const MERGE_FLAGS: ReadonlySet<string> = new Set(['--merge', '--squash', '--rebase']);

/** Prefixo do corpo do comentário: o texto vai sempre colado ao `--body=`, nunca como argumento solto. */
const BODY_PREFIX = '--body=';

/**
 * Variáveis que mudariam o alvo do `gh`. `GH_REPO` faria `pr merge` agir em outro repositório, e `GH_HOST` em
 * outro servidor: o `gh` deve olhar sempre o `remote` da pasta (`cwd`). `GIT_DIR`, `GIT_WORK_TREE`,
 * `GIT_COMMON_DIR` e `GIT_INDEX_FILE` herdadas fariam o `git` que o `gh` chama olhar outro repositório que o
 * da pasta (as mesmas quatro que o adaptador do Git remove), e a checagem de origem (ADR 0011) não valeria
 * para o alvo real. `CLICOLOR_FORCE` e `GH_FORCE_TTY` forçariam cores e formato de terminal na saída, que o
 * adaptador lê como JSON.
 */
const REMOVED_VARIABLES: ReadonlySet<string> = new Set([
  'GH_REPO',
  'GH_HOST',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'CLICOLOR_FORCE',
  'GH_FORCE_TTY',
]);

export const GH_NOT_AVAILABLE_MESSAGE =
  'GitHub CLI não encontrado. Instale o gh (https://cli.github.com) e reinicie o Project Hub.';
export const GH_NOT_AUTHENTICATED_MESSAGE =
  'O GitHub CLI não está autenticado. Faça "gh auth login" no terminal.';
export const GH_NETWORK_FAILED_MESSAGE =
  'Não foi possível falar com o GitHub. Verifique a conexão e tente de novo.';
/** Uma escrita que falhou no meio pode ter chegado ao GitHub: conferir antes de repetir evita comentário duplicado. */
const WRITE_MAY_HAVE_COMPLETED =
  'A ação pode ter sido concluída: atualize a aba e confira o PR antes de tentar de novo.';
export const GH_NETWORK_FAILED_WRITE_MESSAGE = `Não foi possível falar com o GitHub. ${WRITE_MAY_HAVE_COMPLETED}`;
export const GH_PR_NOT_FOUND_MESSAGE = 'O PR não foi encontrado no GitHub.';
export const GH_PR_NOT_MERGEABLE_MESSAGE =
  'O GitHub recusou o merge: o PR não pode ser mesclado agora. Atualize a aba e confira o estado do PR.';
export const GH_UNSUPPORTED_REPOSITORY_MESSAGE =
  'Este repositório não é do github.com, e o Project Hub só lê PRs de lá.';

export type RunGhOptions = {
  /** Pasta onde o `gh` roda. É dela que o `gh` infere o repositório (o `remote`). */
  cwd: string;
  /**
   * Ambiente de onde o adaptador parte. O padrão é `process.env`. Existe para os testes não mexerem no
   * ambiente do processo: o chamador de produção não o passa.
   */
  env?: NodeJS.ProcessEnv | undefined;
  /**
   * Libera os ganchos de teste (`PROJECT_HUB_GH_BIN`, o `gh` falso). O padrão é `false`: sem ele, a variável é
   * ignorada, mesmo com `PROJECT_HUB_ENV=test`. Quem chama liga só fora do aplicativo empacotado.
   */
  allowTestOverrides?: boolean | undefined;
  /** Tempo limite em milissegundos. O padrão é 15000 na leitura e 60000 na escrita. */
  timeoutMs?: number | undefined;
};

/**
 * Falha ao rodar o `gh`. `code` e `message` seguem o `AppError` do contrato (a mensagem é segura para
 * exibir). A saída do `gh` fica só em `stderr` e `stdout`, e nunca na mensagem, porque traz texto do GitHub
 * (título de PR, comentário), que não é confiável.
 */
export class GhError extends Error {
  readonly code: ErrorCode;
  /** Código de saída do processo, quando o `gh` chegou a rodar e terminou com erro. */
  readonly exitCode: number | undefined;
  readonly stderr: string;
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
    this.name = 'GhError';
    this.code = code;
    this.exitCode = details.exitCode;
    this.stderr = details.stderr ?? '';
    this.stdout = details.stdout ?? '';
  }
}

/** Número de PR como o `gh` o recebe: inteiro positivo em decimal, sem sinal, zero à esquerda nem espaço. */
function isPrNumberArg(arg: string | undefined): arg is string {
  return arg !== undefined && /^[1-9][0-9]{0,9}$/u.test(arg);
}

/** Um argumento que o `gh` lê como valor: não vazio, sem `-` na frente e sem caractere de controle. */
function isOperand(arg: string | undefined): arg is string {
  if (arg === undefined || arg === '' || arg.startsWith('-')) return false;
  for (const char of arg) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Lista de permissão: as quatro formas do desenho da aba Checks, com argumentos exatos, e nenhuma outra.
 *
 * - `pr list --head <branch> --state all --limit 1 --json number`
 * - `pr view <n> --json <PR_VIEW_FIELDS>`
 * - `pr comment <n> --body=<texto>` (o texto pode ter quebra de linha e `-` na frente: é parte do mesmo
 *   argumento, nunca um argumento solto)
 * - `pr merge <n> --merge|--squash|--rebase`
 *
 * Nada de `api`, `repo`, `auth`, `run`, `pr create`, `pr close`, `pr review`, `--admin`, `--auto` nem
 * `--delete-branch`. Opções antes do subcomando (`-R`, `--repo`) também caem: `pr` precisa vir primeiro.
 */
export function isAllowedGhCommand(args: readonly string[]): boolean {
  const [command, subcommand, ...rest] = args;
  if (command !== 'pr') return false;
  switch (subcommand) {
    case 'list': {
      const [headFlag, branch, stateFlag, state, limitFlag, limit, jsonFlag, fields, ...extra] =
        rest;
      return (
        headFlag === '--head' &&
        isOperand(branch) &&
        stateFlag === '--state' &&
        state === 'all' &&
        limitFlag === '--limit' &&
        limit === '1' &&
        jsonFlag === '--json' &&
        fields === 'number' &&
        extra.length === 0
      );
    }
    case 'view': {
      const [number, jsonFlag, fields, ...extra] = rest;
      return (
        isPrNumberArg(number) &&
        jsonFlag === '--json' &&
        fields === PR_VIEW_FIELDS &&
        extra.length === 0
      );
    }
    case 'comment': {
      const [number, body, ...extra] = rest;
      return (
        isPrNumberArg(number) &&
        body !== undefined &&
        body.startsWith(BODY_PREFIX) &&
        body.slice(BODY_PREFIX.length).trim() !== '' &&
        extra.length === 0
      );
    }
    case 'merge': {
      const [number, flag, ...extra] = rest;
      return (
        isPrNumberArg(number) && flag !== undefined && MERGE_FLAGS.has(flag) && extra.length === 0
      );
    }
    default:
      return false;
  }
}

/** `pr comment` e `pr merge` escrevem no GitHub: ganham o tempo limite maior. */
function isWriteCommand(args: readonly string[]): boolean {
  return args[1] === 'comment' || args[1] === 'merge';
}

/** Como o `gh` é executado: o executável, o que vai antes dos argumentos e o ambiente extra. */
export type GhCommand = {
  command: string;
  /** Argumentos antes dos da forma permitida (o script do `gh` falso). Vazio fora dos testes. */
  commandPrefix: string[];
  /** Variáveis somadas ao ambiente (`ELECTRON_RUN_AS_NODE` do `gh` falso). Vazio fora dos testes. */
  extraEnv: Record<string, string>;
};

/**
 * Executável do `gh`. Só com `allowTestOverrides` (o chamador liga fora do aplicativo empacotado) e com
 * `PROJECT_HUB_ENV=test` a variável `PROJECT_HUB_GH_BIN` vale: ela aponta um
 * script `.mjs` (o `gh` falso dos testes), que roda no próprio executável do processo (`execPath`: o Node, ou
 * o Electron com `ELECTRON_RUN_AS_NODE`). O Windows não executa um `.cmd` nem um `.js` direto pelo
 * `execFile`, e assim o falso é portátil, no mesmo padrão do planejador falso (`resolvePlannerCommand`). Em
 * qualquer outro caso a variável é ignorada e vale o `gh` do PATH, para que um ambiente comum, ou um
 * aplicativo empacotado, nunca troque o `gh` real por outro programa.
 */
export function resolveGhCommand(
  env: NodeJS.ProcessEnv,
  allowTestOverrides: boolean,
  execPath: string = process.execPath,
): GhCommand {
  const script =
    allowTestOverrides && env['PROJECT_HUB_ENV'] === 'test' ? env['PROJECT_HUB_GH_BIN'] : undefined;
  if (script !== undefined && script !== '') {
    return { command: execPath, commandPrefix: [script], extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { command: 'gh', commandPrefix: [], extraEnv: {} };
}

/**
 * Ambiente do processo: sem pergunta no terminal, sem cor, sem aviso de atualização e sem as variáveis que
 * mudam o alvo do `gh` (`REMOVED_VARIABLES`). O resto (`GH_TOKEN`, `GH_CONFIG_DIR`, o PATH) segue como está.
 */
export function ghEnvironment(
  source: NodeJS.ProcessEnv,
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...source,
    ...extra,
    GH_PROMPT_DISABLED: '1',
    NO_COLOR: '1',
    CLICOLOR: '0',
    GH_NO_UPDATE_NOTIFIER: '1',
  };
  // No Windows os nomes de variável não diferenciam maiúsculas: `gh_repo` valeria como `GH_REPO`.
  for (const name of Object.keys(env)) {
    if (REMOVED_VARIABLES.has(name.toUpperCase())) delete env[name];
  }
  return env;
}

const AUTH_PATTERN =
  /gh auth login|not logged in|not logged into|authentication (?:required|failed)|bad credentials|http 401|requires authentication/iu;
const NETWORK_PATTERN =
  /dial tcp|no such host|connection (?:refused|reset|timed out)|connectex|proxyconnect|i\/o timeout|timed out|timeout|network is unreachable|tls:|could not resolve host|unable to connect|temporary failure in name resolution|wsarecv|wsasend|deadline exceeded|error connecting to|internet connection|unexpected eof|\bEOF\b|http 5\d\d/iu;
const PR_NOT_FOUND_PATTERN = /could not resolve to a pullrequest|no pull requests? found/iu;
const NOT_MERGEABLE_PATTERN =
  /not mergeable|cannot be cleanly created|merge conflict|conflicts?\b|required status check|review is required|base branch policy|protected branch|already merged|is closed|is a draft|draft pull request|(?:merge commits?|squash merges?|rebase merges?) (?:are|is) not allowed/iu;

/** As falhas que o texto do `gh` permite reconhecer. */
export type RecognizedGhFailure =
  'GH_NOT_AUTHENTICATED' | 'GH_NETWORK_FAILED' | 'GH_PR_NOT_FOUND' | 'GH_PR_NOT_MERGEABLE';

/**
 * Lê o `stderr` do `gh` e diz de que falha se trata, ou `undefined` quando não reconhece. Três textos foram
 * capturados do `gh` real (2.92): sem login, "To get started with GitHub CLI, please run:  gh auth login",
 * código 4; sem rede, `Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp ...: connectex: ...`;
 * PR inexistente, "GraphQL: Could not resolve to a PullRequest with the number of N.". O texto do merge
 * recusado NÃO foi capturado (exigiria um merge de verdade): os padrões de `NOT_MERGEABLE_PATTERN` são os
 * textos conhecidos do `gh` e do GitHub, sem confirmação. Uma recusa que nenhum padrão reconheça cai em
 * `UNKNOWN`, que também não mescla nada. A ordem importa: login e PR inexistente antes de rede, que tem um
 * padrão mais largo.
 */
export function classifyGhFailure(
  args: readonly string[],
  stderr: string,
): RecognizedGhFailure | undefined {
  if (AUTH_PATTERN.test(stderr)) return 'GH_NOT_AUTHENTICATED';
  if (PR_NOT_FOUND_PATTERN.test(stderr)) return 'GH_PR_NOT_FOUND';
  if (args[1] === 'merge' && NOT_MERGEABLE_PATTERN.test(stderr)) return 'GH_PR_NOT_MERGEABLE';
  if (NETWORK_PATTERN.test(stderr)) return 'GH_NETWORK_FAILED';
  return undefined;
}

/** Mensagem segura de cada falha reconhecida: nunca o texto do `gh`. */
const RECOGNIZED_MESSAGES: Readonly<Record<RecognizedGhFailure, string>> = {
  GH_NOT_AUTHENTICATED: GH_NOT_AUTHENTICATED_MESSAGE,
  GH_NETWORK_FAILED: GH_NETWORK_FAILED_MESSAGE,
  GH_PR_NOT_FOUND: GH_PR_NOT_FOUND_MESSAGE,
  GH_PR_NOT_MERGEABLE: GH_PR_NOT_MERGEABLE_MESSAGE,
};

type Outcome =
  { error: null; stdout: string } | { error: ExecFileException; stdout: string; stderr: string };

function execGh(
  command: GhCommand,
  args: readonly string[],
  options: RunGhOptions,
  timeoutMs: number,
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    try {
      const child = execFile(
        command.command,
        [...command.commandPrefix, ...args],
        {
          cwd: options.cwd,
          env: ghEnvironment(options.env ?? process.env, command.extraEnv),
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: 'utf8',
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve(error === null ? { error: null, stdout } : { error, stdout, stderr });
        },
      );
      // O `gh` nunca lê a entrada padrão aqui: fechá-la evita esperar por ela.
      child.stdin?.end();
    } catch (error) {
      // O `execFile` também lança de forma síncrona (linha de comando longa demais, argumento com NUL).
      // Sem isto o chamador receberia um `Error` cru, sem código nem mensagem segura.
      reject(toSpawnThrowError(error));
    }
  });
}

/**
 * Converte o que o `execFile` lançou de forma síncrona em `GhError`. Linha de comando longa demais
 * (`ENAMETOOLONG`, `E2BIG`) e argumento que o sistema não aceita (`ERR_INVALID_ARG_*`, como um NUL) são
 * entrada inválida; qualquer outra coisa é `UNKNOWN`. A mensagem nunca traz o texto do erro do Node.
 */
export function toSpawnThrowError(error: unknown): GhError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENAMETOOLONG' || code === 'E2BIG') {
    return new GhError('VALIDATION_FAILED', COMMAND_TOO_LONG_MESSAGE, { cause: error });
  }
  if (code === 'ERR_INVALID_ARG_VALUE' || code === 'ERR_INVALID_ARG_TYPE') {
    return new GhError('VALIDATION_FAILED', INVALID_TEXT_MESSAGE, { cause: error });
  }
  return new GhError('UNKNOWN', 'Não foi possível executar o GitHub CLI.', { cause: error });
}

/**
 * Teto da linha de comando estimada. O Windows aceita 32 767 caracteres na linha inteira (medido: um argumento
 * de 32 726 caracteres comuns passa e um de 32 727 falha com `ENAMETOOLONG`, 32 de caminho do executável incluídos).
 * 30 000 deixa 2 700 de folga para o executável (até um caminho longo do Windows), `pr comment 12 --body=` e o resto
 * das formas fixas. A estimativa pega o pior caso do escape: cada aspa e cada barra invertida contam 2 (medido: com
 * só aspas o limite cai para 16 362). Vale em todos os sistemas, para a recusa não depender de onde roda.
 */
export const MAX_COMMAND_LINE_CHARS = 30_000;

const COMMAND_TOO_LONG_MESSAGE =
  'O comentário é grande demais para enviar pelo GitHub CLI (cerca de 30 000 caracteres, menos se tiver muitas aspas ou barras invertidas). Divida o texto em partes menores.';
const INVALID_TEXT_MESSAGE =
  'O texto tem um caractere que o GitHub CLI não aceita (caractere nulo).';

/** Linha de comando estimada, no pior caso do escape: cada argumento entre aspas e cada `"` e `\` valendo 2. */
export function estimateCommandLineLength(args: readonly string[]): number {
  let total = 0;
  for (const arg of args) {
    total += arg.length + 3;
    for (const char of arg) if (char === '"' || char === '\\') total += 1;
  }
  return total;
}

/** Recusa, antes de criar o processo, o que o sistema não conseguiria executar. */
function checkCommandLine(args: readonly string[]): void {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new GhError('VALIDATION_FAILED', INVALID_TEXT_MESSAGE);
  }
  if (estimateCommandLineLength(args) > MAX_COMMAND_LINE_CHARS) {
    throw new GhError('VALIDATION_FAILED', COMMAND_TOO_LONG_MESSAGE);
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function toGhError(
  error: ExecFileException,
  stdout: string,
  stderr: string,
  args: readonly string[],
  options: RunGhOptions,
  timeoutMs: number,
): Promise<GhError> {
  if (error.code === 'ENOENT') {
    // O Node também responde ENOENT quando a pasta de trabalho não existe: isso não é falta do `gh`.
    if (!(await isDirectory(options.cwd))) {
      return new GhError(
        'PROJECT_PATH_UNAVAILABLE',
        'A pasta do projeto não existe ou não está acessível.',
        { cause: error },
      );
    }
    return new GhError('GH_NOT_AVAILABLE', GH_NOT_AVAILABLE_MESSAGE, { cause: error });
  }
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new GhError('UNKNOWN', 'A saída do GitHub CLI passou do limite aceito.', {
      stdout,
      stderr,
      cause: error,
    });
  }
  if (error.killed === true) {
    // Uma escrita interrompida pode ter chegado ao GitHub: mandar "tentar de novo" poderia duplicar um
    // comentário público. A mensagem manda conferir antes.
    const advice = isWriteCommand(args)
      ? WRITE_MAY_HAVE_COMPLETED
      : 'Verifique a conexão e tente de novo.';
    return new GhError(
      'GH_NETWORK_FAILED',
      `O GitHub CLI demorou mais de ${timeoutMs / 1000} s e foi interrompido. ${advice}`,
      { stdout, stderr, cause: error },
    );
  }
  const exitCode = typeof error.code === 'number' ? error.code : undefined;
  const recognized = classifyGhFailure(args, stderr);
  if (recognized !== undefined) {
    // A rede pode cair depois de o GitHub aceitar a escrita: nunca mandar "tentar de novo" numa escrita.
    const message =
      recognized === 'GH_NETWORK_FAILED' && isWriteCommand(args)
        ? GH_NETWORK_FAILED_WRITE_MESSAGE
        : RECOGNIZED_MESSAGES[recognized];
    return new GhError(recognized, message, {
      exitCode,
      stdout,
      stderr,
      cause: error,
    });
  }
  if (exitCode !== undefined) {
    const command = `gh ${args[0] ?? ''} ${args[1] ?? ''}`.trim();
    return new GhError(
      'UNKNOWN',
      `O comando "${command}" terminou com erro (código ${exitCode}).`,
      {
        exitCode,
        stdout,
        stderr,
        cause: error,
      },
    );
  }
  return new GhError('UNKNOWN', 'Não foi possível executar o GitHub CLI.', {
    stdout,
    stderr,
    cause: error,
  });
}

/**
 * Roda um comando do `gh` em `options.cwd`, sem shell: o executável recebe os argumentos em array, então
 * branch ou texto de comentário nunca vira comando. Forma fora da lista de permissão (`isAllowedGhCommand`)
 * rejeita com PERMISSION_DENIED, sem criar processo. Executável ausente rejeita com GH_NOT_AVAILABLE, e o
 * aplicativo segue de pé. "no pull requests found" na lista não é erro: vira `[]`. É exportada só para o
 * pacote (não entra em `index.ts`): o resto do app usa `gh-read.ts` e `gh-write.ts`.
 */
export async function runGh(
  args: readonly string[],
  options: RunGhOptions,
): Promise<{ stdout: string }> {
  if (!isAllowedGhCommand(args)) {
    throw new GhError(
      'PERMISSION_DENIED',
      'Comando do GitHub CLI recusado: só são permitidos ler, comentar e mesclar PRs, nas formas fixas.',
    );
  }
  checkCommandLine(args);
  const timeoutMs =
    options.timeoutMs ?? (isWriteCommand(args) ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
  const outcome = await execGh(
    resolveGhCommand(options.env ?? process.env, options.allowTestOverrides === true),
    args,
    options,
    timeoutMs,
  );
  if (outcome.error === null) return { stdout: outcome.stdout };
  if (args[1] === 'list' && /no pull requests found/iu.test(outcome.stderr)) {
    return { stdout: '[]' };
  }
  throw await toGhError(outcome.error, outcome.stdout, outcome.stderr, args, options, timeoutMs);
}
