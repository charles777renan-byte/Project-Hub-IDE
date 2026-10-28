import type { LimitsDto, LimitWindowDto } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LimitsReading } from '../src/main/claude-limits';
import { createLimitsService, type LimitsProbePort } from '../src/main/limits';
import type { LimitsStore, StoredLimits } from '../src/main/limits-store';

const WINDOWS: LimitWindowDto[] = [
  { id: 'five_hour', usedPercent: 16, resetsAt: '2026-10-28T15:00:00.000Z' },
  { id: 'seven_day', usedPercent: 13, resetsAt: '2026-11-02T00:00:00.000Z' },
];

function good(
  windows: LimitWindowDto[] = WINDOWS,
  capturedAt = new Date().toISOString(),
): LimitsReading {
  return { ok: true, windows, capturedAt };
}

/** Sonda cujas leituras o teste resolve na mão, uma a uma. */
function controlledProbe() {
  const pending: { resolve(reading: LimitsReading): void; signal: AbortSignal }[] = [];
  const probe: LimitsProbePort = {
    read: vi.fn(
      (signal: AbortSignal) =>
        new Promise<LimitsReading>((resolve) => {
          pending.push({ resolve, signal });
        }),
    ),
  };
  return {
    probe,
    reads: () => vi.mocked(probe.read).mock.calls.length,
    /** Resolve a leitura mais antiga ainda pendente. */
    finish(reading: LimitsReading) {
      const next = pending.shift();
      if (next === undefined) throw new Error('nenhuma leitura pendente');
      next.resolve(reading);
    },
    lastSignal: () => pending.at(-1)?.signal,
  };
}

function memoryStore(initial?: StoredLimits) {
  let saved: StoredLimits | undefined = initial;
  const store: LimitsStore = {
    load: () => saved,
    save: vi.fn((stored: StoredLimits) => {
      saved = stored;
    }),
  };
  return { store, saved: () => saved };
}

function claude(limits: LimitsDto) {
  const state = limits.providers[0];
  if (state === undefined) throw new Error('sem o estado do Claude');
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('estado e get()', () => {
  it('sem leitura nenhuma, o estado do Claude vem vazio, sem problema e sem ler', () => {
    const probe = controlledProbe();
    const service = createLimitsService({
      probe: probe.probe,
      publish: vi.fn(),
      isActive: () => true,
    });

    expect(service.get()).toEqual({
      providers: [{ provider: 'claude', windows: [], refreshing: false }],
    });
    expect(probe.reads()).toBe(0);
  });

  it('abre com a última leitura boa guardada, sem ler', () => {
    const probe = controlledProbe();
    const { store } = memoryStore({ windows: WINDOWS, capturedAt: '2026-10-28T11:00:00.000Z' });
    const service = createLimitsService({
      probe: probe.probe,
      store,
      publish: vi.fn(),
      isActive: () => true,
    });

    expect(claude(service.get())).toEqual({
      provider: 'claude',
      windows: WINDOWS,
      capturedAt: '2026-10-28T11:00:00.000Z',
      refreshing: false,
    });
    expect(probe.reads()).toBe(0);
  });

  it('o estado devolvido é uma cópia: mexer nele não muda o serviço', () => {
    const { store } = memoryStore({ windows: WINDOWS, capturedAt: '2026-10-28T11:00:00.000Z' });
    const service = createLimitsService({
      probe: controlledProbe().probe,
      store,
      publish: vi.fn(),
      isActive: () => true,
    });

    claude(service.get()).windows[0]!.usedPercent = 99;

    expect(claude(service.get()).windows[0]?.usedPercent).toBe(16);
  });
});

describe('refresh()', () => {
  it('lê, troca as janelas, guarda a leitura e publica no começo e no fim', async () => {
    const probe = controlledProbe();
    const publish = vi.fn<(limits: LimitsDto) => void>();
    const saved = memoryStore();
    const service = createLimitsService({
      probe: probe.probe,
      store: saved.store,
      publish,
      isActive: () => true,
    });

    const pending = service.refresh();

    expect(claude(service.get()).refreshing).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(claude(publish.mock.calls[0]![0])).toMatchObject({ refreshing: true, windows: [] });

    probe.finish(good(WINDOWS, '2026-10-28T12:00:04.000Z'));
    const result = await pending;

    expect(claude(result)).toEqual({
      provider: 'claude',
      windows: WINDOWS,
      capturedAt: '2026-10-28T12:00:04.000Z',
      refreshing: false,
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]![0]).toEqual(result);
    expect(saved.saved()).toEqual({ windows: WINDOWS, capturedAt: '2026-10-28T12:00:04.000Z' });
  });

  it('uma leitura por vez: pedidos durante a leitura esperam a mesma', async () => {
    const probe = controlledProbe();
    const publish = vi.fn();
    const service = createLimitsService({ probe: probe.probe, publish, isActive: () => true });

    const first = service.refresh();
    const second = service.refresh();
    const third = service.refresh();
    probe.finish(good());

    const results = await Promise.all([first, second, third]);

    expect(probe.reads()).toBe(1);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('pedido a menos de 60 s do fim da última leitura boa devolve o estado sem ler', async () => {
    const probe = controlledProbe();
    const publish = vi.fn();
    const service = createLimitsService({ probe: probe.probe, publish, isActive: () => true });
    const first = service.refresh();
    probe.finish(good());
    await first;
    publish.mockClear();

    vi.advanceTimersByTime(59_999);
    const again = await service.refresh();

    expect(probe.reads()).toBe(1);
    expect(claude(again).windows).toEqual(WINDOWS);
    expect(publish).not.toHaveBeenCalled();
  });

  it('o cooldown vale também depois de uma leitura ruim', async () => {
    const probe = controlledProbe();
    const service = createLimitsService({
      probe: probe.probe,
      publish: vi.fn(),
      isActive: () => true,
    });
    const first = service.refresh();
    probe.finish({ ok: false, problem: 'failed' });
    await first;

    vi.advanceTimersByTime(30_000);
    const again = await service.refresh();

    expect(probe.reads()).toBe(1);
    expect(claude(again).problem).toBe('failed');
  });

  it('passados 60 s, lê de novo', async () => {
    const probe = controlledProbe();
    const service = createLimitsService({
      probe: probe.probe,
      publish: vi.fn(),
      isActive: () => true,
    });
    const first = service.refresh();
    probe.finish(good());
    await first;

    vi.advanceTimersByTime(60_000);
    const second = service.refresh();
    probe.finish(
      good([{ id: 'five_hour', usedPercent: 40, resetsAt: '2026-10-28T15:00:00.000Z' }]),
    );

    expect(probe.reads()).toBe(2);
    expect(claude(await second).windows[0]?.usedPercent).toBe(40);
  });

  it('o cooldown conta do fim da leitura, não do começo', async () => {
    const probe = controlledProbe();
    const service = createLimitsService({
      probe: probe.probe,
      publish: vi.fn(),
      isActive: () => true,
    });
    const first = service.refresh();
    vi.advanceTimersByTime(20_000);
    probe.finish(good());
    await first;

    vi.advanceTimersByTime(50_000);
    await service.refresh();

    expect(probe.reads()).toBe(1);
  });

  it('leitura que falha mantém as janelas da última boa e põe o problema', async () => {
    const probe = controlledProbe();
    const publish = vi.fn<(limits: LimitsDto) => void>();
    const saved = memoryStore();
    const service = createLimitsService({
      probe: probe.probe,
      store: saved.store,
      publish,
      isActive: () => true,
    });
    const first = service.refresh();
    probe.finish(good(WINDOWS, '2026-10-28T12:00:04.000Z'));
    await first;
    vi.advanceTimersByTime(60_000);

    const second = service.refresh();
    probe.finish({ ok: false, problem: 'not-logged-in' });
    const result = claude(await second);

    expect(result).toEqual({
      provider: 'claude',
      windows: WINDOWS,
      capturedAt: '2026-10-28T12:00:04.000Z',
      refreshing: false,
      problem: 'not-logged-in',
    });
    // A leitura ruim não apaga o arquivo da última boa.
    expect(saved.saved()).toEqual({ windows: WINDOWS, capturedAt: '2026-10-28T12:00:04.000Z' });
    expect(claude(publish.mock.calls.at(-1)![0]).problem).toBe('not-logged-in');
  });

  it('a leitura boa seguinte tira o problema', async () => {
    const probe = controlledProbe();
    const service = createLimitsService({
      probe: probe.probe,
      publish: vi.fn(),
      isActive: () => true,
    });
    const first = service.refresh();
    probe.finish({ ok: false, problem: 'failed' });
    await first;
    vi.advanceTimersByTime(60_000);

    const second = service.refresh();
    probe.finish(good());

    expect(claude(await second).problem).toBeUndefined();
    expect('problem' in claude(service.get())).toBe(false);
  });

  it('falha sem nenhuma leitura boa antes: sem janelas, com o problema e sem capturedAt', async () => {
    const probe = controlledProbe();
    const service = createLimitsService({
      probe: probe.probe,
      publish: vi.fn(),
      isActive: () => true,
    });
    const pending = service.refresh();
    probe.finish({ ok: false, problem: 'not-installed' });

    expect(claude(await pending)).toEqual({
      provider: 'claude',
      windows: [],
      refreshing: false,
      problem: 'not-installed',
    });
  });

  it('conta sem limite por janela: leitura boa que zera os números antigos', async () => {
    const probe = controlledProbe();
    const saved = memoryStore({ windows: WINDOWS, capturedAt: '2026-10-28T11:00:00.000Z' });
    const service = createLimitsService({
      probe: probe.probe,
      store: saved.store,
      publish: vi.fn(),
      isActive: () => true,
    });
    const pending = service.refresh();
    probe.finish({ ok: false, problem: 'no-limits' });

    expect(claude(await pending)).toEqual({
      provider: 'claude',
      windows: [],
      capturedAt: '2026-10-28T12:00:00.000Z',
      refreshing: false,
      problem: 'no-limits',
    });
    expect(saved.saved()).toEqual({ windows: [], capturedAt: '2026-10-28T12:00:00.000Z' });
  });

  it('sonda que rejeita (não deveria) vira failed e não derruba o serviço', async () => {
    const probe: LimitsProbePort = { read: () => Promise.reject(new Error('quebrou')) };
    const service = createLimitsService({ probe, publish: vi.fn(), isActive: () => true });

    expect(claude(await service.refresh())).toMatchObject({ refreshing: false, problem: 'failed' });
  });

  it('falha ao guardar o arquivo não perde a leitura nem rejeita', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const probe = controlledProbe();
    const store: LimitsStore = {
      load: () => undefined,
      save: () => {
        throw new Error('disco cheio');
      },
    };
    const service = createLimitsService({
      probe: probe.probe,
      store,
      publish: vi.fn(),
      isActive: () => true,
    });
    const pending = service.refresh();
    probe.finish(good());

    expect(claude(await pending).windows).toEqual(WINDOWS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('erro ao publicar não derruba a leitura', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const probe = controlledProbe();
    const service = createLimitsService({
      probe: probe.probe,
      publish: () => {
        throw new Error('janela destruída');
      },
      isActive: () => true,
    });
    const pending = service.refresh();
    probe.finish(good());

    expect(claude(await pending).windows).toEqual(WINDOWS);
    warn.mockRestore();
  });
});

describe('agendamento', () => {
  function scheduled(isActive: () => boolean = () => true) {
    const probe = controlledProbe();
    const publish = vi.fn();
    const service = createLimitsService({ probe: probe.probe, publish, isActive });
    return { probe, publish, service };
  }

  it('não lê nada antes de start()', () => {
    const { probe } = scheduled();

    vi.advanceTimersByTime(60 * 60_000);

    expect(probe.reads()).toBe(0);
  });

  it('a primeira leitura vem 5 s depois de start(), e as outras a cada 15 minutos', async () => {
    const { probe, service } = scheduled();
    service.start();

    vi.advanceTimersByTime(4_999);
    expect(probe.reads()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(probe.reads()).toBe(1);
    probe.finish(good());
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(15 * 60_000 - 1);
    expect(probe.reads()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(probe.reads()).toBe(2);
    probe.finish(good());
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(15 * 60_000);
    expect(probe.reads()).toBe(3);
  });

  it('com a janela minimizada ou fechada, pula a rodada e volta a ler quando ela aparece', async () => {
    let active = false;
    const { probe, service } = scheduled(() => active);
    service.start();

    vi.advanceTimersByTime(5_000);
    expect(probe.reads()).toBe(0);
    vi.advanceTimersByTime(15 * 60_000);
    expect(probe.reads()).toBe(0);

    active = true;
    vi.advanceTimersByTime(15 * 60_000);
    expect(probe.reads()).toBe(1);
    probe.finish(good());
    await vi.advanceTimersByTimeAsync(0);
  });

  it('start() de novo (janela reaberta) recomeça a contagem, sem duplicar o timer', () => {
    const { probe, service } = scheduled();
    service.start();
    vi.advanceTimersByTime(3_000);

    service.start();
    vi.advanceTimersByTime(4_999);
    expect(probe.reads()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(probe.reads()).toBe(1);
  });

  it('dispose() para o timer e aborta a leitura em andamento, sem publicar nem guardar', async () => {
    const probe = controlledProbe();
    const publish = vi.fn();
    const saved = memoryStore();
    const service = createLimitsService({
      probe: probe.probe,
      store: saved.store,
      publish,
      isActive: () => true,
    });
    service.start();
    vi.advanceTimersByTime(5_000);
    expect(probe.reads()).toBe(1);
    publish.mockClear();

    service.dispose();
    expect(probe.lastSignal()?.aborted).toBe(true);
    probe.finish(good());
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(60 * 60_000);

    expect(probe.reads()).toBe(1);
    expect(publish).not.toHaveBeenCalled();
    expect(saved.store.save).not.toHaveBeenCalled();
  });

  it('depois do dispose(), refresh() e start() não leem nada', async () => {
    const { probe, service } = scheduled();
    service.dispose();

    service.start();
    await service.refresh();
    vi.advanceTimersByTime(60 * 60_000);

    expect(probe.reads()).toBe(0);
  });
});

describe('serviço inerte (sem sonda)', () => {
  it('get() devolve o estado vazio sem problema, mesmo com arquivo guardado, e refresh() não lê nada', async () => {
    const publish = vi.fn();
    const { store } = memoryStore({ windows: WINDOWS, capturedAt: '2026-10-28T11:00:00.000Z' });
    const service = createLimitsService({ store, publish, isActive: () => true });
    const empty = { providers: [{ provider: 'claude', windows: [], refreshing: false }] };

    expect(service.get()).toEqual(empty);
    expect(await service.refresh()).toEqual(empty);
    service.start();
    vi.advanceTimersByTime(60 * 60_000);
    expect(service.get()).toEqual(empty);
    expect(publish).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
});
