import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createClaudeSessionReader,
  createCodexSessionReader,
} from '../../src/main/session-readers';

const FILE_A = '11111111-1111-4111-8111-111111111111';
const FILE_B = '22222222-2222-4222-8222-222222222222';
/** O `sessionId` gravado dentro dos dois transcripts: o de um original que foi copiado ou retomado. */
const CONTENT_ID = '99999999-9999-4999-8999-999999999999';
const DAY = '2026-10-30T12:00:00.000Z';

function transcript(sessionId: string, cwd: string): string {
  return (
    JSON.stringify({
      type: 'user',
      sessionId,
      cwd,
      timestamp: DAY,
      message: { role: 'user', content: 'oi' },
    }) + '\n'
  );
}

describe('createClaudeSessionReader', () => {
  let root: string;
  let projects: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ph-session-readers-'));
    projects = join(root, 'projects', 'C--proj-x');
    mkdirSync(projects, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function reader(maxFileBytes?: number) {
    return createClaudeSessionReader({ CLAUDE_CONFIG_DIR: root }, maxFileBytes);
  }

  it('o id é o nome do arquivo quando ele é um UUID, e não o sessionId de dentro', async () => {
    writeFileSync(join(projects, `${FILE_A}.jsonl`), transcript(CONTENT_ID, root));
    writeFileSync(join(projects, `${FILE_B}.jsonl`), transcript(CONTENT_ID, root));

    const a = await reader().read(join(projects, `${FILE_A}.jsonl`));
    const b = await reader().read(join(projects, `${FILE_B}.jsonl`));

    expect(a.map((session) => session.id)).toEqual([FILE_A]);
    expect(b.map((session) => session.id)).toEqual([FILE_B]);
  });

  it('arquivo cujo nome não é um UUID mantém o sessionId de dentro', async () => {
    writeFileSync(join(projects, 'nota-solta.jsonl'), transcript(CONTENT_ID, root));

    const sessions = await reader().read(join(projects, 'nota-solta.jsonl'));

    expect(sessions.map((session) => session.id)).toEqual([CONTENT_ID]);
  });

  it('arquivo acima do limite de tamanho vira ilegível (lança), sem ler o conteúdo', async () => {
    const file = join(projects, `${FILE_A}.jsonl`);
    writeFileSync(file, transcript(CONTENT_ID, root));

    await expect(reader(10).read(file)).rejects.toThrow(/limite/);
    await expect(reader(1_000_000).read(file)).resolves.toHaveLength(1);
  });
});

describe('createCodexSessionReader', () => {
  let root: string;
  let day: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ph-session-readers-codex-'));
    day = join(root, 'sessions', '2026', '10', '30');
    mkdirSync(day, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function rollout(id: string): string {
    return (
      JSON.stringify({
        timestamp: DAY,
        type: 'session_meta',
        payload: { id, timestamp: DAY, cwd: root },
      }) + '\n'
    );
  }

  it('um .zst que expande além do limite lança, e o .zst pequeno do lado segue lendo', async () => {
    // Pequeno depois de comprimido, grande depois de aberto: o padding passa do limite passado ao leitor.
    const bomb = rollout('bomba') + ' '.repeat(200_000);
    const small = rollout('pequena');
    writeFileSync(join(day, 'rollout-bomba.jsonl.zst'), zstdCompressSync(Buffer.from(bomb)));
    writeFileSync(join(day, 'rollout-pequena.jsonl.zst'), zstdCompressSync(Buffer.from(small)));
    const reader = createCodexSessionReader({ CODEX_HOME: root }, 50_000);

    await expect(reader.read(join(day, 'rollout-bomba.jsonl.zst'))).rejects.toThrow();
    const sessions = await reader.read(join(day, 'rollout-pequena.jsonl.zst'));
    expect(sessions.map((session) => session.id)).toEqual(['pequena']);
  });
});
