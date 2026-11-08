import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  codexHomeOf,
  listCodexSessions,
  readCodexSessionActivity,
  readCodexSessionFile,
} from '../../src/codex/session-activity';

const FIXTURE = readFileSync(new URL('../fixtures/codex-session.jsonl', import.meta.url), 'utf8');

function at(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function meta(timestamp: string, cwd = String.raw`C:\proj\x`): string {
  return JSON.stringify({
    timestamp,
    type: 'session_meta',
    payload: { id: 'sessao-de-teste', timestamp, cwd, originator: 'codex-tui' },
  });
}

function userMessage(timestamp: string): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      item: { type: 'UserMessage', content: [{ type: 'text', text: 'texto' }] },
    },
  });
}

function tokenCount(timestamp: string, input: number, cached: number, output: number): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
      },
    },
  });
}

function session(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('readCodexSessionActivity', () => {
  it('lê a fixture de uma sessão do CLI: pasta, início, mensagens e tokens do dia', () => {
    // Tokens por linha: (entrada - cache) + saída, em valor acumulado: 3358, 6794, 10360, 10995.
    // A diferença entre elas soma 10995; a linha repetida e a de `info: null` não contam de novo.
    expect(readCodexSessionActivity(FIXTURE)).toMatchObject({
      id: 'sessao',
      agent: 'codex',
      cwd: String.raw`C:\proj\x`,
      startedAt: '2026-10-30T12:00:00.000Z',
      days: [{ date: '2026-10-30', messages: 2, tokens: 10995 }],
    });
  });

  it('conta só as mensagens da pessoa, não as do agente nem as de instrução', () => {
    const text = session(
      meta(at(2026, 10, 30, 9)),
      JSON.stringify({
        timestamp: at(2026, 10, 30, 9, 1),
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'texto' }],
        },
      }),
      userMessage(at(2026, 10, 30, 9, 2)),
      JSON.stringify({
        timestamp: at(2026, 10, 30, 9, 3),
        type: 'event_msg',
        payload: { type: 'item_completed', item: { type: 'AgentMessage' } },
      }),
    );
    expect(readCodexSessionActivity(text)?.days).toEqual([
      { date: '2026-10-30', messages: 1, tokens: 0 },
    ]);
  });

  it('reparte a diferença dos tokens pelo dia local de cada linha', () => {
    const text = session(
      meta(at(2026, 10, 30, 23, 0)),
      userMessage(at(2026, 10, 30, 23, 1)),
      tokenCount(new Date(2026, 9, 30, 23, 59).toISOString(), 1000, 400, 100),
      tokenCount(new Date(2026, 9, 31, 0, 1).toISOString(), 3000, 1400, 300),
    );
    // Acumulado: 700, depois 1900. A primeira conta inteira no dia 30; a diferença (1200) cai no dia 31.
    expect(readCodexSessionActivity(text)?.days).toEqual([
      { date: '2026-10-30', messages: 1, tokens: 700 },
      { date: '2026-10-31', messages: 0, tokens: 1200 },
    ]);
  });

  it('conta zero quando o acumulado diminui e segue a partir do novo valor', () => {
    const text = session(
      meta(at(2026, 10, 30, 9)),
      tokenCount(at(2026, 10, 30, 9, 1), 2000, 0, 0),
      tokenCount(at(2026, 10, 30, 9, 2), 500, 0, 0),
      tokenCount(at(2026, 10, 30, 9, 3), 800, 0, 0),
    );
    expect(readCodexSessionActivity(text)?.days).toEqual([
      { date: '2026-10-30', messages: 0, tokens: 2300 },
    ]);
  });

  it('ignora linha que não é JSON, inclusive a cortada no fim', () => {
    const text = session(
      meta(at(2026, 10, 30, 9)),
      userMessage(at(2026, 10, 30, 9, 1)),
      'lixo',
      '{"type":',
    );
    expect(readCodexSessionActivity(text)?.days).toEqual([
      { date: '2026-10-30', messages: 1, tokens: 0 },
    ]);
  });

  it('devolve undefined sem session_meta', () => {
    expect(readCodexSessionActivity(session(userMessage(at(2026, 10, 30, 9))))).toBeUndefined();
    expect(readCodexSessionActivity('')).toBeUndefined();
  });

  it('devolve undefined quando o session_meta não tem a pasta', () => {
    const semPasta = JSON.stringify({
      timestamp: at(2026, 10, 30, 9),
      type: 'session_meta',
      payload: { timestamp: at(2026, 10, 30, 9) },
    });
    expect(readCodexSessionActivity(session(semPasta))).toBeUndefined();
  });
});

describe('listCodexSessions', () => {
  let codexHome: string;

  beforeEach(() => {
    codexHome = mkdtempSync(join(tmpdir(), 'ph-codex-activity-'));
  });

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true });
  });

  function rollout(year: string, month: string, day: string, name: string): string {
    const folder = join(codexHome, 'sessions', year, month, day);
    mkdirSync(folder, { recursive: true });
    const file = join(folder, name);
    writeFileSync(file, '');
    return file;
  }

  it('ignora os dias anteriores a sinceIso e os arquivos que não são rollout', () => {
    rollout('2026', '10', '20', 'rollout-2026-10-20T10-00-00-aaa.jsonl');
    const dentro = rollout('2026', '10', '25', 'rollout-2026-10-25T10-00-00-bbb.jsonl');
    const depois = rollout('2026', '11', '01', 'rollout-2026-11-01T10-00-00-ccc.jsonl');
    writeFileSync(join(codexHome, 'sessions', '2026', '11', '01', 'nota.txt'), '');
    expect(listCodexSessions(codexHome, at(2026, 10, 25, 8))).toEqual([dentro, depois]);
  });

  it('inclui o próprio dia de sinceIso', () => {
    const mesmoDia = rollout('2026', '10', '25', 'rollout-2026-10-25T01-00-00-aaa.jsonl');
    expect(listCodexSessions(codexHome, at(2026, 10, 25, 23))).toEqual([mesmoDia]);
  });

  it('lista também as sessões comprimidas em .jsonl.zst', () => {
    const comprimida = rollout('2026', '10', '24', 'rollout-2026-10-24T10-00-00-aaa.jsonl.zst');
    const aberta = rollout('2026', '10', '25', 'rollout-2026-10-25T10-00-00-bbb.jsonl');
    expect(listCodexSessions(codexHome, at(2026, 10, 24, 8))).toEqual([comprimida, aberta]);
  });

  it('lista só a forma descomprimida quando a sessão existe nas duas', () => {
    const aberta = rollout('2026', '10', '25', 'rollout-2026-10-25T10-00-00-aaa.jsonl');
    rollout('2026', '10', '25', 'rollout-2026-10-25T10-00-00-aaa.jsonl.zst');
    const outra = rollout('2026', '10', '25', 'rollout-2026-10-25T11-00-00-bbb.jsonl.zst');
    expect(listCodexSessions(codexHome, at(2026, 10, 25, 8))).toEqual([aberta, outra]);
  });

  it('devolve lista vazia quando a pasta não existe', () => {
    expect(listCodexSessions(join(codexHome, 'inexistente'), at(2026, 10, 1))).toEqual([]);
    expect(listCodexSessions(codexHome, at(2026, 10, 1))).toEqual([]);
  });
});

describe('readCodexSessionFile', () => {
  let codexHome: string;

  beforeEach(() => {
    codexHome = mkdtempSync(join(tmpdir(), 'ph-codex-file-'));
  });

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true });
  });

  it('lê o .jsonl como está', () => {
    const file = join(codexHome, 'rollout-a.jsonl');
    writeFileSync(file, FIXTURE);
    expect(readCodexSessionFile(file)).toBe(FIXTURE);
  });

  it('descomprime o .jsonl.zst e dá o mesmo uso da sessão aberta', () => {
    const file = join(codexHome, 'rollout-a.jsonl.zst');
    writeFileSync(file, zstdCompressSync(Buffer.from(FIXTURE, 'utf8')));
    const text = readCodexSessionFile(file);
    expect(text).toBe(FIXTURE);
    expect(readCodexSessionActivity(text)).toEqual(readCodexSessionActivity(FIXTURE));
  });

  it('lança com a compressão corrompida, em vez de devolver texto vazio', () => {
    const file = join(codexHome, 'rollout-b.jsonl.zst');
    writeFileSync(file, 'isto não é zstd');
    expect(() => readCodexSessionFile(file)).toThrow();
  });

  it('lança quando o .jsonl.zst expande além do limite, e lê quando cabe no limite', () => {
    const file = join(codexHome, 'rollout-c.jsonl.zst');
    // Comprime bem: o arquivo é minúsculo e a saída passa do limite (uma bomba de descompressão em miniatura).
    writeFileSync(file, zstdCompressSync(Buffer.alloc(100_000, 'a')));
    expect(() => readCodexSessionFile(file, 1_000)).toThrow();
    expect(readCodexSessionFile(file, 100_000)).toHaveLength(100_000);
  });

  it('lança quando o .jsonl em disco passa do limite', () => {
    const file = join(codexHome, 'rollout-d.jsonl');
    writeFileSync(file, 'a'.repeat(2_000));
    expect(() => readCodexSessionFile(file, 1_000)).toThrow();
    expect(readCodexSessionFile(file, 2_000)).toHaveLength(2_000);
  });
});

describe('codexHomeOf', () => {
  it('usa CODEX_HOME do ambiente quando existe', () => {
    expect(codexHomeOf({ CODEX_HOME: String.raw`D:\codex` })).toBe(String.raw`D:\codex`);
  });

  it('cai em ~/.codex sem a variável ou com ela vazia', () => {
    expect(codexHomeOf({})).toBe(join(homedir(), '.codex'));
    expect(codexHomeOf({ CODEX_HOME: '' })).toBe(join(homedir(), '.codex'));
  });
});
