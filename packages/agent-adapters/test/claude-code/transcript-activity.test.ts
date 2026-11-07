import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listClaudeTranscripts,
  readClaudeTranscriptActivity,
  transcriptCwd,
} from '../../src/claude-code/transcript-activity';

const CWD = String.raw`C:\proj\x`;

function at(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

const SESSION_ID = '5f0c2a7e-8d1b-4c3a-9e2f-1a2b3c4d5e6f';

function userLine(timestamp: string, content: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp,
    sessionId: SESSION_ID,
    message: { role: 'user', content },
    ...extra,
  });
}

function assistantLine(
  timestamp: string,
  id: string,
  input: number,
  output: number,
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    sessionId: SESSION_ID,
    message: {
      id,
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'texto' }],
      usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 5000 },
    },
  });
}

function transcript(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('readClaudeTranscriptActivity', () => {
  it('conta as mensagens do usuário por dia local', () => {
    const text = transcript(
      userLine(at(2026, 10, 30, 9), 'primeira'),
      userLine(at(2026, 10, 30, 15), [{ type: 'text', text: 'segunda' }]),
      userLine(at(2026, 10, 31, 10), 'terceira'),
    );
    const activity = readClaudeTranscriptActivity(text, CWD);
    expect(activity).toMatchObject({
      id: SESSION_ID,
      agent: 'claude',
      cwd: CWD,
      startedAt: at(2026, 10, 30, 9),
      days: [
        { date: '2026-10-30', messages: 2, tokens: 0 },
        { date: '2026-10-31', messages: 1, tokens: 0 },
      ],
    });
  });

  it('não conta linha meta, comando de barra nem tool_result', () => {
    const text = transcript(
      userLine(at(2026, 10, 30, 9), 'real'),
      userLine(at(2026, 10, 30, 10), 'meta', { isMeta: true }),
      userLine(at(2026, 10, 30, 11), '<command-name>/model</command-name>'),
      userLine(at(2026, 10, 30, 12), [{ type: 'text', text: '<local-command-stdout>ok</local-command-stdout>' }]),
      userLine(at(2026, 10, 30, 13), [{ type: 'tool_result', tool_use_id: 'x', content: 'saída' }]),
    );
    const activity = readClaudeTranscriptActivity(text, CWD);
    expect(activity?.days).toEqual([{ date: '2026-10-30', messages: 1, tokens: 0 }]);
  });

  it('conta uma vez a resposta repetida, com o uso final', () => {
    const text = transcript(
      userLine(at(2026, 10, 30, 9), 'oi'),
      assistantLine(at(2026, 10, 30, 9, 1), 'msg_1', 100, 10),
      assistantLine(at(2026, 10, 30, 9, 2), 'msg_1', 100, 40),
    );
    const activity = readClaudeTranscriptActivity(text, CWD);
    expect(activity?.days).toEqual([{ date: '2026-10-30', messages: 1, tokens: 140 }]);
  });

  it('reparte os tokens pelo dia local de cada resposta', () => {
    const text = transcript(
      userLine(at(2026, 10, 30, 23, 50), 'oi'),
      assistantLine(new Date(2026, 9, 30, 23, 59).toISOString(), 'msg_1', 10, 20),
      assistantLine(new Date(2026, 9, 31, 0, 1).toISOString(), 'msg_2', 30, 40),
    );
    const activity = readClaudeTranscriptActivity(text, CWD);
    expect(activity?.days).toEqual([
      { date: '2026-10-30', messages: 1, tokens: 30 },
      { date: '2026-10-31', messages: 0, tokens: 70 },
    ]);
  });

  it('ignora linha que não é JSON, inclusive a cortada no fim', () => {
    const text = transcript(userLine(at(2026, 10, 30, 9), 'oi'), 'lixo', '{"type":');
    const activity = readClaudeTranscriptActivity(text, CWD);
    expect(activity?.days).toEqual([{ date: '2026-10-30', messages: 1, tokens: 0 }]);
  });

  it('devolve undefined sem nenhum timestamp', () => {
    expect(readClaudeTranscriptActivity('', CWD)).toBeUndefined();
    expect(
      readClaudeTranscriptActivity(JSON.stringify({ type: 'user', message: { content: 'x' } }), CWD),
    ).toBeUndefined();
  });
});

describe('transcriptCwd', () => {
  it('devolve o cwd da primeira linha que o traz', () => {
    const text = transcript(
      JSON.stringify({ type: 'summary' }),
      JSON.stringify({ type: 'user', cwd: CWD, timestamp: at(2026, 10, 30, 9), message: { content: 'oi' } }),
      JSON.stringify({ type: 'user', cwd: 'C:\\outro', timestamp: at(2026, 10, 30, 10), message: { content: 'x' } }),
    );
    expect(transcriptCwd(text)).toBe(CWD);
  });

  it('devolve undefined quando nenhuma linha traz cwd, e ignora linha que não é JSON', () => {
    expect(transcriptCwd(transcript('lixo', JSON.stringify({ type: 'summary' })))).toBeUndefined();
  });
});

describe('listClaudeTranscripts', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ph-claude-activity-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('acha os .jsonl da pasta codificada do projeto', () => {
    const folder = join(configDir, 'projects', 'C--proj-x');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'a.jsonl'), '');
    writeFileSync(join(folder, 'nota.txt'), '');
    expect(listClaudeTranscripts(configDir, CWD)).toEqual([join(folder, 'a.jsonl')]);
  });

  it('devolve lista vazia quando a pasta não existe', () => {
    expect(listClaudeTranscripts(configDir, String.raw`C:\outra\pasta`)).toEqual([]);
  });
});
