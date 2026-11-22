import { existsSync, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { summarizeUsage, type MessageUsage } from '@project-hub/domain';
import { takeCompleteLines, type TranscriptUsageTracker } from '../claude-code/transcript-usage';

/** Arquivo de uma sessão do Codex: `rollout-<hora>-<id da sessão>.jsonl`. */
const ROLLOUT_FILE = /^rollout-[0-9A-Za-z-]{1,40}\.jsonl$/;
const SESSION_ID = /^[0-9A-Za-z][0-9A-Za-z-]{7,63}$/;
/** `<raiz>/sessions/AAAA/MM/DD/rollout-*.jsonl`: quatro trechos dentro de `sessions`. */
const ROLLOUT_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/**
 * Lê o uso de uma linha `token_count` do rollout do Codex. O Codex grava o total acumulado da sessão, e a
 * entrada dele já inclui o que veio do cache: a entrada nova é a diferença. A saída já inclui o raciocínio.
 * Só os números saem daqui, e `model` fica vazio, o que deixa o gasto sem custo estimado (não há tabela de
 * preços do Codex). Qualquer outra linha, ou uma fora do formato, devolve `undefined`.
 */
export function readCodexTokenLine(line: string): MessageUsage | undefined {
  // Filtro barato antes do parse: a maioria das linhas é item de conversa, sem uso.
  if (!line.includes('"token_count"')) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(record) || record['type'] !== 'event_msg') return undefined;
  const payload = record['payload'];
  if (!isRecord(payload) || payload['type'] !== 'token_count') return undefined;
  const info = payload['info'];
  const total = isRecord(info) ? info['total_token_usage'] : undefined;
  if (!isRecord(total)) return undefined;
  const input = count(total['input_tokens']);
  const output = count(total['output_tokens']);
  if (input === undefined || output === undefined) return undefined;
  const cached = count(total['cached_input_tokens']) ?? 0;
  return {
    model: '',
    inputTokens: Math.max(0, input - cached),
    outputTokens: output,
    cacheReadInputTokens: cached,
    cacheWrite5mInputTokens: count(total['cache_write_input_tokens']) ?? 0,
    cacheWrite1hInputTokens: 0,
  };
}

/** O total acumulado nunca cai: fica o maior valor de cada campo, e uma linha repetida não conta duas vezes. */
function maxUsage(previous: MessageUsage | undefined, next: MessageUsage): MessageUsage {
  if (previous === undefined) return next;
  return {
    model: '',
    inputTokens: Math.max(previous.inputTokens, next.inputTokens),
    outputTokens: Math.max(previous.outputTokens, next.outputTokens),
    cacheReadInputTokens: Math.max(previous.cacheReadInputTokens, next.cacheReadInputTokens),
    cacheWrite5mInputTokens: Math.max(
      previous.cacheWrite5mInputTokens,
      next.cacheWrite5mInputTokens,
    ),
    cacheWrite1hInputTokens: 0,
  };
}

/** `child` está dentro de `parent`, sem sair por `..` nem trocar de unidade. */
function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

function realPath(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

type Session = {
  id: string;
  path: string;
  /** `pending` até o arquivo existir; `ok` depois de conferido; `rejected` para sempre. */
  state: 'pending' | 'ok' | 'rejected';
};

/**
 * Soma o uso de um terminal do Codex a partir dos rollouts que os hooks apontam. Cada sessão conta pelo
 * último total acumulado que gravou; um `/new` abre outra sessão, e as duas somam. Uma sessão retomada
 * continua no mesmo arquivo, com o total de antes. O caminho só vale dentro de `<raiz>/sessions/AAAA/MM/DD`:
 * o hook pode ter sido forjado por um processo do terminal, que tem o token. O Codex não grava contexto que
 * o app saiba ler, então `latestContext` não devolve nada.
 */
export function createCodexUsageTracker(options: {
  /** Pasta de dados do Codex (`CODEX_HOME`, ou `~/.codex`). */
  codexHome: string;
}): TranscriptUsageTracker {
  const sessionsRoot = join(options.codexHome, 'sessions');
  const sessions = new Map<string, Session>();
  const offsets = new Map<string, number>();
  /** Total de cada sessão, pelo id dela. */
  const totals = new Map<string, MessageUsage>();
  let lastEmitted = '';

  function verify(session: Session): void {
    if (session.state !== 'pending' || !existsSync(session.path)) return;
    const root = realPath(sessionsRoot);
    const file = realPath(session.path);
    session.state =
      root !== undefined &&
      file !== undefined &&
      isInside(root, file) &&
      relative(root, file).split(sep).length === ROLLOUT_DEPTH &&
      isFile(file)
        ? 'ok'
        : 'rejected';
    if (session.state === 'ok' && file !== undefined) session.path = file;
  }

  async function readNew(session: Session): Promise<void> {
    let handle;
    try {
      handle = await open(session.path, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await handle.stat();
      let offset = offsets.get(session.path) ?? 0;
      // Arquivo menor que a posição foi trocado: recomeça. O maior valor por sessão não conta nada duas vezes.
      if (size < offset) offset = 0;
      if (size === offset) return;
      const bytes = Buffer.alloc(size - offset);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      const { lines, consumed } = takeCompleteLines(bytes.subarray(0, bytesRead));
      offsets.set(session.path, offset + consumed);
      for (const line of lines) {
        const parsed = readCodexTokenLine(line);
        if (parsed !== undefined) totals.set(session.id, maxUsage(totals.get(session.id), parsed));
      }
    } finally {
      await handle.close();
    }
  }

  return {
    addSession(transcriptPath, sessionId) {
      if (sessions.has(transcriptPath)) return;
      const name = basename(transcriptPath);
      const lexicallyValid =
        isAbsolute(transcriptPath) &&
        SESSION_ID.test(sessionId) &&
        ROLLOUT_FILE.test(name.replace(`-${sessionId}.jsonl`, '.jsonl')) &&
        name.endsWith(`-${sessionId}.jsonl`) &&
        isInside(sessionsRoot, transcriptPath) &&
        relative(sessionsRoot, transcriptPath).split(sep).length === ROLLOUT_DEPTH;
      sessions.set(transcriptPath, {
        id: sessionId,
        path: transcriptPath,
        state: lexicallyValid ? 'pending' : 'rejected',
      });
    },

    async poll() {
      for (const session of sessions.values()) {
        verify(session);
        if (session.state === 'ok') await readNew(session);
      }
      if (totals.size === 0) return undefined;
      const summary = summarizeUsage(totals.values());
      const key = JSON.stringify(summary);
      if (key === lastEmitted) return undefined;
      lastEmitted = key;
      return summary;
    },

    latestContext: () => undefined,
    // O limite de uso do Codex não é lido daqui: a troca automática de conta vale só para o Claude Code.
    takeLimitHits: () => [],
  };
}
