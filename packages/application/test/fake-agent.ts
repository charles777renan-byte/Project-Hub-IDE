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

/** Passo de um roteiro de teste. Os eventos de início e de fim da sessão o próprio agente emite. */
export type FakeStep =
  | { kind: 'event'; event: AgentEventDraft }
  | { kind: 'approval' }
  | { kind: 'input' }
  | { kind: 'fail'; message: string }
  | { kind: 'throw' }
  | { kind: 'end' };

export type FakeSession = {
  stopReasons: string[];
  decisions: AgentApprovalDecision[];
  inputs: AgentUserInput[];
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
  pauseResume: false,
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

/**
 * Agente de teste. Cada `start` usa o próximo roteiro da lista. Sem roteiro, a sessão só emite
 * início e fim. Com `failStart`, `start` rejeita, como um agente indisponível.
 */
export function fakeAgent(scripts: FakeStep[][], options: { failStart?: boolean } = {}): FakeAgent {
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
      if (options.failStart === true) {
        return Promise.reject(new Error('agente indisponível'));
      }
      const script = scripts[count] ?? [];
      count += 1;
      const record: FakeSession = { stopReasons: [], decisions: [], inputs: [] };
      sessions.push(record);
      return Promise.resolve(createFakeSession(script, record));
    },
  };
}

/** Sessão que segue o roteiro. Aprovação e entrada param o roteiro até a resposta ou o `stop`. */
function createFakeSession(script: FakeStep[], record: FakeSession): AgentSession {
  let halted = false;
  const halt = deferred<void>();
  let pendingApproval: Deferred<AgentApprovalDecision> | undefined;
  let pendingInput: Deferred<AgentUserInput> | undefined;

  /** Espera a resposta; `undefined` quando a sessão foi parada antes. */
  const answerOrHalt = <T>(answer: Promise<T>): Promise<T | undefined> =>
    Promise.race([answer, halt.promise.then(() => undefined)]);

  const stamp = (event: Unstamped<AgentEvent>): AgentEvent => ({ ...event, at: AT }) as AgentEvent;

  async function* run(): AsyncGenerator<AgentEvent> {
    if (halted) return;
    yield stamp({ type: 'session.started', sessionId: 'fake-session' });
    for (const step of script) {
      if (halted) return;
      switch (step.kind) {
        case 'event':
          yield stamp(step.event);
          break;
        case 'approval': {
          const decision = deferred<AgentApprovalDecision>();
          pendingApproval = decision;
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
          yield stamp({
            type: 'input.requested',
            request: { id: 'input-1', prompt: 'Preciso de uma resposta.' },
          });
          if ((await answerOrHalt(input.promise)) === undefined) return;
          break;
        }
        case 'fail':
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
    yield stamp({ type: 'session.completed', result: { summary: 'roteiro concluído' } });
  }

  const events = run();
  return {
    id: 'fake-session',
    events: () => events,
    send(input) {
      if (pendingInput === undefined) return Promise.reject(new Error('sem entrada pendente'));
      record.inputs.push(input);
      pendingInput.resolve(input);
      pendingInput = undefined;
      return Promise.resolve();
    },
    approve(input) {
      if (pendingApproval === undefined) return Promise.reject(new Error('sem aprovação pendente'));
      record.decisions.push(input);
      pendingApproval.resolve(input);
      pendingApproval = undefined;
      return Promise.resolve();
    },
    pause: () => Promise.resolve(),
    resume: () => Promise.resolve(),
    stop(reason) {
      record.stopReasons.push(reason);
      halted = true;
      halt.resolve();
      return Promise.resolve();
    },
  };
}
