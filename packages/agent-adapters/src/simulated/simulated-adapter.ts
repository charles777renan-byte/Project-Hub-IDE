import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  AgentAdapter,
  AgentApprovalDecision,
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

/**
 * Caminho do arquivo dentro de `root`, ou `undefined` quando o caminho sai dela (R125). Recusa o
 * caminho absoluto, qualquer segmento `..` e o caminho que, resolvido, cai fora da raiz. O teste é
 * o mesmo de `createWorktree`: `relative` sobre o caminho resolvido.
 */
function resolveInside(root: string, relativePath: string): string | undefined {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) return undefined;
  const base = resolve(root);
  const target = resolve(base, relativePath);
  const path = relative(base, target);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    return undefined;
  }
  return target;
}

async function createFile(
  cwd: string,
  step: { relativePath: string; content: string },
): Promise<ToolResult> {
  const target = resolveInside(cwd, step.relativePath);
  if (target === undefined) {
    return {
      ok: false,
      error: {
        code: 'PATH_OUTSIDE_ALLOWED_SCOPE',
        message: 'O caminho do arquivo fica fora da pasta de trabalho.',
        retryable: false,
      },
    };
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, step.content, 'utf8');
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
