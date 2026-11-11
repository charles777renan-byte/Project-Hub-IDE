import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Registra os caminhos que o leitor toca no disco (stat, listagem, leitura), para provar o que ele nunca abre.
const touched = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const spy =
    <F extends (...args: never[]) => unknown>(fn: F) =>
    (...args: Parameters<F>) => {
      touched.push(String(args[0]));
      return fn(...args);
    };
  return {
    ...actual,
    default: actual,
    statSync: spy(actual.statSync as (...args: never[]) => unknown),
    readdirSync: spy(actual.readdirSync as (...args: never[]) => unknown),
    readFileSync: spy(actual.readFileSync as (...args: never[]) => unknown),
  };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: actual,
    open: (...args: Parameters<typeof actual.open>) => {
      touched.push(String(args[0]));
      return actual.open(...args);
    },
  };
});
import {
  createCodexLimitsReader,
  parseCodexRateLimitLine,
  pickLatestReading,
  type CodexRateLimitEvent,
} from '../src/main/codex-limits';

const RESET_5H = 1793231400;
const RESET_WEEK = 1793264400;
const RESET_MONTH = 1795900000;

type RawWindow = { used_percent: unknown; window_minutes: unknown; resets_at: unknown } | null;

interface EventOptions {
  timestamp?: string;
  limitId?: string | null;
  primary?: RawWindow;
  secondary?: RawWindow;
  credits?: unknown;
  rateLimits?: unknown;
}

function tokenCount(options: EventOptions = {}): string {
  const rateLimits =
    options.rateLimits !== undefined
      ? options.rateLimits
      : {
          ...(options.limitId === null ? {} : { limit_id: options.limitId ?? 'codex' }),
          limit_name: null,
          plan_type: 'plus',
          primary: options.primary === undefined ? null : options.primary,
          secondary: options.secondary === undefined ? null : options.secondary,
          credits: options.credits ?? null,
        };
  return JSON.stringify({
    timestamp: options.timestamp ?? '2026-11-11T12:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: null, rate_limits: rateLimits },
  });
}

const free = (timestamp = '2026-11-11T12:00:00.000Z') =>
  tokenCount({
    timestamp,
    primary: { used_percent: 47, window_minutes: 43200, resets_at: RESET_MONTH },
  });
const plus = (timestamp = '2026-11-11T12:00:00.000Z') =>
  tokenCount({
    timestamp,
    primary: { used_percent: 20, window_minutes: 300, resets_at: RESET_5H },
    secondary: { used_percent: 33, window_minutes: 10080, resets_at: RESET_WEEK },
  });

describe('parseCodexRateLimitLine', () => {
  it('Free: 43200 min vira thirty_day com 47 (sem multiplicar por 100)', () => {
    const event = parseCodexRateLimitLine(free());
    expect(event).toEqual({
      capturedAt: '2026-11-11T12:00:00.000Z',
      windows: [
        {
          id: 'thirty_day',
          usedPercent: 47,
          resetsAt: new Date(RESET_MONTH * 1000).toISOString(),
          durationMinutes: 43200,
        },
      ],
      creditsUnlimited: false,
    });
  });

  it('Plus: 300 + 10080 viram five_hour + seven_day', () => {
    const event = parseCodexRateLimitLine(plus());
    expect(event?.windows.map((w) => [w.id, w.usedPercent, w.durationMinutes])).toEqual([
      ['five_hour', 20, 300],
      ['seven_day', 33, 10080],
    ]);
  });

  it('semanal no primary, sem secondary, vira só seven_day (a janela se identifica pela duração)', () => {
    const line = tokenCount({
      primary: { used_percent: 5, window_minutes: 10080, resets_at: RESET_WEEK },
    });
    expect(parseCodexRateLimitLine(line)?.windows.map((w) => w.id)).toEqual(['seven_day']);
  });

  it('duração desconhecida vira window_<N>m e fração é arredondada', () => {
    const line = tokenCount({
      primary: { used_percent: 12.6, window_minutes: 1440, resets_at: RESET_WEEK },
    });
    const [window] = parseCodexRateLimitLine(line)?.windows ?? [];
    expect(window).toMatchObject({ id: 'window_1440m', usedPercent: 13, durationMinutes: 1440 });
  });

  it.each([-1, 100.5, 4700, Number.NaN, '47'])('descarta used_percent %s', (used) => {
    const line = tokenCount({
      primary: { used_percent: used, window_minutes: 43200, resets_at: RESET_MONTH },
    });
    expect(parseCodexRateLimitLine(line)).toBeNull();
  });

  it('descarta a janela inválida e mantém a outra', () => {
    const line = tokenCount({
      primary: { used_percent: 20, window_minutes: 300, resets_at: 0 },
      secondary: { used_percent: 33, window_minutes: 10080, resets_at: RESET_WEEK },
    });
    expect(parseCodexRateLimitLine(line)?.windows.map((w) => w.id)).toEqual(['seven_day']);
  });

  it('descarta window_minutes fracionário ou zero', () => {
    for (const minutes of [0, 300.5]) {
      const line = tokenCount({
        primary: { used_percent: 5, window_minutes: minutes, resets_at: RESET_WEEK },
      });
      expect(parseCodexRateLimitLine(line)).toBeNull();
    }
  });

  it('ignora limit_id premium, mas aceita limit_id ausente', () => {
    const w = { used_percent: 5, window_minutes: 10080, resets_at: RESET_WEEK };
    expect(parseCodexRateLimitLine(tokenCount({ limitId: 'premium', primary: w }))).toBeNull();
    expect(parseCodexRateLimitLine(tokenCount({ limitId: null, primary: w }))).not.toBeNull();
  });

  it('ignora evento com as duas janelas nulas', () => {
    expect(parseCodexRateLimitLine(tokenCount({}))).toBeNull();
  });

  it('ignora token_count sem rate_limits, linha quebrada e outros tipos', () => {
    expect(parseCodexRateLimitLine(tokenCount({ rateLimits: null }))).toBeNull();
    expect(
      parseCodexRateLimitLine('{"type":"event_msg","payload":{"type":"token_count"'),
    ).toBeNull();
    expect(parseCodexRateLimitLine('{"type":"turn_context"}')).toBeNull();
  });

  it('exige timestamp ISO válido', () => {
    const w = { used_percent: 5, window_minutes: 10080, resets_at: RESET_WEEK };
    expect(parseCodexRateLimitLine(tokenCount({ timestamp: 'ontem', primary: w }))).toBeNull();
  });

  it('ignora chaves desconhecidas', () => {
    const line = tokenCount({
      rateLimits: {
        limit_id: 'codex',
        novidade: { qualquer: 1 },
        primary: { used_percent: 5, window_minutes: 10080, resets_at: RESET_WEEK, extra: true },
      },
    });
    expect(parseCodexRateLimitLine(line)?.windows).toHaveLength(1);
  });
});

describe('pickLatestReading', () => {
  const win = (usedPercent: number, resetsAt: string, id = 'five_hour') => ({
    id,
    usedPercent,
    resetsAt,
    durationMinutes: 300,
  });
  const ev = (
    capturedAt: string,
    windows: CodexRateLimitEvent['windows'],
  ): CodexRateLimitEvent => ({
    capturedAt,
    windows,
    creditsUnlimited: false,
  });

  it('usa o evento mais novo e o maior percentual dos snapshots simultâneos', () => {
    const picked = pickLatestReading([
      ev('2026-11-11T12:00:30.000Z', [win(30, '2026-11-11T15:00:02.000Z')]),
      ev('2026-11-11T12:01:00.000Z', [win(25, '2026-11-11T15:00:00.000Z')]),
      ev('2026-11-11T11:59:50.000Z', [win(28, '2026-11-11T14:59:58.000Z')]),
    ]);
    expect(picked?.capturedAt).toBe('2026-11-11T12:01:00.000Z');
    expect(picked?.windows[0]?.usedPercent).toBe(30);
    expect(picked?.windows[0]?.resetsAt).toBe('2026-11-11T15:00:00.000Z');
  });

  it('não mistura janelas de resetsAt distintos nem eventos de mais de 2 minutos antes', () => {
    const picked = pickLatestReading([
      ev('2026-11-11T12:00:30.000Z', [win(90, '2026-11-11T10:00:00.000Z')]),
      ev('2026-11-11T08:00:00.000Z', [win(80, '2026-11-11T15:00:00.000Z')]),
      ev('2026-11-11T12:01:00.000Z', [win(25, '2026-11-11T15:00:00.000Z')]),
    ]);
    expect(picked?.windows[0]?.usedPercent).toBe(25);
  });

  it('sem eventos devolve undefined', () => {
    expect(pickLatestReading([])).toBeUndefined();
  });
});

describe('createCodexLimitsReader', () => {
  let dir: string;
  const signal = () => new AbortController().signal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ph-codex-limits-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function rollout(
    name: string,
    content: string | Buffer,
    day = ['2026', '11', '11'],
    root = 'sessions',
  ) {
    const folder = join(dir, root, ...(root === 'sessions' ? day : []));
    mkdirSync(folder, { recursive: true });
    const file = join(folder, name);
    writeFileSync(file, content);
    return file;
  }
  const meta = JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: 'C:\\dev' } });
  const nome = (stamp: string, id = 'a') => `rollout-${stamp}-${id}.jsonl`;

  it('lê o Free: uma janela thirty_day com 47 e capturedAt do evento', async () => {
    rollout(
      nome('2026-11-11T09-00-00'),
      [meta, free('2026-11-11T09:30:00.000Z')].join('\n') + '\n',
    );
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toEqual({
      ok: true,
      capturedAt: '2026-11-11T09:30:00.000Z',
      windows: [
        {
          id: 'thirty_day',
          usedPercent: 47,
          resetsAt: new Date(RESET_MONTH * 1000).toISOString(),
          durationMinutes: 43200,
        },
      ],
    });
  });

  it('lê o Plus: five_hour e seven_day', async () => {
    rollout(nome('2026-11-11T09-00-00'), plus() + '\n');
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading.ok && reading.windows.map((w) => w.id)).toEqual(['five_hour', 'seven_day']);
  });

  it('ignora premium e janelas nulas mesmo sendo o último evento do arquivo', async () => {
    const premium = tokenCount({
      timestamp: '2026-11-11T13:00:00.000Z',
      limitId: 'premium',
      primary: { used_percent: 99, window_minutes: 300, resets_at: RESET_5H },
    });
    const vazio = tokenCount({ timestamp: '2026-11-11T14:00:00.000Z' });
    rollout(
      nome('2026-11-11T09-00-00'),
      [free('2026-11-11T12:00:00.000Z'), premium, vazio].join('\n') + '\n',
    );
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-11T12:00:00.000Z' });
  });

  it('ignora a linha quebrada no fim (o Codex ainda escrevendo)', async () => {
    rollout(
      nome('2026-11-11T09-00-00'),
      free() + '\n{"type":"event_msg","payload":{"type":"token_co',
    );
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading.ok).toBe(true);
  });

  it('acha um evento a ~300 KB do fim pela janela progressiva', async () => {
    const enchimento = JSON.stringify({
      type: 'response_item',
      payload: { text: 'x'.repeat(1000) },
    });
    const linhas = Array.from({ length: 300 }, () => enchimento).join('\n');
    rollout(nome('2026-11-11T09-00-00'), `${free()}\n${linhas}\n`);
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading.ok).toBe(true);
  });

  it('uma linha gigante antes do evento não quebra a leitura', async () => {
    const gigante = JSON.stringify({
      type: 'response_item',
      payload: { text: 'y'.repeat(5 * 1024 * 1024) },
    });
    rollout(nome('2026-11-11T09-00-00'), `${gigante}\n${free()}\n`);
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading.ok).toBe(true);
  });

  it('descarta a primeira linha da janela: um corte dentro de uma linha não vira evento', async () => {
    const TAIL = 256 * 1024;
    const escondido = tokenCount({
      timestamp: '2026-11-11T11:00:00.000Z',
      primary: { used_percent: 60, window_minutes: 43200, resets_at: RESET_MONTH },
    });
    // O corte de 256 KiB cai exatamente onde começa um token_count mais novo, no meio de uma linha que
    // não é JSON (lixo + evento). Aceitar a linha cortada mostraria 60% em vez de 47%.
    const resto = 'z'.repeat(TAIL - escondido.length - 2);
    const conteudo = `${free('2026-11-11T09:00:00.000Z')}\nlixo${escondido}\n${resto}\n`;
    expect(Buffer.byteLength(`${escondido}\n${resto}\n`)).toBe(TAIL);
    rollout(nome('2026-11-11T09-00-00'), conteudo);
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-11T09:00:00.000Z' });
    expect(reading.ok && reading.windows[0]?.usedPercent).toBe(47);
  });

  it('arquivo acima do teto de leitura só tem o fim examinado (sem erro)', async () => {
    const gigante = `${free()}\n${'x'.repeat(65 * 1024 * 1024)}\n`;
    rollout(nome('2026-11-11T09-00-00'), gigante);
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toEqual({ ok: false, problem: 'no-data' });
  });

  it('lê o .jsonl.zst quando não há .jsonl', async () => {
    rollout(nome('2026-11-01T09-00-00') + '.zst', zstdCompressSync(Buffer.from(free() + '\n')));
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, windows: [{ id: 'thirty_day' }] });
  });

  it('.jsonl e .zst do mesmo nome contam uma vez', async () => {
    const onFileRead = vi.fn();
    rollout(nome('2026-11-11T09-00-00'), free() + '\n');
    rollout(nome('2026-11-11T09-00-00') + '.zst', zstdCompressSync(Buffer.from(free() + '\n')));
    await createCodexLimitsReader({ codexHome: dir, onFileRead }).read(signal());
    expect(onFileRead).toHaveBeenCalledTimes(1);
    expect(String(onFileRead.mock.calls[0]?.[0])).toMatch(/\.jsonl$/);
  });

  it('considera archived_sessions', async () => {
    rollout(nome('2026-10-01T09-00-00'), free() + '\n', [], 'archived_sessions');
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading.ok).toBe(true);
  });

  it('a ordem não depende do mtime: vale o timestamp do evento', async () => {
    const velho = rollout(
      nome('2026-11-10T09-00-00', 'a'),
      free('2026-11-10T09:00:00.000Z') + '\n',
      ['2026', '11', '10'],
    );
    const novo = tokenCount({
      timestamp: '2026-11-11T09:00:00.000Z',
      primary: { used_percent: 60, window_minutes: 43200, resets_at: RESET_MONTH },
    });
    const recente = rollout(nome('2026-11-11T09-00-00', 'b'), novo + '\n');
    // O arquivo do evento mais velho recebe o mtime mais novo.
    utimesSync(velho, new Date('2030-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'));
    utimesSync(recente, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-11T09:00:00.000Z' });
    expect(reading.ok && reading.windows[0]?.usedPercent).toBe(60);
  });

  const eventAt = (timestamp: string, used: number) =>
    tokenCount({
      timestamp,
      primary: { used_percent: used, window_minutes: 43200, resets_at: RESET_MONTH },
    });
  const zst = (content: string) => zstdCompressSync(Buffer.from(content + '\n'));

  it('.jsonl: vale o timestamp do evento, não a pasta nem o nome (sessão retomada)', async () => {
    rollout(nome('2026-11-01T09-00-00', 'a'), eventAt('2026-11-11T12:00:00.000Z', 60) + '\n', [
      '2026',
      '11',
      '01',
    ]);
    rollout(nome('2026-11-11T09-00-00', 'b'), eventAt('2026-11-05T12:00:00.000Z', 47) + '\n', [
      '2026',
      '11',
      '11',
    ]);
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-11T12:00:00.000Z' });
    expect(reading.ok && reading.windows[0]?.usedPercent).toBe(60);
  });

  it('.zst: o de nome mais novo vence e a leitura para no primeiro com evento', async () => {
    const onFileRead = vi.fn();
    rollout(
      nome('2026-11-11T09-00-00', 'a') + '.zst',
      zst(eventAt('2026-11-11T09:00:00.000Z', 60)),
      ['2026', '11', '11'],
    );
    rollout(
      nome('2026-11-05T09-00-00', 'b') + '.zst',
      zst(eventAt('2026-11-05T09:00:00.000Z', 47)),
      ['2026', '11', '05'],
    );
    const reading = await createCodexLimitsReader({ codexHome: dir, onFileRead }).read(signal());
    expect(reading.ok && reading.windows[0]?.usedPercent).toBe(60);
    expect(onFileRead).toHaveBeenCalledTimes(1);
  });

  it('.zst mais novo vence um .jsonl antigo arquivado sem compressão', async () => {
    rollout(
      nome('2026-10-01T09-00-00', 'velho'),
      eventAt('2026-10-01T09:00:00.000Z', 47) + '\n',
      [],
      'archived_sessions',
    );
    rollout(
      nome('2026-11-11T09-00-00', 'novo') + '.zst',
      zst(eventAt('2026-11-11T09:00:00.000Z', 60)),
      ['2026', '11', '11'],
    );
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-11T09:00:00.000Z' });
    expect(reading.ok && reading.windows[0]?.usedPercent).toBe(60);
  });

  it('.zst com vários eventos: vale o mais novo do arquivo', async () => {
    rollout(
      nome('2026-11-11T09-00-00', 'a') + '.zst',
      zst(
        [
          eventAt('2026-11-11T09:00:00.000Z', 40),
          eventAt('2026-11-11T10:00:00.000Z', 50),
          eventAt('2026-11-11T12:00:00.000Z', 60),
        ].join('\n'),
      ),
      ['2026', '11', '11'],
    );
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-11T12:00:00.000Z' });
    expect(reading.ok && reading.windows[0]?.usedPercent).toBe(60);
  });

  it('.zst: o nome decide a ordem, não a pasta do dia', async () => {
    const onFileRead = vi.fn();
    // Nome novo em pasta antiga, nome antigo em pasta nova.
    rollout(
      nome('2026-11-11T09-00-00', 'a') + '.zst',
      zst(eventAt('2026-11-11T09:00:00.000Z', 60)),
      ['2026', '10', '01'],
    );
    rollout(
      nome('2026-10-01T09-00-00', 'b') + '.zst',
      zst(eventAt('2026-10-01T09:00:00.000Z', 47)),
      ['2026', '11', '11'],
    );
    const reading = await createCodexLimitsReader({ codexHome: dir, onFileRead }).read(signal());
    expect(reading.ok && reading.windows[0]?.usedPercent).toBe(60);
    expect(onFileRead).toHaveBeenCalledTimes(1);
    expect(String(onFileRead.mock.calls[0]?.[0])).toContain('2026-11-11T09-00-00');
  });

  it('.zst: no máximo 8 arquivos por varredura', async () => {
    const onFileRead = vi.fn();
    for (let i = 1; i <= 9; i += 1) {
      rollout(nome(`2026-11-${10 + i}T09-00-00`, `s${i}`) + '.zst', zst(meta));
    }
    rollout(nome('2026-10-01T09-00-00', 'velho') + '.zst', zst(free('2026-10-01T09:00:00.000Z')));
    const reading = await createCodexLimitsReader({ codexHome: dir, onFileRead }).read(signal());
    expect(reading).toEqual({ ok: false, problem: 'no-data' });
    expect(onFileRead).toHaveBeenCalledTimes(8);
  });

  it('um .zst corrompido não impede ler o .zst válido mais antigo', async () => {
    rollout(nome('2026-11-11T09-00-00', 'a') + '.zst', Buffer.from('isto nao e zstd'));
    rollout(nome('2026-11-05T09-00-00', 'b') + '.zst', zst(free('2026-11-05T09:00:00.000Z')));
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-05T09:00:00.000Z' });
  });

  it('um .jsonl que some entre a listagem e a leitura não derruba a leitura', async () => {
    rollout(nome('2026-11-11T09-00-00', 'a'), free('2026-11-11T09:00:00.000Z') + '\n');
    rollout(nome('2026-11-10T09-00-00', 'b'), free('2026-11-10T09:00:00.000Z') + '\n', [
      '2026',
      '11',
      '10',
    ]);
    const onFileRead = vi.fn((file: string) => {
      if (file.includes('-a.jsonl')) rmSync(file);
    });
    const reading = await createCodexLimitsReader({ codexHome: dir, onFileRead }).read(signal());
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-10T09:00:00.000Z' });
  });

  it('o único .jsonl some durante a leitura: no-data, não failed', async () => {
    rollout(nome('2026-11-11T09-00-00'), free() + '\n');
    const onFileRead = (file: string) => rmSync(file);
    const reading = await createCodexLimitsReader({ codexHome: dir, onFileRead }).read(signal());
    expect(reading).toEqual({ ok: false, problem: 'no-data' });
  });

  it('cache: arquivo ilegível não é descomprimido de novo a cada leitura', async () => {
    const onFileRead = vi.fn();
    rollout(nome('2026-11-11T09-00-00') + '.zst', Buffer.from('isto nao e zstd'));
    const reader = createCodexLimitsReader({ codexHome: dir, onFileRead });
    expect(await reader.read(signal())).toEqual({ ok: false, problem: 'failed' });
    expect(await reader.read(signal())).toEqual({ ok: false, problem: 'failed' });
    expect(onFileRead).toHaveBeenCalledTimes(1);
  });

  it('cache: entrada de arquivo que saiu da lista é descartada', async () => {
    const onFileRead = vi.fn();
    const when = new Date('2026-11-11T10:00:00Z');
    const content = free() + '\n';
    const file = rollout(nome('2026-11-11T09-00-00'), content);
    utimesSync(file, when, when);
    const reader = createCodexLimitsReader({ codexHome: dir, onFileRead });
    await reader.read(signal());
    rmSync(file);
    await reader.read(signal());
    // Mesmo caminho, tamanho e mtime: só relê se a entrada antiga tiver sido apagada.
    rollout(nome('2026-11-11T09-00-00'), content);
    utimesSync(file, when, when);
    await reader.read(signal());
    expect(onFileRead).toHaveBeenCalledTimes(2);
  });

  it('pasta ausente é not-installed', async () => {
    const reading = await createCodexLimitsReader({ codexHome: join(dir, 'nao-existe') }).read(
      signal(),
    );
    expect(reading).toEqual({ ok: false, problem: 'not-installed' });
  });

  it('pasta sem sessões é no-data', async () => {
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toEqual({ ok: false, problem: 'no-data' });
  });

  it('sessões sem nenhum token_count válido são no-data', async () => {
    rollout(nome('2026-11-11T09-00-00'), meta + '\n');
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toEqual({ ok: false, problem: 'no-data' });
  });

  it('só créditos ilimitados e sem janela é no-limits', async () => {
    rollout(
      nome('2026-11-11T09-00-00'),
      tokenCount({ credits: { has_credits: true, unlimited: true, balance: null } }) + '\n',
    );
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toEqual({ ok: false, problem: 'no-limits' });
  });

  it('erro de E/S vira failed sem vazar caminho', async () => {
    // Um .zst corrompido, único candidato, falha ao descomprimir.
    rollout(nome('2026-11-11T09-00-00') + '.zst', Buffer.from('isto nao e zstd'));
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(signal());
    expect(reading).toEqual({ ok: false, problem: 'failed' });
  });

  it('cache: a segunda leitura sem mudança não relê os arquivos', async () => {
    const onFileRead = vi.fn();
    rollout(nome('2026-11-11T09-00-00', 'a'), free() + '\n');
    rollout(nome('2026-11-11T08-00-00', 'b'), meta + '\n');
    const reader = createCodexLimitsReader({ codexHome: dir, onFileRead });
    await reader.read(signal());
    expect(onFileRead).toHaveBeenCalledTimes(2);
    await reader.read(signal());
    expect(onFileRead).toHaveBeenCalledTimes(2);
  });

  it('cache: arquivo que cresceu é relido', async () => {
    const onFileRead = vi.fn();
    const file = rollout(nome('2026-11-11T09-00-00'), free('2026-11-11T09:00:00.000Z') + '\n');
    const reader = createCodexLimitsReader({ codexHome: dir, onFileRead });
    await reader.read(signal());
    writeFileSync(file, free('2026-11-11T10:00:00.000Z') + '\n' + meta + '\n');
    const reading = await reader.read(signal());
    expect(onFileRead).toHaveBeenCalledTimes(2);
    expect(reading).toMatchObject({ ok: true, capturedAt: '2026-11-11T10:00:00.000Z' });
  });

  it('nunca abre auth.json, config.toml nem sqlite (nem por stat, listagem ou leitura)', async () => {
    writeFileSync(join(dir, 'auth.json'), '{"token":"segredo"}');
    writeFileSync(join(dir, 'config.toml'), 'x = 1');
    writeFileSync(join(dir, 'state.sqlite'), 'x');
    rollout(nome('2026-11-11T09-00-00'), free() + '\n');
    rollout(nome('2026-10-01T09-00-00') + '.zst', zstdCompressSync(Buffer.from(free() + '\n')));
    touched.length = 0;
    await createCodexLimitsReader({ codexHome: dir }).read(signal());
    // Guarda contra o teste vazio: o espião precisa ter visto o arquivo de sessão.
    expect(touched.some((file) => /rollout-.*\.jsonl/.test(file))).toBe(true);
    expect(touched.filter((file) => /auth\.json|config\.toml|\.sqlite/.test(file))).toEqual([]);
  });

  it('aborto antes da leitura devolve failed', async () => {
    rollout(nome('2026-11-11T09-00-00'), free() + '\n');
    const controller = new AbortController();
    controller.abort();
    const reading = await createCodexLimitsReader({ codexHome: dir }).read(controller.signal);
    expect(reading).toEqual({ ok: false, problem: 'failed' });
  });
});
