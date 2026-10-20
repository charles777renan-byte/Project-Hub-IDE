import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  AgentAdapter,
  AgentApprovalDecision,
  AgentError,
  AgentCapabilities,
  AgentEvent,
  AgentEventDraft,
  AgentSession,
  AgentUserInput,
  ToolResult,
} from '@project-hub/agent-sdk';

/**
 * Passo de um roteiro do agente simulado (seção 20.2). `await-approval` e `await-input` param o
 * roteiro até `approve()` ou `send()`. O tipo de ação protegida do pedido de aprovação é fixo
 * (`write_outside_worktree`), porque o roteiro não o informa.
 */
export type SimulatedStep =
  | { type: 'emit'; event: AgentEventDraft }
  | { type: 'create-file'; relativePath: string; content: string }
  | { type: 'await-approval'; description: string }
  | { type: 'await-input' }
  | { type: 'fail'; message: string };

const CAPABILITIES: AgentCapabilities = {
  streaming: true,
  tools: true,
  interactiveInput: true,
  approvals: true,
  pauseResume: true,
  attachments: false,
  usageReporting: false,
  persistentContext: false,
  localExecution: true,
  models: [],
};

/** Evento sem carimbo de tempo: o `at` é preenchido na hora de entregar. */
type Unstamped<T> = T extends unknown ? Omit<T, 'at'> : never;

type Gate<T> = { promise: Promise<T>; resolve: (value: T) => void };

function gate<T>(): Gate<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Código de erro do contrato, como o `AgentError` o carrega. */
type ErrorCode = AgentError['code'];

/**
 * Nomes que o Windows reserva para dispositivos, com ou sem extensão (`NUL`, `con.txt`, `COM1`).
 * Um arquivo com esse nome não é um arquivo: a gravação vai para o dispositivo.
 */
const WINDOWS_RESERVED_BASE =
  /^(con|prn|aux|nul|com[1-9\u00B9\u00B2\u00B3]|lpt[1-9\u00B9\u00B2\u00B3]|conin\$|conout\$)$/i;

/**
 * Diz se o segmento é o pai (`..`) para o Windows. Ele ignora espaços e pontos finais no segmento,
 * então `.. ` e `... ` também sobem um nível. Só pontos e espaços, com `..` no meio (R149).
 */
function isParent(segment: string): boolean {
  return /^[. ]*\.\.[. ]*$/.test(segment);
}

/**
 * Diz se o segmento tem nome reservado pelo Windows. Vale o nome-base, sem a extensão, e o Windows
 * ignora pontos e espaços finais nele: `NUL `, `NUL .txt` e `CON.` são dispositivos (R148).
 */
function isWindowsReserved(segment: string): boolean {
  const dot = segment.indexOf('.');
  const base = (dot === -1 ? segment : segment.slice(0, dot)).replace(/[. ]+$/, '');
  return WINDOWS_RESERVED_BASE.test(base);
}

/** Letra de unidade no início (`C:`): o caminho volta a depender da unidade, e não da pasta. */
const DRIVE_PREFIX = /^[A-Za-z]:/;

type Target = { ok: true; path: string } | { ok: false; error: AgentError };

function refused(code: ErrorCode, message: string): Target {
  return { ok: false, error: { code, message, retryable: false } };
}

/** `path` está dentro de `root`, ou é a própria `root`. Os dois precisam estar resolvidos. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * O caminho mais fundo, a partir de `path`, que existe no disco, seja arquivo, pasta ou link. Um link
 * quebrado conta como existente: `lstat` não segue o link.
 */
async function deepestExisting(path: string): Promise<string> {
  let current = path;
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

/**
 * Destino de `create-file` dentro de `cwd` (R125, R138, R139). Antes de tocar no disco recusa:
 *
 * - caminho absoluto, de rede (`\\servidor`), com letra de unidade (`C:..`) ou com um segmento `..`;
 * - nome reservado do Windows em qualquer segmento;
 * - caminho que, resolvido, cai fora da pasta de trabalho;
 * - caminho cujo ancestral existente mais fundo, com os links seguidos (`realpath`), cai fora da
 *   pasta de trabalho real. Isso cobre link simbólico e junção de pasta, e link de arquivo
 *   inclusive. Um link quebrado não tem destino que se possa confirmar, então é recusado.
 *
 * Entre a checagem e a gravação ainda há uma janela: quem troca um componente por link nesse
 * intervalo escapa. A checagem vale para o que o adaptador vê, não para um atacante com acesso de
 * escrita à pasta de trabalho.
 */
async function resolveTarget(cwd: string, relativePath: string): Promise<Target> {
  const segments = relativePath.split(/[\\/]/);
  if (isAbsolute(relativePath) || DRIVE_PREFIX.test(relativePath) || segments.some(isParent)) {
    return refused(
      'PATH_OUTSIDE_ALLOWED_SCOPE',
      'O caminho do arquivo fica fora da pasta de trabalho.',
    );
  }
  if (segments.some(isWindowsReserved)) {
    return refused(
      'VALIDATION_FAILED',
      'O nome é reservado pelo Windows e não pode ser um arquivo.',
    );
  }
  const base = resolve(cwd);
  const target = resolve(base, relativePath);
  if (target === base || !isInside(base, target)) {
    return refused(
      'PATH_OUTSIDE_ALLOWED_SCOPE',
      'O caminho do arquivo fica fora da pasta de trabalho.',
    );
  }

  // A folha não pode ser link: `writeFile` o segue, e a checagem do ancestral não alcança o último
  // componente. Vale até para link que aponta para dentro da pasta (R145).
  const leaf = await lstat(target).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (leaf?.isSymbolicLink() === true) {
    return refused(
      'PATH_OUTSIDE_ALLOWED_SCOPE',
      'O destino é um link, e a gravação não segue links.',
    );
  }

  const realBase = await realpath(base);
  const anchor = await deepestExisting(target);
  let realAnchor: string;
  try {
    realAnchor = await realpath(anchor);
  } catch {
    // Link quebrado: `realpath` não tem o destino, então não há como confirmar que fica dentro.
    return refused(
      'PATH_OUTSIDE_ALLOWED_SCOPE',
      'O caminho passa por um link que não pode ser verificado.',
    );
  }
  if (!isInside(realBase, realAnchor)) {
    return refused(
      'PATH_OUTSIDE_ALLOWED_SCOPE',
      'O caminho do arquivo fica fora da pasta de trabalho.',
    );
  }
  return { ok: true, path: target };
}

async function createFile(
  cwd: string,
  step: { relativePath: string; content: string },
): Promise<ToolResult> {
  const target = await resolveTarget(cwd, step.relativePath);
  if (!target.ok) return { ok: false, error: target.error };
  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, step.content, 'utf8');
  return { ok: true, output: `Arquivo criado: ${step.relativePath}` };
}

/**
 * Sessão que percorre o roteiro. O gerador confere `halted` antes de cada `yield` e de cada efeito
 * em disco: depois de `stop()` ou de o sinal ser abortado, nada mais é emitido nem gravado. As
 * esperas (aprovação, entrada, pausa) saem na hora com a interrupção.
 */
function createSession(
  id: string,
  script: readonly SimulatedStep[],
  cwd: string,
  signal: AbortSignal,
): AgentSession {
  let halted = false;
  const haltGate = gate<void>();
  let approvalGate: Gate<AgentApprovalDecision> | undefined;
  let inputGate: Gate<AgentUserInput> | undefined;
  let pauseGate: Gate<void> | undefined;
  let calls = 0;

  const halt = (): void => {
    if (halted) return;
    halted = true;
    haltGate.resolve();
  };
  if (signal.aborted) halt();
  else signal.addEventListener('abort', halt, { once: true });

  /** Espera `wait`, ou `undefined` na hora em que a sessão for interrompida. */
  const untilOrHalt = <T>(wait: Promise<T>): Promise<T | undefined> =>
    Promise.race([wait, haltGate.promise.then(() => undefined)]);

  const stamp = (event: Unstamped<AgentEvent>): AgentEvent =>
    ({ ...event, at: new Date().toISOString() }) as AgentEvent;

  async function* run(): AsyncGenerator<AgentEvent, void> {
    if (halted) return;
    yield stamp({ type: 'session.started', sessionId: id });

    for (const step of script) {
      while (pauseGate !== undefined) {
        const paused = pauseGate;
        await untilOrHalt(paused.promise);
        if (halted) return;
      }
      if (halted) return;

      switch (step.type) {
        case 'emit':
          yield stamp(step.event);
          break;

        case 'create-file': {
          calls += 1;
          const callId = `${id}-call-${calls}`;
          yield stamp({
            type: 'tool.requested',
            call: {
              callId,
              name: 'create-file',
              input: { relativePath: step.relativePath },
            },
          });
          if (halted) return;
          const result = await createFile(cwd, step);
          if (halted) return;
          yield stamp({ type: 'tool.completed', callId, result });
          if (!result.ok) {
            if (halted) return;
            yield stamp({ type: 'session.failed', error: result.error });
            return;
          }
          break;
        }

        case 'await-approval': {
          const pending = gate<AgentApprovalDecision>();
          approvalGate = pending;
          yield stamp({
            type: 'approval.requested',
            request: {
              actionType: 'write_outside_worktree',
              title: step.description,
              rationale: 'O roteiro simulado pediu aprovação.',
              affectedResources: [],
            },
          });
          const decision = await untilOrHalt(pending.promise);
          if (decision === undefined || halted) return;
          if (decision.decision === 'rejected') {
            if (halted) return;
            yield stamp({
              type: 'session.failed',
              error: {
                code: 'APPROVAL_REQUIRED',
                message: 'A ação protegida foi recusada.',
                retryable: false,
              },
            });
            return;
          }
          break;
        }

        case 'await-input': {
          const pending = gate<AgentUserInput>();
          inputGate = pending;
          yield stamp({
            type: 'input.requested',
            request: { id: 'entrada', prompt: 'O roteiro simulado espera uma resposta.' },
          });
          const answer = await untilOrHalt(pending.promise);
          if (answer === undefined || halted) return;
          break;
        }

        case 'fail':
          if (halted) return;
          yield stamp({
            type: 'session.failed',
            error: { code: 'UNKNOWN', message: step.message, retryable: false },
          });
          return;
      }
    }

    if (halted) return;
    yield stamp({
      type: 'session.completed',
      result: { summary: 'Roteiro simulado concluído.' },
    });
  }

  const events = run();

  return {
    id,
    events: () => events,

    send(input) {
      const pending = inputGate;
      if (pending === undefined) {
        return Promise.reject(new Error('Não há entrada pendente nesta sessão.'));
      }
      inputGate = undefined;
      pending.resolve(input);
      return Promise.resolve();
    },

    approve(input) {
      const pending = approvalGate;
      if (pending === undefined) {
        return Promise.reject(new Error('Não há aprovação pendente nesta sessão.'));
      }
      approvalGate = undefined;
      pending.resolve(input);
      return Promise.resolve();
    },

    pause() {
      pauseGate ??= gate<void>();
      return Promise.resolve();
    },

    resume() {
      const paused = pauseGate;
      pauseGate = undefined;
      paused?.resolve();
      return Promise.resolve();
    },

    stop(_reason) {
      halt();
      return Promise.resolve();
    },
  };
}

/**
 * Adaptador determinístico para testes. Cada `start` percorre o roteiro do início ao fim, e a
 * sessão para quando o sinal é abortado ou quando `stop` é chamado. O uso não é informado: a
 * capacidade `usageReporting` fica `false`.
 */
export function createSimulatedAdapter(options: { script: SimulatedStep[] }): AgentAdapter {
  const script = [...options.script];
  let started = 0;
  return {
    type: 'simulated',
    probe: () => Promise.resolve({ available: true }),
    getCapabilities: () => Promise.resolve(CAPABILITIES),
    start({ cwd }, signal) {
      started += 1;
      return Promise.resolve(createSession(`simulated-${started}`, script, cwd, signal));
    },
  };
}
