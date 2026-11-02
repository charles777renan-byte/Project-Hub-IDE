import { GitError, isOperand, runApproved, type RunGitOptions } from './run-git';
import { withLockAwareness } from './git-locks';

/**
 * Tempo limite de `push`, `pull` e `fetch` (ADR 0010): a rede leva mais que uma leitura, e o `pre-push`
 * roda dentro do `push`. Sem credencial guardada o Git falha logo (ver `WRITE_ENVIRONMENT`), então o
 * limite só pesa quando a rede está lenta ou um hook demora.
 */
const NETWORK_TIMEOUT_MS = 120_000;

/** Mensagem de commit: não vazia (fora espaços) e de até 10 000 caracteres (ADR 0010). */
const MAX_COMMIT_MESSAGE_CHARS = 10_000;

/**
 * Variáveis que o adaptador acrescenta ao ambiente de toda escrita (ADR 0010):
 * - `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never`: pedido de senha vira erro, sem travar o app;
 * - `GIT_LITERAL_PATHSPECS=1`: os caminhos de `add` e `restore` são nomes de arquivo, nunca padrões
 *   (`*`, `[`) nem pathspec mágico (`:(exclude)`), mesmo que o nome do arquivo os contenha.
 */
const WRITE_ENVIRONMENT = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_LITERAL_PATHSPECS: '1',
} as const;

/** O único remote que o painel usa (ADR 0010). */
const REMOTE = 'origin';

/**
 * Nome de branch como o `push -u origin <branch>` o aceita: um valor, e não uma refspec. `:` separa
 * origem e destino, e `+` na frente força; os demais caracteres são os que o Git não permite em nome
 * de referência (`git check-ref-format`), mais `..`. A branch vem do processo principal, lida do
 * repositório; esta checagem é a segunda trava.
 */
function isBranchName(branch: string | undefined): branch is string {
  return (
    isOperand(branch) &&
    !branch.startsWith('+') &&
    !/[\s:~^?*[\\]/u.test(branch) &&
    !Array.from(branch).some((char) => (char.codePointAt(0) ?? 0) < 0x20 || char === '\u007f') &&
    !branch.includes('..') &&
    !branch.includes('@{')
  );
}

/** Caminhos depois do `--`: ao menos um, e cada um um valor (nunca uma opção). */
function isPathList(paths: readonly string[]): boolean {
  return paths.length > 0 && paths.every((path) => isOperand(path));
}

function isCommitMessage(message: string | undefined): message is string {
  return (
    isOperand(message) &&
    message.trim() !== '' &&
    Array.from(message).length <= MAX_COMMIT_MESSAGE_CHARS
  );
}

/**
 * Lista de permissão de `runGitWrite` (ADR 0010): as formas que o painel de código-fonte usa, com
 * argumentos exatos, e nenhuma outra. Cada subcomando confere `length` e valores, no mesmo formato de
 * `isInitWrite` (ADR 0009):
 *
 * - `add -A` e `add -- <caminho…>`;
 * - `restore --staged -- <caminho…>` e `restore -- <caminho…>` (o `--` é obrigatório);
 * - `commit -m <mensagem>`: sem `--amend`, `--no-verify`, `-a` nem `--allow-empty`;
 * - `push` e `push -u origin <branch>`: sem `--force`, `--force-with-lease`, `--delete`, `--mirror`,
 *   `--tags` nem refspec;
 * - `pull --ff-only` e `fetch --prune origin`.
 *
 * Opções antes do subcomando (`-c`, `-C`) caem: o subcomando precisa ser o primeiro argumento. Nada
 * de `reset`, `clean`, `checkout`, `merge` nem `rebase`. Exportada só para os testes.
 */
export function isWriteAllowed(args: readonly string[]): boolean {
  const [command, ...rest] = args;
  switch (command) {
    case 'add': {
      if (rest.length === 1 && rest[0] === '-A') return true;
      const [separator, ...paths] = rest;
      return separator === '--' && isPathList(paths);
    }
    case 'restore': {
      const [first, ...afterFirst] = rest;
      if (first === '--staged') {
        const [separator, ...paths] = afterFirst;
        return separator === '--' && isPathList(paths);
      }
      return first === '--' && isPathList(afterFirst);
    }
    case 'commit': {
      const [flag, message, ...extra] = rest;
      return flag === '-m' && isCommitMessage(message) && extra.length === 0;
    }
    case 'push': {
      if (rest.length === 0) return true;
      const [upstream, remote, branch, ...extra] = rest;
      return upstream === '-u' && remote === REMOTE && isBranchName(branch) && extra.length === 0;
    }
    case 'pull':
      return rest.length === 1 && rest[0] === '--ff-only';
    case 'fetch':
      return rest.length === 2 && rest[0] === '--prune' && rest[1] === REMOTE;
    default:
      return false;
  }
}

/**
 * Roda um comando de escrita do Git na pasta do projeto (ADR 0010), com as mesmas proteções de
 * `runGit`: sem shell, argumentos em array, ambiente sem as variáveis de repositório e
 * `-c core.fsmonitor=false` antes do subcomando. Só as formas de `isWriteAllowed` passam; qualquer
 * outra rejeita com PERMISSION_DENIED, sem criar processo.
 *
 * Os hooks rodam: nenhuma forma recebe `core.hooksPath`, ao contrário do `worktree add` de
 * `runGitWorktree`. `pre-commit` e `pre-push` existem para ser vistos, e a saída deles chega ao
 * chamador no `stderr` do `GitError`.
 *
 * Toda escrita passa por `withLockAwareness` (git-locks.ts), porque um agente pode estar usando o mesmo
 * repositório: `index.lock` ganha novas tentativas curtas antes de virar GIT_LOCKED. O ambiente leva
 * `GIT_TERMINAL_PROMPT=0` e `GCM_INTERACTIVE=never`, e `push`, `pull` e `fetch` têm 120 s de limite.
 *
 * Esta função não sai de `index.ts`: o resto do app só a alcança pelos casos de uso do painel.
 */
export async function runGitWrite(
  args: readonly string[],
  options: RunGitOptions,
): Promise<{ stdout: string }> {
  if (!isWriteAllowed(args)) {
    throw new GitError(
      'PERMISSION_DENIED',
      'Comando do Git recusado: só são permitidas as escritas do painel de código-fonte, nas formas fixas.',
    );
  }
  const isNetwork = args[0] === 'push' || args[0] === 'pull' || args[0] === 'fetch';
  const withTimeout = isNetwork
    ? { ...options, timeoutMs: options.timeoutMs ?? NETWORK_TIMEOUT_MS }
    : options;
  return withLockAwareness({ repo: options.cwd }, () =>
    runApproved(args, withTimeout, [], WRITE_ENVIRONMENT),
  );
}
