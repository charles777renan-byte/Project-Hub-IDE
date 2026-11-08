import {
  createTranscriptUsageTracker,
  type ClaudeHooks,
  type HookRecord,
  type TranscriptUsageTracker,
} from '@project-hub/agent-adapters';
import type { UsageSummaryDto } from '@project-hub/contracts';
import { contextWindowOf } from '@project-hub/domain';

/** Intervalo mínimo entre duas leituras do mesmo terminal, em ms. É o mesmo da missão. */
export const TERMINAL_USAGE_INTERVAL_MS = 1500;

/** Leituras de hooks por vez: o processo de terminais corta a resposta, e o resto vem na leitura seguinte. */
const MAX_HOOK_PAGES = 20;

export type TerminalUsageDeps = {
  hooks: Pick<ClaudeHooks, 'readAfter'>;
  /** Pasta de dados do Claude Code que os terminais recebem (`CLAUDE_CONFIG_DIR`, ou `~/.claude`). */
  configDir: string;
  /** Relógio em ms. Só serve para espaçar as leituras. */
  now: () => number;
  intervalMs?: number;
  /** Fábrica do leitor de transcripts. Só os testes trocam. */
  createTracker?: (configDir: string) => TranscriptUsageTracker;
};

/**
 * Gasto de tokens dos terminais do Claude Code abertos pelo painel. Não tem timer: lê quando a lista de
 * terminais pede, e no máximo a cada `intervalMs` por terminal.
 */
export type TerminalUsageService = {
  /** Passa a acompanhar o terminal. Repetir não faz nada. */
  track(terminalId: string): void;
  /** Para de acompanhar e solta o leitor. */
  forget(terminalId: string): void;
  isTracked(terminalId: string): boolean;
  /** O total do terminal, lido de novo se a última leitura passou do intervalo. Sem número: `undefined`. */
  usageOf(terminalId: string): Promise<UsageSummaryDto | undefined>;
  /** Modelo e contexto da resposta mais recente, como a última leitura deixou. Não lê de novo. Sem dado: `undefined`. */
  contextOf(terminalId: string): TerminalContext | undefined;
};

export type TerminalContext = { model: string; usedTokens: number; windowTokens: number };

type Entry = {
  tracker: TranscriptUsageTracker;
  /** Posição do último hook lido. Começa em 0: um terminal recuperado reaprende tudo pelo log em disco. */
  seq: number;
  /** Algum hook apontou um transcript. Antes disso, não há o que ler. */
  learned: boolean;
  /** Último total lido. O leitor só devolve o total quando ele muda, então o valor fica guardado aqui. */
  last: UsageSummaryDto | undefined;
  /** Último contexto lido. Guardado à parte do total: o contexto muda (`/compact`) com a soma igual. */
  context: TerminalContext | undefined;
  nextReadAt: number;
  reading: Promise<void> | undefined;
};

/**
 * Cada terminal tem o seu leitor de transcripts. Os transcripts vêm dos hooks `SessionStart` (que trazem
 * `transcript_path` e `session_id`): um `/clear` dispara outro, e a sessão nova entra na mesma soma. O log
 * de hooks fica em disco e sobrevive ao reinício do app, então um terminal recuperado refaz o total do zero
 * (a soma por resposta não conta nada duas vezes).
 */
export function createTerminalUsageService(deps: TerminalUsageDeps): TerminalUsageService {
  const intervalMs = deps.intervalMs ?? TERMINAL_USAGE_INTERVAL_MS;
  const newTracker =
    deps.createTracker ?? ((configDir) => createTranscriptUsageTracker({ configDir }));
  const entries = new Map<string, Entry>();

  function learn(entry: Entry, record: HookRecord): void {
    // Registro grande demais chega sem o conteúdo: não aponta transcript nenhum.
    if (record.payload['truncated'] === true) return;
    const path = record.payload['transcript_path'];
    const sessionId = record.payload['session_id'];
    if (typeof path === 'string' && typeof sessionId === 'string') {
      entry.tracker.addSession(path, sessionId);
      entry.learned = true;
    }
  }

  /** Lê os hooks novos, até o fim ou até o limite de páginas. */
  async function readHooks(terminalId: string, entry: Entry): Promise<void> {
    for (let page = 0; page < MAX_HOOK_PAGES; page += 1) {
      const records = await deps.hooks.readAfter(terminalId, entry.seq);
      if (records.length === 0) return;
      for (const record of records) {
        if (record.seq <= entry.seq) continue;
        entry.seq = record.seq;
        learn(entry, record);
      }
    }
  }

  async function refresh(terminalId: string, entry: Entry): Promise<void> {
    try {
      await readHooks(terminalId, entry);
      if (!entry.learned) return;
      const summary = await entry.tracker.poll();
      if (summary !== undefined) entry.last = summary;
      // O contexto vale mesmo quando o total não mudou: um /compact derruba o contexto e a soma segue igual.
      const latest = entry.tracker.latestContext();
      entry.context =
        latest === undefined
          ? undefined
          : { ...latest, windowTokens: contextWindowOf(latest.model) };
    } catch (error) {
      // Leitura que falha não derruba a lista: o número fica como estava e tenta de novo no próximo intervalo.
      console.warn('Falha ao ler o gasto de tokens do terminal:', error);
    }
  }

  return {
    track(terminalId) {
      if (entries.has(terminalId)) return;
      entries.set(terminalId, {
        tracker: newTracker(deps.configDir),
        seq: 0,
        learned: false,
        last: undefined,
        context: undefined,
        nextReadAt: 0,
        reading: undefined,
      });
    },

    forget(terminalId) {
      entries.delete(terminalId);
    },

    isTracked: (terminalId) => entries.has(terminalId),

    async usageOf(terminalId) {
      const entry = entries.get(terminalId);
      if (entry === undefined) return undefined;
      const now = deps.now();
      if (entry.reading === undefined && now >= entry.nextReadAt) {
        entry.nextReadAt = now + intervalMs;
        entry.reading = refresh(terminalId, entry).finally(() => {
          entry.reading = undefined;
        });
      }
      // Quem chega com uma leitura em andamento espera por ela, em vez de devolver o total velho.
      if (entry.reading !== undefined) await entry.reading;
      return entry.last;
    },

    contextOf: (terminalId) => entries.get(terminalId)?.context,
  };
}
