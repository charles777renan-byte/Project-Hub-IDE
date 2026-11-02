import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
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
const NOT_FAST_FORWARD_MESSAGES = {
  push: 'O remoto tem commits que a sua branch não tem, e o envio foi recusado. Resolva no terminal (git pull, com merge ou rebase) e envie de novo.',
  pull: 'A sua branch e a do remoto divergiram, então ela não pode avançar sozinha. Resolva no terminal (merge ou rebase).',
} as const;

function validationError(message: string): GitError {
  return new GitError('VALIDATION_FAILED', message);
}

/** Caminho relativo à pasta do projeto, em POSIX: sem `/` na frente, sem unidade, sem `\` e sem `..`. */
function isRelativePosixPath(path: string): boolean {
  return (
    path !== '' &&
    !isAbsolute(path) &&
    !path.startsWith('/') &&
    !/^[A-Za-z]:/u.test(path) &&
    !path.includes('\\') &&
    !path.split('/').includes('..')
  );
}

function assertPaths(paths: readonly string[]): void {
  if (paths.length === 0) throw validationError('Nenhum arquivo foi informado.');
  const bad = paths.find((path) => !isRelativePosixPath(path));
  if (bad !== undefined) {
    throw validationError(`Caminho inválido: "${bad}". Use caminhos relativos à pasta do projeto.`);
  }
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

/** Sequência de cor ANSI (ESC [ ... letra), que a saída de um hook pode trazer. */
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'gu');

/** Saída do hook como cabe numa mensagem: sem sequências de cor nem caracteres de controle, e com teto. */
function hookOutputForMessage(stderr: string): string {
  // A linha de resumo do próprio Git não é do hook, e leva o endereço do remoto.
  const withoutPushSummary = stderr
    .split('\n')
    .filter((line) => !line.startsWith('error: failed to push some refs'))
    .join('\n');
  const clean = Array.from(withoutPushSummary.replace(ANSI_SEQUENCE, ''))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return char === '\n' || char === '\t' || (code >= 0x20 && code !== 0x7f);
    })
    .join('')
    .trim();
  const chars = Array.from(clean);
  return chars.length <= MAX_HOOK_OUTPUT_CHARS
    ? clean
    : `${chars.slice(0, MAX_HOOK_OUTPUT_CHARS).join('')}…`;
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
const NOTHING_PATTERNS = ['nothing to commit', 'no changes added to commit'];
const DETACHED_PATTERNS = ['You are not currently on a branch'];
/** Recusa de um hook do servidor (`pre-receive`, `update`...): o Git a escreve na linha `[remote rejected]`. */
const REMOTE_HOOK_PATTERN = /hook declined/iu;
/**
 * Falhas do commit que podem coexistir com um hook `pre-commit` no repositório sem serem dele: assinatura
 * (gpg) e conflito não resolvido. O hook presente não basta para chamá-las de `GIT_HOOK_FAILED`.
 */
const NOT_HOOK_COMMIT_PATTERNS = [
  'gpg failed to sign',
  'failed to write commit object',
  'Committing is not possible',
  'Aborting commit',
];

/**
 * Traduz a falha do Git para o código e a mensagem do painel. Só mexe no erro genérico (`UNKNOWN`) que
 * o Git deu ao terminar com código diferente de zero; um erro que já tem código próprio (`GIT_LOCKED`,
 * `PERMISSION_DENIED`, `GIT_NOT_AVAILABLE`...) e o que não reconhece sobem como vieram. A decisão sai do
 * `stderr` (o `LC_ALL=C` do adaptador o mantém em inglês), na ordem: autenticação, avanço impossível,
 * HEAD solto, identidade, nada para commitar e, por fim, hook.
 *
 * `hookPresent` diz que existe um hook da operação (`pre-commit`, `pre-push`...). O Git não escreve a
 * palavra "hook" quando um hook local recusa: o `stderr` é só a saída do hook. Por isso um hook presente
 * pesa, mas só junto com o que o Git escreve quando o hook recusa, e não nas outras falhas:
 * - commit: vale se a falha não é de assinatura (gpg), de conflito nem de mensagem (`NOT_HOOK_COMMIT_PATTERNS`);
 * - push: vale se o Git fechou com `failed to push some refs` e sem linha `[rejected]` nem
 *   `[remote rejected]`. Rede fora do ar, remoto inexistente, chave recusada e branch sem upstream não
 *   escrevem essa frase, e o `pre-push` nem chega a rodar.
 * Um hook do servidor (`pre-receive hook declined`) é reconhecido pelo texto, sem depender de hook local.
 *
 * O `stderr` bruto só entra na mensagem de `GIT_HOOK_FAILED`: é a saída do hook, e é isso que a pessoa
 * precisa ler. Nos demais, a mensagem é fixa e o `stderr` fica só no campo `stderr` do erro.
 */
export function translateGitWriteError(
  error: unknown,
  context: WriteContext,
  options: { hookPresent?: boolean } = {},
): unknown {
  if (!(error instanceof GitError) || error.code !== 'UNKNOWN' || error.exitCode === undefined) {
    return error;
  }
  const details = { exitCode: error.exitCode, stderr: error.stderr, cause: error };
  const { stderr } = error;

  if (hasAny(stderr, AUTH_PATTERNS))
    return new GitError('GIT_AUTH_REQUIRED', AUTH_MESSAGE, details);
  if (hasAny(stderr, NOT_FAST_FORWARD_PATTERNS)) {
    const message =
      context === 'pull' ? NOT_FAST_FORWARD_MESSAGES.pull : NOT_FAST_FORWARD_MESSAGES.push;
    return new GitError('GIT_NOT_FAST_FORWARD', message, details);
  }
  if (hasAny(stderr, DETACHED_PATTERNS)) {
    return new GitError('GIT_DETACHED_HEAD', DETACHED_HEAD_MESSAGE, details);
  }
  if (hasAny(stderr, IDENTITY_PATTERNS)) return new GitError('UNKNOWN', IDENTITY_MESSAGE, details);
  if (hasAny(stderr, NOTHING_PATTERNS)) {
    return new GitError('GIT_NOTHING_TO_COMMIT', NOTHING_TO_COMMIT_MESSAGE, details);
  }
  if (
    REMOTE_HOOK_PATTERN.test(stderr) ||
    (options.hookPresent === true && localHookRejected(stderr, context))
  ) {
    const operation = context === 'push' ? 'o envio' : 'o commit';
    const output = hookOutputForMessage(stderr);
    const message = `Um hook do Git recusou ${operation}.${output === '' ? '' : `\n\n${output}`}`;
    return new GitError('GIT_HOOK_FAILED', message, details);
  }
  return error;
}

/** O `stderr` tem o formato de uma recusa de hook local (ver `translateGitWriteError`)? */
function localHookRejected(stderr: string, context: WriteContext): boolean {
  if (context === 'commit') return !hasAny(stderr, NOT_HOOK_COMMIT_PATTERNS);
  if (context === 'push') {
    return (
      stderr.includes('failed to push some refs') &&
      !stderr.includes('[rejected]') &&
      !stderr.includes('[remote rejected]')
    );
  }
  return false;
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
      error instanceof GitError && error.code === 'UNKNOWN' && hooks !== undefined
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
 * O caminho está no índice (rastreado)? `rev-parse --verify :0:<caminho>` resolve o arquivo no estágio 0
 * do índice, como nome literal (sem padrão). Sai com 1 quando não existe. Uma pasta não é uma entrada do
 * índice: o painel desfaz arquivo a arquivo.
 */
async function isTracked(options: WriteOptions, path: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `:0:${path}`], {
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
 * Põe em stage: os `paths` (`add -- <caminhos>`) ou, sem `paths`, tudo (`add -A`). Os caminhos são nomes
 * de arquivo, nunca padrões. Nome com espaço, acento ou aspas funciona.
 */
export async function stagePaths(
  options: WriteOptions & { paths?: readonly string[] },
): Promise<void> {
  if (options.paths === undefined) return write(options, ['add', '-A'], 'stage');
  assertPaths(options.paths);
  return write(options, ['add', '--', ...options.paths], 'stage');
}

/** Tira do stage os `paths` (`restore --staged -- <caminhos>`). O arquivo no disco não muda. */
export async function unstagePaths(
  options: WriteOptions & { paths: readonly string[] },
): Promise<void> {
  assertPaths(options.paths);
  return write(options, ['restore', '--staged', '--', ...options.paths], 'stage');
}

/**
 * Desfaz as alterações do disco nos `paths` (`restore -- <caminhos>`), voltando ao que está no índice.
 * Só vale para arquivo rastreado: se algum caminho não estiver no índice, recusa tudo com
 * `VALIDATION_FAILED`, antes de restaurar qualquer um. Não existe `clean` (ADR 0010).
 */
export async function discardPaths(
  options: WriteOptions & { paths: readonly string[] },
): Promise<void> {
  assertPaths(options.paths);
  const untracked: string[] = [];
  for (const path of options.paths) {
    if (!(await isTracked(options, path))) untracked.push(path);
  }
  if (untracked.length > 0) {
    throw validationError(
      `Só é possível desfazer arquivos que o Git já acompanha. Não acompanhados: ${untracked.join(', ')}.`,
    );
  }
  return write(options, ['restore', '--', ...options.paths], 'stage');
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
  if (!(await hasStagedChanges(options))) {
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
 * Envia a branch atual: `push -u origin <branch>` com `setUpstream`, ou `push` sem. A branch é lida do
 * repositório. Nunca força: se o remoto avançou, o erro é `GIT_NOT_FAST_FORWARD`. O `pre-push` roda.
 */
export async function pushBranch(
  options: WriteOptions & { setUpstream: boolean },
): Promise<{ branch: string }> {
  const branch = await currentBranch(options);
  await write(options, options.setUpstream ? ['push', '-u', 'origin', branch] : ['push'], 'push');
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
