import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import {
  MODEL_NAME_MAX_LENGTH,
  contextTokensOf,
  summarizeUsage,
  type MessageUsage,
  type UsageSummary,
} from '@project-hub/domain';

/**
 * A pasta de dados do Claude Code que o terminal vai usar: `CLAUDE_CONFIG_DIR` do ambiente do terminal
 * (o nome é comparado sem diferenciar maiúsculas, como no Windows), ou `~/.claude`. Quem lê os
 * transcripts precisa passar o mesmo ambiente que o terminal recebe, senão procura na conta errada.
 */
export function claudeConfigDirOf(env: Readonly<Record<string, string | undefined>>): string {
  const entry = Object.entries(env).find(([key]) => key.toUpperCase() === 'CLAUDE_CONFIG_DIR');
  const value = entry?.[1];
  return value !== undefined && value !== '' ? value : join(homedir(), '.claude');
}

/** Transcript principal de uma sessão: `<pasta do projeto>/<session_id>.jsonl`. */
const SESSION_FILE = /^[0-9A-Za-z][0-9A-Za-z-]{7,63}\.jsonl$/;
/** Transcript de um subagente: `<session_id>/subagents/agent-<id>.jsonl`. */
const SUBAGENT_FILE = /^agent-[A-Za-z0-9_-]{1,64}\.jsonl$/;
const NEWLINE = 0x0a;

/**
 * Separa as linhas completas de um trecho lido: só até a última quebra de linha. O resto é uma linha
 * que o Claude Code ainda está gravando, e fica para a próxima leitura. Cortar no byte da quebra não
 * parte um caractere: em UTF-8, esse byte nunca aparece no meio de um caractere.
 */
export function takeCompleteLines(bytes: Buffer): { lines: string[]; consumed: number } {
  const last = bytes.lastIndexOf(NEWLINE);
  if (last < 0) return { lines: [], consumed: 0 };
  const lines = bytes
    .subarray(0, last)
    .toString('utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  return { lines, consumed: last + 1 };
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lê o uso de uma linha de resposta do transcript. Só os números saem daqui: o texto da resposta não é
 * copiado. `at` é o `timestamp` da linha em milissegundos, só quando for uma data válida. Linha que não
 * é resposta, ou fora do formato, devolve `undefined`; a mensagem de erro do `JSON.parse` é descartada,
 * porque pode trazer um pedaço da linha.
 */
export function readUsageLine(
  line: string,
): { id: string; usage: MessageUsage; at?: number } | undefined {
  // Filtro barato antes do parse: a maioria das linhas é anexo ou pedido, e nenhuma delas tem uso.
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(record) || record['type'] !== 'assistant') return undefined;
  const message = record['message'];
  if (!isRecord(message) || typeof message['id'] !== 'string' || message['id'] === '') {
    return undefined;
  }
  const usage = message['usage'];
  if (!isRecord(usage)) return undefined;
  const input = count(usage['input_tokens']);
  const output = count(usage['output_tokens']);
  if (input === undefined || output === undefined) return undefined;
  // Sem a divisão por validade, a escrita conta como de 5 minutos (a mais barata): a estimativa fica por baixo.
  const breakdown = isRecord(usage['cache_creation']) ? usage['cache_creation'] : undefined;
  const write5m = count(breakdown?.['ephemeral_5m_input_tokens']);
  const write1h = count(breakdown?.['ephemeral_1h_input_tokens']);
  const writeTotal = count(usage['cache_creation_input_tokens']) ?? 0;
  const parsed: MessageUsage = {
    model: typeof message['model'] === 'string' ? message['model'] : '',
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: count(usage['cache_read_input_tokens']) ?? 0,
    cacheWrite5mInputTokens:
      write5m === undefined && write1h === undefined ? writeTotal : (write5m ?? 0),
    cacheWrite1hInputTokens: write1h ?? 0,
  };
  if (typeof usage['speed'] === 'string') parsed.speed = usage['speed'];
  if (typeof usage['inference_geo'] === 'string') parsed.inferenceGeo = usage['inference_geo'];
  const at = typeof record['timestamp'] === 'string' ? Date.parse(record['timestamp']) : Number.NaN;
  return Number.isFinite(at)
    ? { id: message['id'], usage: parsed, at }
    : { id: message['id'], usage: parsed };
}

/**
 * A mesma resposta aparece em várias linhas, e o uso cresce enquanto ela é gerada. Fica o maior valor
 * de cada campo: o total nunca cai, e uma linha repetida não conta duas vezes.
 */
function mergeUsage(previous: MessageUsage | undefined, next: MessageUsage): MessageUsage {
  if (previous === undefined) return next;
  return {
    ...next,
    inputTokens: Math.max(previous.inputTokens, next.inputTokens),
    outputTokens: Math.max(previous.outputTokens, next.outputTokens),
    cacheReadInputTokens: Math.max(previous.cacheReadInputTokens, next.cacheReadInputTokens),
    cacheWrite5mInputTokens: Math.max(
      previous.cacheWrite5mInputTokens,
      next.cacheWrite5mInputTokens,
    ),
    cacheWrite1hInputTokens: Math.max(
      previous.cacheWrite1hInputTokens,
      next.cacheWrite1hInputTokens,
    ),
  };
}

/** `child` está dentro de `parent`, sem sair por `..` nem trocar de unidade. */
function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

/** Resolve o caminho real (junção, link e caixa das letras no Windows). Sem o arquivo, `undefined`. */
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
  path: string;
  /** `pending` até o arquivo existir; `ok` depois de conferido; `rejected` para sempre. */
  state: 'pending' | 'ok' | 'rejected';
};

export type TranscriptUsageTracker = {
  /**
   * Passa a ler o transcript de uma sessão, informado por um hook. Caminho fora de `<raiz>/projects`, ou
   * que não seja `<pasta>/<session_id>.jsonl`, é ignorado: o hook pode ter sido forjado por um processo
   * do terminal, que tem o token. Repetir a mesma sessão não faz nada.
   */
  addSession(transcriptPath: string, sessionId: string): void;
  /** Lê o que chegou nos transcripts. Devolve o total da execução quando ele mudou desde a última vez. */
  poll(): Promise<UsageSummary | undefined>;
  /**
   * O contexto da última resposta da conversa principal: o modelo e os tokens que ela leu. É a resposta
   * principal mais recente entre todas as sessões lidas (um `/clear` abre outra); resposta de subagente
   * nunca conta. Sem nenhuma resposta com uso, `undefined`.
   */
  latestContext(): { model: string; usedTokens: number } | undefined;
};

/**
 * Soma o uso de uma execução a partir dos transcripts do Claude Code: o principal de cada sessão (um
 * `/clear` abre outra) e os dos subagentes, que ficam em arquivos próprios. Cada arquivo é lido só no
 * trecho novo, e a chave da soma é o `message.id`, comum a todos os arquivos da execução. Só as
 * respostas dos transcripts principais disputam o contexto mais recente.
 */
export function createTranscriptUsageTracker(options: {
  /** Pasta de dados do Claude Code (`CLAUDE_CONFIG_DIR`, ou `~/.claude`). */
  configDir: string;
}): TranscriptUsageTracker {
  const projectsRoot = join(options.configDir, 'projects');
  const sessions = new Map<string, Session>();
  const offsets = new Map<string, number>();
  const messages = new Map<string, MessageUsage>();
  let lastEmitted = '';
  /** A resposta principal mais recente. Sem `timestamp` em um dos lados, vale a ordem de leitura. */
  let latest: { id: string; at: number | undefined; usage: MessageUsage } | undefined;

  function verify(session: Session): void {
    if (session.state !== 'pending' || !existsSync(session.path)) return;
    const root = realPath(projectsRoot);
    const file = realPath(session.path);
    session.state =
      root !== undefined &&
      file !== undefined &&
      isInside(root, file) &&
      relative(root, file).split(sep).length === 2 &&
      isFile(file)
        ? 'ok'
        : 'rejected';
    if (session.state === 'ok' && file !== undefined) session.path = file;
  }

  /** Os transcripts dos subagentes de uma sessão. Um link que sai da pasta da sessão fica de fora. */
  function subagentFiles(sessionFile: string): string[] {
    const sessionFolder = join(dirname(sessionFile), basename(sessionFile, '.jsonl'));
    const folder = join(sessionFolder, 'subagents');
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return [];
    }
    const files: string[] = [];
    // A pasta da sessão também pode ser um link: o arquivo precisa ficar dentro da raiz real dos projetos.
    const root = realPath(projectsRoot);
    const folderReal = realPath(sessionFolder);
    if (root === undefined || folderReal === undefined || !isInside(root, folderReal)) return [];
    for (const name of names) {
      if (!SUBAGENT_FILE.test(name)) continue;
      const file = realPath(join(folder, name));
      if (file !== undefined && isInside(folderReal, file) && isFile(file)) files.push(file);
    }
    return files;
  }

  /** Atualiza a resposta principal mais recente com uma linha lida de um transcript principal. */
  function trackLatest(parsed: { id: string; usage: MessageUsage; at?: number }): void {
    // Resposta sintética (tudo zero) não é contexto: não cria nem derruba o anterior.
    if (contextTokensOf(parsed.usage) === 0) return;
    if (latest?.id === parsed.id) {
      latest = { ...latest, usage: mergeUsage(latest.usage, parsed.usage) };
      return;
    }
    const newer =
      latest === undefined ||
      latest.at === undefined ||
      parsed.at === undefined ||
      parsed.at > latest.at;
    if (newer) latest = { id: parsed.id, at: parsed.at, usage: parsed.usage };
  }

  async function readNew(file: string, isMain: boolean): Promise<void> {
    let handle;
    try {
      handle = await open(file, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await handle.stat();
      let offset = offsets.get(file) ?? 0;
      // Arquivo menor que a posição foi trocado: recomeça. A soma por id não conta nada duas vezes.
      if (size < offset) offset = 0;
      if (size === offset) return;
      const bytes = Buffer.alloc(size - offset);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
      const { lines, consumed } = takeCompleteLines(bytes.subarray(0, bytesRead));
      offsets.set(file, offset + consumed);
      for (const line of lines) {
        const parsed = readUsageLine(line);
        if (parsed !== undefined) {
          messages.set(parsed.id, mergeUsage(messages.get(parsed.id), parsed.usage));
          if (isMain) trackLatest(parsed);
        }
      }
    } finally {
      await handle.close();
    }
  }

  return {
    addSession(transcriptPath, sessionId) {
      if (sessions.has(transcriptPath)) return;
      const lexicallyValid =
        isAbsolute(transcriptPath) &&
        SESSION_FILE.test(basename(transcriptPath)) &&
        basename(transcriptPath) === `${sessionId}.jsonl` &&
        isInside(projectsRoot, transcriptPath) &&
        relative(projectsRoot, transcriptPath).split(sep).length === 2;
      sessions.set(transcriptPath, {
        path: transcriptPath,
        state: lexicallyValid ? 'pending' : 'rejected',
      });
    },

    async poll() {
      for (const session of sessions.values()) {
        verify(session);
        if (session.state !== 'ok') continue;
        await readNew(session.path, true);
        for (const file of subagentFiles(session.path)) await readNew(file, false);
      }
      if (messages.size === 0) return undefined;
      const summary = summarizeUsage(messages.values());
      const key = JSON.stringify(summary);
      if (key === lastEmitted) return undefined;
      lastEmitted = key;
      return summary;
    },

    latestContext() {
      // Nome longo demais não é um id de modelo: a resposta continua na soma, mas não vira contexto.
      if (latest === undefined || latest.usage.model.length > MODEL_NAME_MAX_LENGTH)
        return undefined;
      return { model: latest.usage.model, usedTokens: contextTokensOf(latest.usage) };
    },
  };
}
