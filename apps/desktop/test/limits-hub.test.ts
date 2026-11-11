import type { LimitsDto, LimitWindowDto } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LimitsReading } from '../src/main/claude-limits';
import { createLimitsService, type LimitsProbePort, type LimitsService } from '../src/main/limits';
import { createLimitsHub, type LimitsHub } from '../src/main/limits-hub';

const CLAUDE_WINDOWS: LimitWindowDto[] = [
  { id: 'five_hour', usedPercent: 16, resetsAt: '2026-10-28T15:00:00.000Z' },
];
const CODEX_WINDOWS: LimitWindowDto[] = [
  {
    id: 'thirty_day',
    usedPercent: 47,
    resetsAt: '2026-11-28T00:00:00.000Z',
    durationMinutes: 43200,
  },
];

/** Sonda cuja leitura o teste resolve na mão. */
function manualProbe() {
  let resolve: (reading: LimitsReading) => void = () => undefined;
  const probe: LimitsProbePort = {
    read: () =>
      new Promise<LimitsReading>((done) => {
        resolve = done;
      }),
  };
  return { probe, finish: (reading: LimitsReading) => resolve(reading) };
}

function fakeService(provider: 'claude' | 'codex'): LimitsService {
  return {
    snapshot: vi.fn(() => ({ provider, windows: [], refreshing: false })),
    get: vi.fn(() => ({ providers: [{ provider, windows: [], refreshing: false }] })),
    refresh: vi.fn(() => Promise.resolve({ providers: [] })),
    start: vi.fn(),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('limits-hub: estado', () => {
  it('get() junta os serviços ativos em ordem fixa, claude antes de codex', () => {
    const hub = createLimitsHub({
      services: { codex: fakeService('codex'), claude: fakeService('claude') },
      publish: vi.fn(),
    });

    expect(hub.get().providers.map((provider) => provider.provider)).toEqual(['claude', 'codex']);
  });

  it('sem serviço do Codex, só o Claude aparece', () => {
    const hub = createLimitsHub({ services: { claude: fakeService('claude') }, publish: vi.fn() });

    expect(hub.get().providers.map((provider) => provider.provider)).toEqual(['claude']);
  });

  it('Claude inerte (sem sonda) continua no DTO, vazio, com o Codex ativo', () => {
    const claude = createLimitsService({ publish: vi.fn(), isActive: () => true });
    const codex = createLimitsService({
      provider: 'codex',
      probe: manualProbe().probe,
      publish: vi.fn(),
      isActive: () => true,
    });
    const hub = createLimitsHub({ services: { claude, codex }, publish: vi.fn() });

    expect(hub.get()).toEqual({
      providers: [
        { provider: 'claude', windows: [], refreshing: false },
        { provider: 'codex', windows: [], refreshing: false },
      ],
    });
  });
});

describe('limits-hub: refresh', () => {
  it('espera os dois serviços e devolve o DTO inteiro', async () => {
    const claudeProbe = manualProbe();
    const codexProbe = manualProbe();
    const hubRef: { current?: LimitsHub } = {};
    const emit = () => hubRef.current?.emit();
    const claude = createLimitsService({
      probe: claudeProbe.probe,
      publish: emit,
      isActive: () => true,
    });
    const codex = createLimitsService({
      provider: 'codex',
      probe: codexProbe.probe,
      publish: emit,
      isActive: () => true,
    });
    const hub = createLimitsHub({ services: { claude, codex }, publish: vi.fn() });
    hubRef.current = hub;

    let done = false;
    const pending = hub.refresh().then((limits) => {
      done = true;
      return limits;
    });
    claudeProbe.finish({
      ok: true,
      windows: CLAUDE_WINDOWS,
      capturedAt: '2026-10-28T12:00:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);

    codexProbe.finish({
      ok: true,
      windows: CODEX_WINDOWS,
      capturedAt: '2026-10-28T11:50:00.000Z',
    });
    const limits = await pending;

    expect(limits.providers.map((p) => [p.provider, p.windows.length, p.refreshing])).toEqual([
      ['claude', 1, false],
      ['codex', 1, false],
    ]);
  });

  it('a falha de um serviço (rejeição inesperada) não derruba o outro', async () => {
    const codex = fakeService('codex');
    const claude = fakeService('claude');
    vi.mocked(claude.refresh).mockRejectedValue(new Error('quebrou'));
    const hub = createLimitsHub({ services: { claude, codex }, publish: vi.fn() });

    const limits = await hub.refresh();

    expect(codex.refresh).toHaveBeenCalledTimes(1);
    expect(limits.providers.map((provider) => provider.provider)).toEqual(['claude', 'codex']);
  });
});

describe('limits-hub: eventos', () => {
  it('cada serviço que publica faz o hub emitir o DTO inteiro, com os dois provedores', async () => {
    const published: LimitsDto[] = [];
    const hubRef: { current?: LimitsHub } = {};
    const emit = () => hubRef.current?.emit();
    const codexProbe = manualProbe();
    const claude = createLimitsService({ publish: emit, isActive: () => true });
    const codex = createLimitsService({
      provider: 'codex',
      probe: codexProbe.probe,
      publish: emit,
      isActive: () => true,
    });
    hubRef.current = createLimitsHub({
      services: { claude, codex },
      publish: (limits) => published.push(limits),
    });

    const pending = codex.refresh();
    expect(published.at(-1)?.providers.map((p) => [p.provider, p.refreshing])).toEqual([
      ['claude', false],
      ['codex', true],
    ]);
    codexProbe.finish({
      ok: true,
      windows: CODEX_WINDOWS,
      capturedAt: '2026-10-28T11:50:00.000Z',
    });
    await pending;

    expect(published.at(-1)?.providers.map((p) => [p.provider, p.refreshing])).toEqual([
      ['claude', false],
      ['codex', false],
    ]);
    expect(published.at(-1)?.providers[1]?.windows).toEqual(CODEX_WINDOWS);
  });

  it('um publish que lança não derruba o hub', () => {
    const hub = createLimitsHub({
      services: { claude: fakeService('claude') },
      publish: () => {
        throw new Error('janela fechada');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => hub.emit()).not.toThrow();
    warn.mockRestore();
  });
});

describe('limits-hub: start e dispose', () => {
  it('repassam para todos os serviços', () => {
    const claude = fakeService('claude');
    const codex = fakeService('codex');
    const hub = createLimitsHub({ services: { claude, codex }, publish: vi.fn() });

    hub.start();
    hub.dispose();

    expect(claude.start).toHaveBeenCalledTimes(1);
    expect(codex.start).toHaveBeenCalledTimes(1);
    expect(claude.dispose).toHaveBeenCalledTimes(1);
    expect(codex.dispose).toHaveBeenCalledTimes(1);
  });
});
