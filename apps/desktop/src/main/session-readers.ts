import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  MAX_SESSION_FILE_BYTES,
  antigravityHistoryFile,
  claudeConfigDirOf,
  codexHomeOf,
  listCodexSessions,
  readAntigravityHistory,
  readClaudeTranscriptActivity,
  readCodexSessionActivity,
  readCodexSessionFile,
  transcriptCwd,
} from '@project-hub/agent-adapters';
import type { SessionFileInfo, SessionReader } from './session-history';

type Env = Readonly<Record<string, string | undefined>>;

/** Desde o começo dos tempos: a varredura lista todos os arquivos, sem corte por data. */
const SINCE_ALL = '1970-01-01T00:00:00.000Z';

async function namesIn(folder: string, kind: 'file' | 'folder'): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry) => (kind === 'file' ? entry.isFile() : entry.isDirectory()))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** O nome de um transcript do Claude que é o id da sessão: `claude --resume <id>` procura `<id>.jsonl`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Data e tamanho de um arquivo; `undefined` quando ele sumiu entre a listagem e a leitura. */
async function infoOf(path: string): Promise<SessionFileInfo | undefined> {
  try {
    const info = await stat(path);
    return { path, mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return undefined;
  }
}

/**
 * Subagentes de uma sessão do Claude: os `agent-*.jsonl` da pasta `<sessão>/subagents`. As linhas laterais
 * ficam nesses arquivos, não no principal, então é daqui que sai o número.
 */
async function countSubagents(transcript: string): Promise<number> {
  const folder = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents');
  const names = await namesIn(folder, 'file');
  return names.filter((name) => /^agent-.*\.jsonl$/.test(name)).length;
}

/**
 * Leitor do Claude Code: todo `projects/<pasta>/*.jsonl`, de todas as pastas. A pasta de trabalho vem do
 * próprio transcript (`transcriptCwd`), porque o nome da pasta não se desfaz. Transcript sem nenhum `cwd`,
 * ou sem horário, não tem sessão para mostrar e fica de fora sem contar como ilegível. O id da sessão é o nome do
 * arquivo (sem `.jsonl`) quando ele é um UUID, e não o `sessionId` de dentro: um transcript copiado ou retomado
 * leva o id do original lá dentro, e é o nome que o `claude --resume` procura. Nome que não é UUID mantém o
 * `sessionId` de dentro. Arquivo acima de `maxFileBytes` lança, e vira ilegível.
 */
export function createClaudeSessionReader(
  env: Env,
  maxFileBytes: number = MAX_SESSION_FILE_BYTES,
): SessionReader {
  const projects = join(claudeConfigDirOf(env), 'projects');
  return {
    provider: 'claude',
    async files(): Promise<SessionFileInfo[]> {
      const out: SessionFileInfo[] = [];
      for (const folder of await namesIn(projects, 'folder')) {
        for (const name of await namesIn(join(projects, folder), 'file')) {
          if (!name.endsWith('.jsonl')) continue;
          const info = await infoOf(join(projects, folder, name));
          if (info !== undefined) out.push(info);
        }
      }
      return out;
    },
    async read(path: string) {
      if ((await stat(path)).size > maxFileBytes) {
        throw new Error(`Transcript acima do limite de ${maxFileBytes} bytes: ${path}`);
      }
      const text = await readFile(path, 'utf8');
      const cwd = transcriptCwd(text);
      if (cwd === undefined) return [];
      const activity = readClaudeTranscriptActivity(text, cwd);
      if (activity === undefined) return [];
      const fileId = basename(path, '.jsonl');
      if (UUID.test(fileId)) activity.id = fileId;
      if (activity.detail !== undefined) {
        activity.detail.subagents = await countSubagents(path);
      }
      return [activity];
    },
  };
}

/**
 * Leitor do Codex: os `rollout-*.jsonl` e os `.jsonl.zst` de `<CODEX_HOME>/sessions`, de todos os dias. Erro de
 * leitura ou de descompressão lança e vira ilegível, e o arquivo que passa de `maxFileBytes` também; rollout sem `session_meta` não tem sessão e fica de fora.
 */
export function createCodexSessionReader(
  env: Env,
  maxFileBytes: number = MAX_SESSION_FILE_BYTES,
): SessionReader {
  const home = codexHomeOf(env);
  return {
    provider: 'codex',
    async files(): Promise<SessionFileInfo[]> {
      const out: SessionFileInfo[] = [];
      for (const path of listCodexSessions(home, SINCE_ALL)) {
        const info = await infoOf(path);
        if (info !== undefined) out.push(info);
      }
      return out;
    },
    async read(path: string) {
      const activity = readCodexSessionActivity(readCodexSessionFile(path, maxFileBytes));
      return activity === undefined ? [] : [activity];
    },
  };
}

/** Leitor do Antigravity CLI: um só arquivo, o `history.jsonl`, com uma sessão por conversa. */
export function createAntigravitySessionReader(
  historyFile: string = antigravityHistoryFile(),
): SessionReader {
  return {
    provider: 'antigravity',
    async files(): Promise<SessionFileInfo[]> {
      const info = await infoOf(historyFile);
      return info === undefined ? [] : [info];
    },
    async read(path: string) {
      return readAntigravityHistory(await readFile(path, 'utf8'));
    },
  };
}
