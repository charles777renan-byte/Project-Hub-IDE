import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentConfig,
  AgentEvent,
  AgentProbeResult,
  AgentSession,
  AgentStartInput,
} from '@project-hub/agent-sdk';
import type { UsageSummary } from '@project-hub/domain';
import {
  isClearSessionEnd,
  mapHookEntry,
  writeHookScript,
  writeSettingsFile,
  type HookRecord,
} from './settings';
import {
  claudeConfigDirOf,
  createTranscriptUsageTracker,
  type TranscriptUsageTracker,
} from './transcript-usage';

/** Terminal do processo de terminais, pelo que o adaptador usa. A porta da aplicação satisfaz este tipo. */
export type ClaudeTerminal = {
  open(input: {
    id: string;
    cwd: string;
    command: string;
    args: readonly string[];
    env: Readonly<Record<string, string>>;
  }): Promise<void>;
  write(id: string, data: string): Promise<void>;
  kill(id: string): Promise<void>;
  snapshot(id: string): Promise<{ alive: boolean; exit?: { exitCode: number } } | undefined>;
};

type MaybePromise<T> = T | Promise<T>;

/** Receptor de hooks, pelo que o adaptador usa. O receptor do processo de terminais satisfaz este tipo. */
export type ClaudeHooks = {
  registerExecution(executionId: string): MaybePromise<{ token: string; url: string }>;
  unregisterExecution(executionId: string): MaybePromise<void>;
  readAfter(executionId: string, afterSeq: number): MaybePromise<HookRecord[]>;
};

export type ClaudeCodeAdapterOptions = {
  terminal: ClaudeTerminal;
  hooks: ClaudeHooks;
  /** Pasta dos arquivos de configuração e do script de hook. */
  settingsDir: string;
  /** Executável do Claude Code. Padrão: `claude`, pelo PATH. */
  command?: string;
  /** Argumentos antes dos da sessão. Só os testes usam, para trocar o Claude Code por um CLI falso. */
  commandPrefix?: readonly string[];
  /** Variáveis que o terminal recebe, já filtradas pelo app. */
  env: Readonly<Record<string, string>>;
  /** Intervalo de leitura dos eventos, em ms. Padrão: 200. */
  pollMs?: number;
  /** Roda `<comando> --version` e devolve a saída. Padrão: o processo do sistema. */
  runVersion?: (command: string) => Promise<string>;
  /**
   * Pasta de dados do Claude Code, onde ficam os transcripts. Padrão: `CLAUDE_CONFIG_DIR` do `env` (o
   * mesmo que o terminal recebe), ou `~/.claude`. Precisa ser a mesma do terminal, senão o gasto zera.
   */
  claudeConfigDir?: string;
  /** Intervalo de leitura do gasto nos transcripts, em ms. Padrão: 1500. */
  usageIntervalMs?: number;
  /** Espera entre as leituras finais do gasto, no fim da sessão, em ms. Padrão: 400. */
  usageDrainDelayMs?: number;
};

const DEFAULT_COMMAND = 'claude';
const DEFAULT_POLL_MS = 200;
const DEFAULT_USAGE_INTERVAL_MS = 1500;
const DEFAULT_USAGE_DRAIN_DELAY_MS = 400;
/** Leituras finais do gasto: o transcript é gravado depois do hook, e a última resposta pode atrasar. */
const USAGE_DRAIN_READS = 3;
const NO_APP_APPROVAL = 'Esta sessão não aceita aprovação pelo app: a resposta é dada no terminal.';
const NO_PAUSE =
  'Esta sessão não pausa: o agente roda num terminal, e a pausa fica fora desta etapa.';

/**
 * Capacidades do Claude Code neste adaptador. A aprovação e a resposta acontecem no terminal, por isso
 * `approvals` fica falso. Pausar e retomar ficam de fora nesta etapa. O gasto de tokens vem dos
 * transcripts que o Claude Code grava.
 */
export const CLAUDE_CODE_CAPABILITIES: Omit<AgentCapabilities, 'models'> = {
  streaming: false,
  tools: true,
  interactiveInput: true,
  approvals: false,
  pauseResume: false,
  attachments: false,
  usageReporting: true,
  persistentContext: false,
  localExecution: true,
};

/**
 * Adaptador do Claude Code interativo. Cada execução roda o CLI num terminal do processo de terminais,
 * com os hooks passados por `--settings`. Os eventos vêm dos hooks, não da saída do terminal.
 */
export function createClaudeCodeAdapter(options: ClaudeCodeAdapterOptions): AgentAdapter {
  const command = options.command ?? DEFAULT_COMMAND;
  const prefix = options.commandPrefix ?? [];
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const runVersion = options.runVersion ?? readVersion;
  const usage: UsageOptions = {
    configDir: options.claudeConfigDir ?? claudeConfigDirOf(options.env),
    intervalMs: options.usageIntervalMs ?? DEFAULT_USAGE_INTERVAL_MS,
    drainDelayMs: options.usageDrainDelayMs ?? DEFAULT_USAGE_DRAIN_DELAY_MS,
  };

  return {
    type: 'claude-code',

    async probe(): Promise<AgentProbeResult> {
      try {
        return { available: true, message: (await runVersion(command)).trim() };
      } catch (error) {
        return { available: false, message: errorText(error) };
      }
    },

    getCapabilities(config: AgentConfig): Promise<AgentCapabilities> {
      return Promise.resolve({
        ...CLAUDE_CODE_CAPABILITIES,
        models: config.model === undefined ? [] : [config.model],
      });
    },

    async start(input: AgentStartInput, signal: AbortSignal): Promise<AgentSession> {
      if (signal.aborted) throw new Error('o início da sessão foi cancelado');
      const executionId = randomUUID();
      const registration = await options.hooks.registerExecution(executionId);
      const scriptPath = writeHookScript(options.settingsDir);
      const settingsFile = writeSettingsFile(options.settingsDir, executionId, scriptPath);
      // O token vai pelo ambiente do terminal, nunca pela linha de comando, que outros processos leem.
      const env = {
        ...options.env,
        PROJECT_HUB_HOOK_URL: registration.url,
        PROJECT_HUB_HOOK_TOKEN: registration.token,
      };
      const args = [
        ...prefix,
        '--settings',
        settingsFile,
        ...(input.prompt === '' ? [] : [input.prompt]),
      ];
      try {
        await options.terminal.open({ id: executionId, cwd: input.cwd, command, args, env });
      } catch (error) {
        await quietly(() => options.hooks.unregisterExecution(executionId));
        throw error;
      }
      return createSession(executionId, options.terminal, options.hooks, pollMs, usage, signal);
    },

    /**
     * Reanexa a uma execução que continua viva no terminal. Começa depois da posição gravada, então
     * os eventos que já foram aplicados não voltam. Terminal encerrado ou posição inválida: undefined.
     */
    async attach(sessionId: string, cursor: string): Promise<AgentSession | undefined> {
      const fromSeq = Number(cursor);
      if (!Number.isInteger(fromSeq) || fromSeq < 0) return undefined;
      const snapshot = await options.terminal.snapshot(sessionId);
      if (snapshot === undefined || !snapshot.alive) return undefined;
      return createSession(
        sessionId,
        options.terminal,
        options.hooks,
        pollMs,
        usage,
        new AbortController().signal,
        fromSeq,
      );
    },
  };
}

/** Onde e de quanto em quanto tempo o gasto é lido. */
type UsageOptions = { configDir: string; intervalMs: number; drainDelayMs: number };

function createSession(
  executionId: string,
  terminal: ClaudeTerminal,
  hooks: ClaudeHooks,
  pollMs: number,
  usage: UsageOptions,
  signal: AbortSignal,
  fromSeq = 0,
): AgentSession {
  // Posição do último evento que `events()` entregou. Fica no objeto da sessão, para `cursor()` ler.
  const position = { seq: fromSeq };
  return {
    id: executionId,
    externalInput: true,
    events: () => watchEvents(executionId, terminal, hooks, pollMs, usage, signal, position),
    cursor: () => (position.seq > 0 ? String(position.seq) : undefined),

    async send(input) {
      await terminal.write(executionId, `${input.text}\r`);
    },

    approve() {
      return Promise.reject(new Error(NO_APP_APPROVAL));
    },

    pause() {
      return Promise.reject(new Error(NO_PAUSE));
    },

    resume() {
      return Promise.reject(new Error(NO_PAUSE));
    },

    async stop() {
      await terminal.kill(executionId);
    },
  };
}

/**
 * Entrega os eventos dos hooks em ordem, até o SessionEnd. Se o terminal encerra antes disso, lê o que
 * ainda chegou e fecha com falha. O fim do sinal de cancelamento encerra a leitura sem evento.
 *
 * O gasto vem dos transcripts que os hooks apontam, lidos de tempos em tempos, e sai como
 * `usage.updated` com o total da execução, só quando muda. Antes do fim (com sucesso ou falha), o gasto é
 * lido mais algumas vezes, porque a última resposta pode chegar ao arquivo depois do hook. O `SessionEnd`
 * de um `/clear` não encerra: o Claude Code segue no mesmo terminal, com outra sessão e outro transcript.
 */
async function* watchEvents(
  executionId: string,
  terminal: ClaudeTerminal,
  hooks: ClaudeHooks,
  pollMs: number,
  usageOptions: UsageOptions,
  signal: AbortSignal,
  position: { seq: number },
): AsyncGenerator<AgentEvent> {
  let exited = false;
  let waiting = false;
  const usage = createTranscriptUsageTracker({ configDir: usageOptions.configDir });
  let tracking = false;
  let nextUsageRead = 0;
  const learn = (record: HookRecord): void => {
    const path = record.payload['transcript_path'];
    const sessionId = record.payload['session_id'];
    if (typeof path === 'string' && typeof sessionId === 'string') {
      usage.addSession(path, sessionId);
      tracking = true;
    }
  };
  try {
    // Reanexação: os hooks antes da posição não voltam como eventos, mas dizem onde estão os transcripts.
    // O total é refeito do começo de cada arquivo; a soma por resposta não conta nada duas vezes.
    if (position.seq > 0) {
      for (const record of await hooks.readAfter(executionId, 0)) {
        if (record.seq <= position.seq) learn(record);
      }
    }
    while (!signal.aborted) {
      for (const record of await hooks.readAfter(executionId, position.seq)) {
        position.seq = record.seq;
        learn(record);
        const event = mapHookEntry(record);
        if (event !== undefined) {
          if (waiting && event.type !== 'session.completed') {
            waiting = false;
            yield { type: 'input.received', at: record.receivedAt };
          }
          if (event.type === 'session.completed' && tracking) {
            yield* drainUsage(usage, usageOptions.drainDelayMs, signal);
          }
          yield event;
          if (event.type === 'input.requested') waiting = true;
        } else if (waiting && record.payload['hook_event_name'] === 'UserPromptSubmit') {
          waiting = false;
          yield { type: 'input.received', at: record.receivedAt };
        }
        if (record.payload['hook_event_name'] === 'SessionEnd' && !isClearSessionEnd(record)) {
          return;
        }
      }
      if (exited) {
        if (tracking) yield* drainUsage(usage, usageOptions.drainDelayMs, signal);
        yield {
          type: 'session.failed',
          error: {
            code: 'AGENT_PROTOCOL_ERROR',
            message: 'o terminal do agente encerrou antes do fim da sessão',
            retryable: false,
          },
          at: new Date().toISOString(),
        };
        return;
      }
      if (tracking && Date.now() >= nextUsageRead) {
        nextUsageRead = Date.now() + usageOptions.intervalMs;
        const summary = await readUsage(usage);
        if (summary !== undefined) yield usageEvent(summary);
      }
      const snapshot = await terminal.snapshot(executionId);
      exited = snapshot === undefined || !snapshot.alive;
      if (!exited) await sleep(pollMs, signal);
    }
  } finally {
    await quietly(() => hooks.unregisterExecution(executionId));
  }
}

/** Lê o gasto sem nunca derrubar a sessão: um erro de arquivo só deixa o número como estava. */
async function readUsage(usage: TranscriptUsageTracker): Promise<UsageSummary | undefined> {
  try {
    return await usage.poll();
  } catch {
    return undefined;
  }
}

function usageEvent(summary: UsageSummary): AgentEvent {
  return { type: 'usage.updated', usage: summary, at: new Date().toISOString() };
}

/** Últimas leituras do gasto antes do fim, com uma espera entre elas. */
async function* drainUsage(
  usage: TranscriptUsageTracker,
  delayMs: number,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  for (let read = 0; read < USAGE_DRAIN_READS && !signal.aborted; read += 1) {
    if (read > 0) await sleep(delayMs, signal);
    const summary = await readUsage(usage);
    if (summary !== undefined) yield usageEvent(summary);
  }
}

/** Roda a chamada e ignora a falha: soltar o registro não pode derrubar a sessão. */
async function quietly(work: () => MaybePromise<void>): Promise<void> {
  try {
    await work();
  } catch {
    // O processo de terminais pode já ter ido embora.
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function readVersion(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
