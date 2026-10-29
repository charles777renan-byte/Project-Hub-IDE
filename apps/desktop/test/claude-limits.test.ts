import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLimitsArgs,
  createClaudeLimitsProbe,
  parseRateLimits,
  type LimitsRunner,
} from '../src/main/claude-limits';

// Saída real da leitura (stream-json): uma linha JSON por evento. O que interessa é o `rate_limit_event`.
const RATE_LIMIT_EVENT = JSON.stringify({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: 1793231400,
    rateLimitType: 'five_hour',
    unifiedWindows: {
      five_hour: { utilization: 0.16, resetsAt: 1793231400, status: 'allowed' },
      seven_day: { utilization: 0.13, resetsAt: 1793264400, status: 'allowed' },
    },
  },
});
const SYSTEM_EVENT = JSON.stringify({ type: 'system', subtype: 'init', model: 'haiku' });
const RESULT_OK = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '.',
});

function lines(...events: string[]): string {
  return events.join('\n') + '\n';
}

function eventWith(windows: Record<string, unknown>): string {
  return JSON.stringify({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', unifiedWindows: windows },
  });
}

describe('parseRateLimits', () => {
  it('lê a saída real: duas janelas, percentual inteiro e hora de renovação em ISO', () => {
    expect(parseRateLimits(lines(SYSTEM_EVENT, RATE_LIMIT_EVENT, RESULT_OK))).toEqual({
      ok: true,
      windows: [
        { id: 'five_hour', usedPercent: 16, resetsAt: new Date(1793231400 * 1000).toISOString() },
        { id: 'seven_day', usedPercent: 13, resetsAt: new Date(1793264400 * 1000).toISOString() },
      ],
    });
  });

  it('aceita fim de linha do Windows e linha em branco', () => {
    const stdout = [SYSTEM_EVENT, '', RATE_LIMIT_EVENT, RESULT_OK].join('\r\n');

    expect(parseRateLimits(stdout)).toMatchObject({ ok: true });
  });

  it('arredonda a utilização para o inteiro mais próximo', () => {
    const stdout = lines(
      eventWith({
        a: { utilization: 0.156, resetsAt: 1793231400 },
        b: { utilization: 0.004, resetsAt: 1793231400 },
        c: { utilization: 1, resetsAt: 1793231400 },
        d: { utilization: 0, resetsAt: 1793231400 },
        e: { utilization: 0.994, resetsAt: 1793231400 },
      }),
      RESULT_OK,
    );

    const parsed = parseRateLimits(stdout);

    expect(parsed.ok && parsed.windows.map((window) => window.usedPercent)).toEqual([
      16, 0, 100, 0, 99,
    ]);
  });

  it('guarda também as outras janelas, com o nome da chave como id', () => {
    const stdout = lines(
      eventWith({
        five_hour: { utilization: 0.5, resetsAt: 1793231400 },
        seven_day_opus: { utilization: 0.25, resetsAt: 1793264400 },
      }),
      RESULT_OK,
    );

    const parsed = parseRateLimits(stdout);

    expect(parsed.ok && parsed.windows.map((window) => window.id)).toEqual([
      'five_hour',
      'seven_day_opus',
    ]);
  });

  it('descarta a janela sem número válido e guarda as outras', () => {
    const stdout = lines(
      eventWith({
        five_hour: { utilization: 0.5, resetsAt: 1793231400 },
        sem_hora: { utilization: 0.5 },
        sem_uso: { resetsAt: 1793231400 },
        texto: { utilization: '0.5', resetsAt: 1793231400 },
        hora_em_texto: { utilization: 0.5, resetsAt: '2026-10-28T00:00:00Z' },
        nao_finito: { utilization: Number.NaN, resetsAt: 1793231400 },
        absurda: { utilization: 0.5, resetsAt: 1e20 },
        nula: null,
      }),
      RESULT_OK,
    );

    const parsed = parseRateLimits(stdout);

    expect(parsed.ok && parsed.windows.map((window) => window.id)).toEqual(['five_hour']);
  });

  it.each([
    ['maior que 1', 1.5],
    ['negativa', -0.1],
    ['em escala de 0 a 100', 16],
  ])('utilização %s não vira janela (nem é corrigida)', (_nome, utilization) => {
    const stdout = lines(
      eventWith({ five_hour: { utilization, resetsAt: 1793231400 } }),
      RESULT_OK,
    );

    expect(parseRateLimits(stdout)).toEqual({ ok: false, problem: 'failed' });
  });

  it('a janela fora do intervalo cai fora e a boa fica', () => {
    const stdout = lines(
      eventWith({
        five_hour: { utilization: 2, resetsAt: 1793231400 },
        seven_day: { utilization: 0.13, resetsAt: 1793264400 },
      }),
      RESULT_OK,
    );

    const parsed = parseRateLimits(stdout);

    expect(parsed.ok && parsed.windows.map((window) => window.id)).toEqual(['seven_day']);
  });

  it('vários eventos com a mesma janela: vale o último', () => {
    const stdout = lines(
      eventWith({ five_hour: { utilization: 0.1, resetsAt: 1793231400 } }),
      eventWith({ five_hour: { utilization: 0.2, resetsAt: 1793231400 } }),
      RESULT_OK,
    );

    const parsed = parseRateLimits(stdout);

    expect(parsed.ok && parsed.windows).toHaveLength(1);
    expect(parsed.ok && parsed.windows[0]?.usedPercent).toBe(20);
  });

  it('cota esgotada: o result vem com erro, mas as janelas valem (100% é o que a pessoa quer ver)', () => {
    const exhausted = eventWith({ five_hour: { utilization: 1, resetsAt: 1793231400 } });
    const result = JSON.stringify({
      type: 'result',
      is_error: true,
      result: "You've hit your limit",
    });

    expect(parseRateLimits(lines(exhausted, result))).toMatchObject({
      ok: true,
      windows: [{ id: 'five_hour', usedPercent: 100 }],
    });
  });

  it('result sem erro e sem rate_limit_event: a conta não tem limite por janela', () => {
    expect(parseRateLimits(lines(SYSTEM_EVENT, RESULT_OK))).toEqual({
      ok: false,
      problem: 'no-limits',
    });
  });

  it('rate_limit_event sem janelas legíveis é saída fora do formato', () => {
    const noWindows = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed' },
    });

    expect(parseRateLimits(lines(noWindows, RESULT_OK))).toEqual({ ok: false, problem: 'failed' });
    expect(parseRateLimits(lines(eventWith({}), RESULT_OK))).toEqual({
      ok: false,
      problem: 'failed',
    });
  });

  it.each([
    ['Not logged in · Please run /login'],
    ['Please log in to continue'],
    ['Invalid API key · Please run /login'],
    ['OAuth token has expired'],
  ])('result com is_error e texto de login (%s) é not-logged-in', (text) => {
    const result = JSON.stringify({ type: 'result', is_error: true, result: text });

    expect(parseRateLimits(lines(SYSTEM_EVENT, result))).toEqual({
      ok: false,
      problem: 'not-logged-in',
    });
  });

  it('result com is_error por outro motivo é failed', () => {
    const result = JSON.stringify({ type: 'result', is_error: true, result: 'Overloaded' });

    expect(parseRateLimits(lines(SYSTEM_EVENT, result))).toEqual({ ok: false, problem: 'failed' });
  });

  it('result com is_error sem texto é failed', () => {
    const result = JSON.stringify({ type: 'result', is_error: true });

    expect(parseRateLimits(lines(result))).toEqual({ ok: false, problem: 'failed' });
  });

  it.each([
    ['saída vazia', ''],
    ['só espaços', '  \n \n'],
    ['texto que não é JSON', 'isto não é JSON\noutra linha'],
    ['JSON quebrado no meio', RATE_LIMIT_EVENT.slice(0, 80)],
    ['JSON que não é objeto', '[1,2,3]\n"texto"\n42'],
    ['sem result e sem evento de limite', SYSTEM_EVENT],
  ])('%s é failed', (_nome, stdout) => {
    expect(parseRateLimits(stdout)).toEqual({ ok: false, problem: 'failed' });
  });

  it('ignora a linha quebrada e lê as boas (aviso solto no meio da saída)', () => {
    const stdout = lines(
      SYSTEM_EVENT,
      'aviso: algo',
      RATE_LIMIT_EVENT,
      '{"type":"result"',
      RESULT_OK,
    );

    expect(parseRateLimits(stdout)).toMatchObject({ ok: true });
  });

  it('não confunde evento de outro tipo com o de limite', () => {
    const other = JSON.stringify({
      type: 'assistant',
      rate_limit_info: {
        unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1793231400 } },
      },
    });

    expect(parseRateLimits(lines(other, RESULT_OK))).toEqual({ ok: false, problem: 'no-limits' });
  });
});

describe('buildLimitsArgs', () => {
  it('é a leitura mínima: modelo barato, sem ferramentas, sem configuração, sem transcript', () => {
    expect(buildLimitsArgs()).toEqual([
      '-p',
      '.',
      '--model',
      'haiku',
      '--restricted',
      '--strict-mcp-config',
      '--tools',
      '',
      '--system-prompt',
      '.',
      '--no-session-persistence',
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
  });
});

describe('createClaudeLimitsProbe', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'limits-probe-test-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const signal = new AbortController().signal;
  const FIXED = new Date('2026-10-28T12:00:00.000Z');

  function probeWith(run: LimitsRunner, extra: { commandPrefix?: string[] } = {}) {
    return createClaudeLimitsProbe({
      command: 'C:\\claude.exe',
      env: { PATH: 'x' },
      extraEnv: { EXTRA: '1' },
      cwd: join(root, 'limits-probe'),
      run,
      now: () => FIXED,
      ...extra,
    });
  }

  it('roda o claude com os argumentos fixos, sem stdin, na pasta neutra (criada) e com o ambiente dado', async () => {
    const run = vi.fn<LimitsRunner>(() =>
      Promise.resolve({ stdout: lines(RATE_LIMIT_EVENT, RESULT_OK), exitCode: 0 }),
    );

    const reading = await probeWith(run, { commandPrefix: ['/e2e/fake.mjs'] }).read(signal);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      command: 'C:\\claude.exe',
      args: ['/e2e/fake.mjs', ...buildLimitsArgs()],
      cwd: join(root, 'limits-probe'),
      env: { PATH: 'x', EXTRA: '1' },
      stdin: '',
      timeoutMs: 30_000,
      maxOutputBytes: 2 * 1024 * 1024,
      signal,
    });
    expect(reading).toEqual({
      ok: true,
      capturedAt: FIXED.toISOString(),
      windows: [
        { id: 'five_hour', usedPercent: 16, resetsAt: new Date(1793231400 * 1000).toISOString() },
        { id: 'seven_day', usedPercent: 13, resetsAt: new Date(1793264400 * 1000).toISOString() },
      ],
    });
  });

  it('executável ausente (ENOENT) é not-installed', async () => {
    const run: LimitsRunner = () =>
      Promise.reject(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));

    expect(await probeWith(run).read(signal)).toEqual({ ok: false, problem: 'not-installed' });
  });

  it.each([
    ['falha ao iniciar', Object.assign(new Error('EACCES'), { code: 'EACCES' })],
    ['tempo esgotado', new Error('O planejador passou de 30000 ms.')],
    ['aborto', new DOMException('Aborted', 'AbortError')],
    ['valor que não é erro', 'texto'],
  ])('%s é failed', async (_nome, error) => {
    const run: LimitsRunner = () => Promise.reject(error);

    expect(await probeWith(run).read(signal)).toEqual({ ok: false, problem: 'failed' });
  });

  it('login pedido sai com código diferente de zero e o motivo na saída: not-logged-in', async () => {
    const run: LimitsRunner = () =>
      Promise.resolve({
        stdout: lines(
          SYSTEM_EVENT,
          JSON.stringify({
            type: 'result',
            is_error: true,
            result: 'Not logged in · Please run /login',
          }),
        ),
        exitCode: 1,
      });

    expect(await probeWith(run).read(signal)).toEqual({ ok: false, problem: 'not-logged-in' });
  });

  it('saída fora do formato é failed, sem repassar a mensagem do programa', async () => {
    const run: LimitsRunner = () =>
      Promise.resolve({ stdout: 'Segredo: sk-ant-123 não é JSON', exitCode: 2 });

    const reading = await probeWith(run).read(signal);

    expect(reading).toEqual({ ok: false, problem: 'failed' });
    expect(JSON.stringify(reading)).not.toContain('sk-ant');
  });

  it('pasta neutra que não pode ser criada é failed e o claude nem roda', async () => {
    const run = vi.fn<LimitsRunner>();
    // O pai da pasta é um arquivo: o mkdir recursivo falha.
    const probe = createClaudeLimitsProbe({
      command: 'claude',
      env: {},
      cwd: join(process.execPath, 'limits-probe'),
      run,
    });

    expect(await probe.read(signal)).toEqual({ ok: false, problem: 'failed' });
    expect(run).not.toHaveBeenCalled();
  });
});
