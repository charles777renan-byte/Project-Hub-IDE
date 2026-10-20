import { execFile, type ExecFileException } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { ErrorCode } from '@project-hub/contracts';

const DEFAULT_TIMEOUT_MS = 15_000;
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

/** Opções que `symbolic-ref` aceita só para ler. Qualquer outra, como `-d` e `-m`, escreve ou apaga. */
const SYMBOLIC_REF_READ_OPTIONS = new Set(['--short', '-q', '--quiet']);

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
 * segura para exibir). A saída de erro do Git fica só em `stderr`, porque pode trazer conteúdo do
 * repositório (seção 17.1), que não é texto confiável.
 */
export class GitError extends Error {
  readonly code: ErrorCode;
  /** Código de saída do processo, quando o Git chegou a rodar e terminou com erro. */
  readonly exitCode: number | undefined;
  readonly stderr: string;

  constructor(
    code: ErrorCode,
    message: string,
    details: { exitCode?: number | undefined; stderr?: string | undefined; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'GitError';
    this.code = code;
    this.exitCode = details.exitCode;
    this.stderr = details.stderr ?? '';
  }
}

/**
 * Lista de permissão (RF-GIT-007, seção 11 de docs/regras-subagentes.md): só leitura. `branch` só
 * vale como `branch --show-current`, e `symbolic-ref` só na forma de leitura, com um nome e sem
 * as opções que escrevem. Tudo o que não está aqui é recusado antes de criar um processo. Opções
 * antes do subcomando (`-c`, `-C`, `--exec-path`) também caem: o subcomando precisa ser o primeiro
 * argumento.
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
    default:
      return false;
  }
}

/**
 * Ambiente do processo: mensagens do Git em inglês (a detecção reconhece "not a git repository" no
 * texto), sem travas opcionais (o `status` não regrava o índice) e sem variáveis de repositório.
 */
function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return env;
}

type Outcome = { error: null; stdout: string } | { error: ExecFileException; stderr: string };

/**
 * Roda o executável sem shell, com os argumentos em array, depois da lista de permissão. Nunca
 * rejeita: devolve o resultado.
 */
function execGit(file: string, args: readonly string[], options: RunGitOptions): Promise<Outcome> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...FSMONITOR_OFF, ...args],
      {
        cwd: options.cwd,
        env: gitEnvironment(),
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve(error === null ? { error: null, stdout } : { error, stderr });
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
      stderr,
      cause: error,
    });
  }
  if (error.killed === true) {
    const seconds = (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000;
    return new GitError('UNKNOWN', `O Git demorou mais de ${seconds} s e foi interrompido.`, {
      stderr,
      cause: error,
    });
  }
  if (typeof error.code === 'number') {
    return new GitError(
      'UNKNOWN',
      `O comando "git ${args[0] ?? ''}" terminou com erro (código ${error.code}).`,
      { exitCode: error.code, stderr, cause: error },
    );
  }
  return new GitError('UNKNOWN', 'Não foi possível executar o Git.', { stderr, cause: error });
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
  const outcome = await execGit(options.gitBinary ?? 'git', args, options);
  if (outcome.error === null) return { stdout: outcome.stdout };
  throw await toGitError(outcome.error, outcome.stderr, args, options);
}
