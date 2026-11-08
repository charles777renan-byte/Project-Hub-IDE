import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { sessionProviderSchema } from '@project-hub/contracts';

/** Versão do formato do `session-index.json`. Outra versão, ou um arquivo que não lê, é descartado e refeito. */
export const SESSION_INDEX_VERSION = 1;

const detailSchema = z.object({
  title: z.string().nullable(),
  firstPrompt: z.string().nullable(),
  lastAgentText: z.string().nullable(),
  lastTurns: z
    .array(z.object({ role: z.enum(['user', 'agent']), text: z.string() }))
    .nullable(),
  model: z.string().nullable(),
  subagents: z.number().nullable(),
  messages: z.number(),
});

const activitySchema = z.object({
  id: z.string(),
  agent: z.string(),
  cwd: z.string(),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  days: z.array(
    z.object({ date: z.string(), messages: z.number(), tokens: z.number().nullable() }),
  ),
  detail: detailSchema.optional(),
});

const indexedFileSchema = z.object({
  provider: sessionProviderSchema,
  mtimeMs: z.number(),
  size: z.number().int().min(0),
  /** Sessões lidas do arquivo; `null` quando ele falhou na leitura. */
  sessions: z.array(activitySchema).nullable(),
  error: z.string().nullable(),
});

const indexFileSchema = z.object({
  version: z.literal(SESSION_INDEX_VERSION),
  files: z.record(z.string(), indexedFileSchema),
});

/** Um arquivo no índice: a data e o tamanho de quando foi lido, e as sessões que saíram dele (ou o erro). */
export type IndexedFile = z.infer<typeof indexedFileSchema>;

export type SessionIndex = z.infer<typeof indexFileSchema>;

export function emptySessionIndex(): SessionIndex {
  return { version: SESSION_INDEX_VERSION, files: {} };
}

/**
 * Lê o índice de `file`. Arquivo ausente, corrompido, de outra versão ou que não lê devolve um índice vazio:
 * a varredura seguinte refaz tudo, e a lista não fica vazia por causa disso.
 */
export async function loadSessionIndex(file: string): Promise<SessionIndex> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) console.error('Índice de sessões ilegível; será refeito:', error);
    return emptySessionIndex();
  }
  try {
    const parsed = indexFileSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
  } catch {
    // JSON inválido cai aqui: o índice é refeito.
  }
  return emptySessionIndex();
}

/** Grava o índice com escrita atômica: primeiro um arquivo temporário, depois a troca pelo nome final. */
export async function saveSessionIndex(file: string, index: SessionIndex): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(index), 'utf8');
  await rename(temp, file);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
