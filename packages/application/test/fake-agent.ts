import type {
  AgentAdapter,
  AgentApprovalDecision,
  AgentCapabilities,
  AgentEvent,
  AgentEventDraft,
  AgentSession,
  AgentStartInput,
  AgentUserInput,
} from '@project-hub/agent-sdk';

/**
 * Passo de um roteiro de teste. Os eventos de início e de fim da sessão o próprio agente emite.
 * `hold` para o roteiro até o teste chamar `releaseHold()` da sessão (ou até a sessão ser parada).
 */
export type FakeStep =
  | { kind: 'event'; event: AgentEventDraft }
  | { kind: 'approval' }
  | { kind: 'input' }
  | { kind: 'hold' }
  | { kind: 'fail'; message: string }
  | { kind: 'throw' }
  | { kind: 'end' };

export type FakeSession = {
  stopReasons: string[];
  decisions: AgentApprovalDecision[];
  inputs: AgentUserInput[];
  /** Quantas vezes o orquestrador pediu `pause()` e `resume()` a esta sessão. */
  pauses: number;
  resumes: number;
  /** Libera o passo `hold` do roteiro. */
  releaseHold: () => void;
};

export type FakeAgent = AgentAdapter & {
  readonly starts: AgentStartInput[];
  readonly sessions: FakeSession[];
};

const AT = '2026-10-20T10:00:00.000Z';

/** Evento sem `at`, distribuído sobre a união para que cada variante conserve os próprios campos. */
type Unstamped<T> = T extends unknown ? Omit<T, 'at'> : never;

const CAPABILITIES: AgentCapabilities = {
  streaming: false,
  tools: false,
  interactiveInput: true,
  approvals: true,
  pauseResume: true,
  attachments: false,
  usageReporting: false,
  persistentContext: false,
  localExecution: true,
  models: [],
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export type FakeAgentOptions = {
  failStarts?: number;
  failDelivery?: boolean;
  failStop?: boolean;
  /** `pause()` rejeita, como um agente que recusa a pausa. */
  failPause?: boolean;
  /** `resume()` rejeita. */
  failResume?: boolean;
};

/**
 * Agente de teste. Cada `start` usa o próximo roteiro da lista. Sem roteiro, a sessão só emite
 * início e fim. As `failStarts` primeiras chamadas a `start` rejeitam, como um agente indisponível.
 * Com `failDelivery`, `approve` e `send` rejeitam: a resposta do usuário não chega ao agente.
 * Enquanto a sessão está pausada, nenhum evento sai e nenhum passo do roteiro começa.
 */
export function fakeAgent(scripts: FakeStep[][], options: FakeAgentOptions = {}): FakeAgent {
  const starts: AgentStartInput[] = [];
  const sessions: FakeSession[] = [];
  let count = 0;
  return {
    type: 'fake',
    starts,
    sessions,
    probe: () => Promise.resolve({ available: true }),
    getCapabilities: () => Promise.resolve(CAPABILITIES),
    start(input) {
      starts.push(input);
      if (starts.length <= (options.failStarts ?? 0)) {
        return Promise.reject(new Error('agente indisponível'));
      }
      const script = scripts[count] ?? [];
      count += 1;
      const record: FakeSession = {
        stopReasons: [],
        decisions: [],
        inputs: [],
        pauses: 0,
        resumes: 0,
        releaseHold: () => undefined,
      };
      sessions.push(record);
      return Promise.resolve(createFakeSession(script, record, options));
    },
  };
}

/** Sessão que segue o roteiro. Aprovação, entrada e `hold` param o roteiro até a resposta ou o `stop`. */
function createFakeSession(
  script: FakeStep[],
  record: FakeSession,
  options: FakeAgentOptions,
): AgentSession {
  let halted = false;
  const halt = deferred<void>();
  const hold = deferred<void>();
  let pendingApproval: Deferred<AgentApprovalDecision> | undefined;
  let pendingInput: Deferred<AgentUserInput> | undefined;
  let pausedGate: Deferred<void> | undefined;
  record.releaseHold = () => hold.resolve();

  /** Espera a resposta; `undefined` quando a sessão foi parada antes. */
  const answerOrHalt = <T>(answer: Promise<T>): Promise<T | undefined> =>
    Promise.race([answer, halt.promise.then(() => undefined)]);

  /** Espera enquanto a sessão está pausada. `false` quando ela foi parada. */
  async function ready(): Promise<boolean> {
    while (pausedGate !== undefined && !halted) {
      await answerOrHalt(pausedGate.promise);
    }
    return !halted;
  }

  const stamp = (event: Unstamped<AgentEvent>): AgentEvent => ({ ...event, at: AT }) as AgentEvent;

  async function* run(): AsyncGenerator<AgentEvent> {
    if (!(await ready())) return;
    yield stamp({ type: 'session.started', sessionId: 'fake-session' });
    for (const step of script) {
      if (!(await ready())) return;
      switch (step.kind) {
        case 'event':
          if (!(await ready())) return;
          yield stamp(step.event);
          break;
        case 'approval': {
          const decision = deferred<AgentApprovalDecision>();
          pendingApproval = decision;
          if (!(await ready())) return;
          yield stamp({
            type: 'approval.requested',
            request: {
              actionType: 'write_outside_worktree',
              title: 'Ação de teste',
              rationale: 'Roteiro de teste',
              affectedResources: [],
            },
          });
          const answer = await answerOrHalt(decision.promise);
          if (answer === undefined || answer.decision === 'rejected') return;
          break;
        }
        case 'input': {
          const input = deferred<AgentUserInput>();
          pendingInput = input;
          if (!(await ready())) return;
          yield stamp({
            type: 'input.requested',
            request: { id: 'input-1', prompt: 'Preciso de uma resposta.' },
          });
          if ((await answerOrHalt(input.promise)) === undefined) return;
          break;
        }
        case 'hold':
          await answerOrHalt(hold.promise);
          if (halted) return;
          break;
        case 'fail':
          if (!(await ready())) return;
          yield stamp({
            type: 'session.failed',
            error: { code: 'UNKNOWN', message: step.message, retryable: false },
          });
          return;
        case 'throw':
          throw new Error('falha inesperada do agente de teste');
        case 'end':
          return;
      }
    }
    if (!(await ready())) return;
    yield stamp({ type: 'session.completed', result: { summary: 'roteiro concluído' } });
  }

  const events = run();
  return {
    id: 'fake-session',
    events: () => events,
    send(input) {
      if (options.failDelivery === true) {
        return Promise.reject(new Error('entrega recusada pelo agente de teste'));
      }
      if (pendingInput === undefined) return Promise.reject(new Error('sem entrada pendente'));
      record.inputs.push(input);
      pendingInput.resolve(input);
      pendingInput = undefined;
      return Promise.resolve();
    },
    approve(input) {
      if (options.failDelivery === true) {
        return Promise.reject(new Error('entrega recusada pelo agente de teste'));
      }
      if (pendingApproval === undefined) return Promise.reject(new Error('sem aprovação pendente'));
      record.decisions.push(input);
      pendingApproval.resolve(input);
      pendingApproval = undefined;
      return Promise.resolve();
    },
    pause() {
      record.pauses += 1;
      if (options.failPause === true) {
        return Promise.reject(new Error('pausa recusada pelo agente de teste'));
      }
      pausedGate ??= deferred<void>();
      return Promise.resolve();
    },
    resume() {
      record.resumes += 1;
      if (options.failResume === true) {
        return Promise.reject(new Error('retomada recusada pelo agente de teste'));
      }
      const paused = pausedGate;
      pausedGate = undefined;
      paused?.resolve();
      return Promise.resolve();
    },
    stop(reason) {
      record.stopReasons.push(reason);
      halted = true;
      halt.resolve();
      if (options.failStop === true) {
        return Promise.reject(new Error('parada recusada pelo agente de teste'));
      }
      return Promise.resolve();
    },
  };
}
