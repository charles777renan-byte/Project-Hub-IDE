import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodexUsageTracker, readCodexTokenLine } from '../../src/codex/rollout-usage';

const SESSION = '01a1e218-c798-71f0-bf48-72a4f485076c';
const OTHER_SESSION = '01a1e217-4e10-7ca2-9529-c3a6ec13ca8e';

type Total = { input: number; cached?: number; cacheWrite?: number; output: number };

/** Linha `token_count` no formato do rollout do Codex 0.167, com o total acumulado da sessão. */
function tokenLine(total: Total): string {
  return JSON.stringify({
    timestamp: '2026-11-15T23:04:01.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: total.input,
          cached_input_tokens: total.cached ?? 0,
          cache_write_input_tokens: total.cacheWrite ?? 0,
          output_tokens: total.output,
          reasoning_output_tokens: 0,
          total_tokens: total.input + total.output,
        },
      },
    },
  });
}

const META_LINE = JSON.stringify({
  type: 'session_meta',
  payload: { id: SESSION, cwd: 'C:\\projeto' },
});
const ITEM_LINE = JSON.stringify({
  type: 'response_item',
  payload: { type: 'message', content: [{ type: 'output_text', text: 'texto com "token_count"' }] },
});

describe('readCodexTokenLine', () => {
  it('converte token_count em uso', () => {
    expect(
      readCodexTokenLine(tokenLine({ input: 19487, cached: 11904, cacheWrite: 0, output: 172 })),
    ).toEqual({
      inputTokens: 7583,
      outputTokens: 172,
      cacheReadInputTokens: 11904,
      cacheWrite5mInputTokens: 0,
      cacheWrite1hInputTokens: 0,
      model: '',
    });
  });

  it('a escrita em cache entra como de 5 minutos', () => {
    expect(
      readCodexTokenLine(tokenLine({ input: 1000, cached: 200, cacheWrite: 300, output: 5 })),
    ).toMatchObject({ inputTokens: 800, cacheReadInputTokens: 200, cacheWrite5mInputTokens: 300 });
  });

  it('entrada nunca fica negativa', () => {
    expect(readCodexTokenLine(tokenLine({ input: 10, cached: 50, output: 1 }))?.inputTokens).toBe(
      0,
    );
  });

  it('ignora linhas que não são token_count', () => {
    expect(readCodexTokenLine(META_LINE)).toBeUndefined();
    expect(readCodexTokenLine(ITEM_LINE)).toBeUndefined();
    expect(readCodexTokenLine('texto qualquer com "token_count"')).toBeUndefined();
  });

  it('ignora token_count sem total_token_usage e com campo não numérico', () => {
    const noInfo = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'token_count', info: null },
    });
    const text = JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 'muitos', output_tokens: 3 } },
      },
    });
    expect(readCodexTokenLine(noInfo)).toBeUndefined();
    expect(readCodexTokenLine(text)).toBeUndefined();
  });

  it('não copia texto: só as chaves do uso', () => {
    const parsed = readCodexTokenLine(tokenLine({ input: 5, output: 1 }));
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      'cacheReadInputTokens',
      'cacheWrite1hInputTokens',
      'cacheWrite5mInputTokens',
      'inputTokens',
      'model',
      'outputTokens',
    ]);
  });
});

describe('createCodexUsageTracker', () => {
  let home: string;
  let outside: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ph-codex-'));
    outside = mkdtempSync(join(tmpdir(), 'ph-fora-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  /** Caminho de um rollout dentro de `<home>/sessions/AAAA/MM/DD`. */
  function rolloutPath(sessionId: string, root = home): string {
    const folder = join(root, 'sessions', '2026', '11', '15');
    mkdirSync(folder, { recursive: true });
    return join(folder, `rollout-2026-11-15T23-03-57-${sessionId}.jsonl`);
  }

  function write(path: string, lines: string[]): void {
    writeFileSync(path, lines.map((line) => `${line}\n`).join(''), 'utf8');
  }

  it('devolve o último total acumulado, sem somar linhas', async () => {
    const file = rolloutPath(SESSION);
    write(file, [
      META_LINE,
      tokenLine({ input: 100, cached: 40, output: 5 }),
      ITEM_LINE,
      tokenLine({ input: 300, cached: 100, output: 12 }),
      tokenLine({ input: 900, cached: 500, output: 30 }),
    ]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toEqual({
      inputTokens: 400,
      outputTokens: 30,
      cacheReadInputTokens: 500,
      cacheWrite5mInputTokens: 0,
      cacheWrite1hInputTokens: 0,
    });
  });

  it('soma duas sessões', async () => {
    const first = rolloutPath(SESSION);
    const second = rolloutPath(OTHER_SESSION);
    write(first, [tokenLine({ input: 100, cached: 40, output: 5 })]);
    write(second, [tokenLine({ input: 50, cached: 10, output: 7 })]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(first, SESSION);
    tracker.addSession(second, OTHER_SESSION);
    expect(await tracker.poll()).toMatchObject({ inputTokens: 100, outputTokens: 12 });
  });

  it('só devolve quando o total muda', async () => {
    const file = rolloutPath(SESSION);
    write(file, [tokenLine({ input: 100, output: 5 })]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toBeDefined();
    expect(await tracker.poll()).toBeUndefined();
    appendFileSync(file, `${tokenLine({ input: 200, output: 9 })}\n`);
    expect(await tracker.poll()).toMatchObject({ outputTokens: 9 });
  });

  it('lê só o trecho novo e espera a linha completa', async () => {
    const file = rolloutPath(SESSION);
    const next = tokenLine({ input: 200, output: 9 });
    write(file, [tokenLine({ input: 100, output: 5 })]);
    appendFileSync(file, next.slice(0, 40));
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toMatchObject({ outputTokens: 5 });
    appendFileSync(file, `${next.slice(40)}\n`);
    expect(await tracker.poll()).toMatchObject({ inputTokens: 200, outputTokens: 9 });
  });

  it('rejeita caminho fora de <home>/sessions, mesmo que o arquivo exista', async () => {
    const file = rolloutPath(SESSION, outside);
    write(file, [tokenLine({ input: 100, output: 5 })]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toBeUndefined();
  });

  it('rejeita rollout fora da profundidade AAAA/MM/DD', async () => {
    const folder = join(home, 'sessions');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `rollout-2026-11-15T23-03-57-${SESSION}.jsonl`);
    write(file, [tokenLine({ input: 100, output: 5 })]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toBeUndefined();
  });

  it('rejeita nome que não é rollout-<hora>-<id>.jsonl e id que não bate com o nome', async () => {
    const good = rolloutPath(SESSION);
    write(good, [tokenLine({ input: 100, output: 5 })]);
    const badName = join(good, '..', `${SESSION}.jsonl`);
    write(badName, [tokenLine({ input: 100, output: 5 })]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(badName, SESSION);
    tracker.addSession(good, OTHER_SESSION);
    expect(await tracker.poll()).toBeUndefined();
  });

  it('rollout regravado do zero não dobra o total', async () => {
    const file = rolloutPath(SESSION);
    write(file, [
      tokenLine({ input: 100, output: 5 }),
      tokenLine({ input: 300, cached: 100, output: 12 }),
    ]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toMatchObject({ inputTokens: 200, outputTokens: 12 });
    // Arquivo menor que a posição lida: recomeça do zero, e o total da sessão não cai nem dobra.
    write(file, [tokenLine({ input: 100, output: 5 })]);
    expect(await tracker.poll()).toBeUndefined();
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toBeUndefined();
  });

  it('sem nenhum token_count devolve undefined', async () => {
    const file = rolloutPath(SESSION);
    write(file, [META_LINE, ITEM_LINE]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toBeUndefined();
  });

  it('arquivo que ainda não existe passa a contar quando aparece', async () => {
    const file = rolloutPath(SESSION);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    expect(await tracker.poll()).toBeUndefined();
    write(file, [tokenLine({ input: 100, output: 5 })]);
    expect(await tracker.poll()).toMatchObject({ outputTokens: 5 });
  });

  it('não informa contexto', async () => {
    const file = rolloutPath(SESSION);
    write(file, [tokenLine({ input: 100, output: 5 })]);
    const tracker = createCodexUsageTracker({ codexHome: home });
    tracker.addSession(file, SESSION);
    await tracker.poll();
    expect(tracker.latestContext()).toBeUndefined();
  });
});
