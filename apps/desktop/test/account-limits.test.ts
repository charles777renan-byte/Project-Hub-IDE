import type { LimitProviderId, LimitsDto, ProviderLimitsDto } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountLimits, type AccountLimitsDeps } from '../src/main/account-limits';
import type { LimitsService } from '../src/main/limits';

const X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type FakeService = LimitsService & { reads: number; disposed: boolean; percent: number };

/** Serviço falso de uma conta: conta as leituras e devolve uma janela com o percentual de agora. */
function fakeService(provider: LimitProviderId, cooldown = false): FakeService {
  let last = -Infinity;
  const service: FakeService = {
    reads: 0,
    disposed: false,
    percent: 0,
    snapshot(): ProviderLimitsDto {
      return {
        provider,
        windows:
          service.reads === 0
            ? []
            : [
                {
                  id: 'five_hour',
                  usedPercent: service.percent,
                  resetsAt: '2026-11-21T20:00:00.000Z',
                },
              ],
        refreshing: false,
      };
    },
    get: () => ({ providers: [service.snapshot()], accounts: [] }),
    refresh() {
      // O intervalo mínimo é do serviço de verdade; o falso o imita quando o teste pede.
      if (!cooldown || Date.now() - last >= 60_000) {
        service.reads += 1;
        last = Date.now();
      }
      return Promise.resolve(service.get());
    },
    start: () => undefined,
    dispose() {
      service.disposed = true;
    },
  };
  return service;
}

function setup(
  options: {
    extras?: string[];
    defaults?: Partial<Record<LimitProviderId, string | null>>;
    live?: string[];
    cooldown?: boolean;
    codex?: boolean;
    api?: string[];
  } = {},
) {
  const state = {
    api: new Set(options.api ?? []),
    extras: options.extras ?? [X],
    defaults: { claude: null, codex: null, ...options.defaults } as Record<
      LimitProviderId,
      string | null
    >,
    live: new Set(options.live ?? []),
  };
  const services = new Map<string, FakeService>();
  const removedFiles: string[] = [];
  const published: LimitsDto[] = [];
  const key = (provider: string, accountId: string | null) => `${provider}:${accountId ?? ''}`;
  const deps: AccountLimitsDeps = {
    accounts: {
      defaultOf: (provider) => state.defaults[provider],
      listRoots: (provider) => [
        { accountId: null, root: `/raiz/${provider}` },
        ...state.extras.map((id) => ({ accountId: id, root: `/contas/${provider}/${id}` })),
      ],
      labelOf: (_provider, accountId) =>
        accountId === null
          ? { name: 'Principal', removed: false }
          : { name: `Conta ${accountId.slice(0, 1)}`, removed: !state.extras.includes(accountId) },
      kindOf: (_provider, accountId) =>
        accountId !== null && state.api.has(accountId) ? 'api' : 'subscription',
    },
    isLive: (provider, accountId) => Promise.resolve(state.live.has(key(provider, accountId))),
    serviceFor: (provider, accountId) => {
      if (provider === 'codex' && options.codex !== true) return undefined;
      const service = fakeService(provider, options.cooldown === true);
      services.set(key(provider, accountId), service);
      return service;
    },
    removeStored: (provider, accountId) => void removedFiles.push(key(provider, accountId)),
    publish: (limits) => void published.push(limits),
    isActive: () => true,
    cycles: {
      claude: { firstReadDelayMs: 5_000, intervalMs: 15 * 60_000 },
      codex: { firstReadDelayMs: 1_000, intervalMs: 2 * 60_000 },
    },
  };
  const limits = createAccountLimits(deps);
  const reads = (provider: string, accountId: string | null) =>
    services.get(key(provider, accountId))?.reads ?? 0;
  return { limits, state, services, reads, removedFiles, published, key };
}

describe('createAccountLimits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('conta API nunca entra na leitura de limites, nem como padrão nem com painel vivo', async () => {
    const h = setup({ extras: [X, Y], api: [Y], defaults: { claude: Y }, live: [`claude:${Y}`] });
    h.limits.start();

    await vi.advanceTimersByTimeAsync(5_000 + 15 * 60_000);

    expect(h.services.has(h.key('claude', Y))).toBe(false);
    const state = h.limits.get();
    expect(state.accounts.map((account) => account.accountId)).not.toContain(Y);
    // A padrão é a conta API: o programa fica sem limites, e não mostra os da Principal no lugar.
    expect(state.providers.filter((limits) => limits.provider === 'claude')).toEqual([]);
    expect(h.reads('claude', null)).toBe(0);
    expect((await h.limits.refreshAccount('claude', Y)).ok).toBe(false);
  });

  it('lê sozinha só a conta padrão: a conta parada fica com zero leituras', async () => {
    const h = setup();
    h.limits.start();

    await vi.advanceTimersByTimeAsync(5_000 + 3 * 15 * 60_000);

    expect(h.reads('claude', null)).toBe(4);
    expect(h.reads('claude', X)).toBe(0);
  });

  it('conta com sessão viva passa a ser lida no ciclo seguinte', async () => {
    const h = setup();
    h.limits.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.reads('claude', X)).toBe(0);

    h.state.live.add(h.key('claude', X));
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(h.reads('claude', X)).toBe(1);
    expect(h.reads('claude', null)).toBe(2);
  });

  it('a conta que vira a padrão passa a ser a do programa, e a Principal deixa de ser lida sozinha', async () => {
    const h = setup();
    h.limits.start();
    await vi.advanceTimersByTimeAsync(5_000);
    const service = h.services.get(h.key('claude', X));
    if (service !== undefined) service.percent = 42;

    h.state.defaults.claude = X;
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(h.reads('claude', null)).toBe(1);
    expect(h.reads('claude', X)).toBe(1);
    expect(h.limits.get().providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        windows: [expect.objectContaining({ usedPercent: 42 })],
      }),
    ]);
  });

  it('janela fora de vista: o ciclo não lê ninguém', async () => {
    const h = setup();
    const limits = createAccountLimits({
      accounts: {
        defaultOf: () => null,
        listRoots: () => [{ accountId: null, root: '/raiz' }],
        labelOf: () => ({ name: 'Principal', removed: false }),
        kindOf: () => 'subscription',
      },
      isLive: () => Promise.resolve(false),
      serviceFor: (provider, accountId) => {
        const service = fakeService(provider);
        h.services.set(`fora:${provider}:${accountId ?? ''}`, service);
        return service;
      },
      publish: () => undefined,
      isActive: () => false,
      cycles: {
        claude: { firstReadDelayMs: 5_000, intervalMs: 15 * 60_000 },
        codex: { firstReadDelayMs: 1_000, intervalMs: 2 * 60_000 },
      },
    });
    limits.start();

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(h.services.get('fora:claude:')?.reads).toBe(0);
    limits.dispose();
  });

  it('get() traz a padrão em providers e todas as contas em accounts, com o nome de cada uma', () => {
    const h = setup({ codex: true });

    const state = h.limits.get();

    expect(state.providers.map((entry) => entry.provider)).toEqual(['claude', 'codex']);
    expect(
      state.accounts.map((entry) => [entry.provider, entry.accountId, entry.accountName]),
    ).toEqual([
      ['claude', null, 'Principal'],
      ['claude', X, 'Conta a'],
      ['codex', null, 'Principal'],
      ['codex', X, 'Conta a'],
    ]);
  });

  it('programa sem serviço (Codex sem pasta) não entra no estado', () => {
    const h = setup();

    expect(h.limits.get().providers.map((entry) => entry.provider)).toEqual(['claude']);
    expect(h.limits.get().accounts.every((entry) => entry.provider === 'claude')).toBe(true);
  });

  it('refresh() lê a padrão e as contas vivas, e não as paradas', async () => {
    const h = setup({ extras: [X, Y], live: [`claude:${Y}`] });

    await h.limits.refresh();

    expect(h.reads('claude', null)).toBe(1);
    expect(h.reads('claude', Y)).toBe(1);
    expect(h.reads('claude', X)).toBe(0);
  });

  it('refreshAccount lê a conta parada uma vez, e de novo só depois do intervalo mínimo', async () => {
    const h = setup({ cooldown: true });

    const first = await h.limits.refreshAccount('claude', X);
    await h.limits.refreshAccount('claude', X);

    expect(first.ok).toBe(true);
    expect(h.reads('claude', X)).toBe(1);
    expect(h.reads('claude', null)).toBe(0);

    await vi.advanceTimersByTimeAsync(60_000);
    await h.limits.refreshAccount('claude', X);
    expect(h.reads('claude', X)).toBe(2);
  });

  it('refreshAccount de conta removida ou desconhecida falha, sem ler', async () => {
    const h = setup();

    expect(await h.limits.refreshAccount('claude', Y)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'A conta foi removida.' },
    });
    expect(h.reads('claude', null)).toBe(0);
  });

  it('conta removida: o serviço é descartado, a entrada some e o arquivo dela é apagado', () => {
    const h = setup();
    h.limits.sync();
    const service = h.services.get(h.key('claude', X));

    h.state.extras = [];
    const state = h.limits.get();

    expect(service?.disposed).toBe(true);
    expect(state.accounts.map((entry) => entry.accountId)).toEqual([null]);
    expect(h.removedFiles).toEqual([h.key('claude', X)]);
  });

  it('a padrão removida volta para a Principal em providers', () => {
    const h = setup({ defaults: { claude: null } });
    h.limits.sync();

    h.state.extras = [];

    expect(h.limits.get().providers).toHaveLength(1);
  });

  it('stateOf devolve só o estado da conta pedida, para a mensagem de cota', async () => {
    const h = setup();
    h.limits.sync();
    const service = h.services.get(h.key('claude', X));
    if (service !== undefined) service.percent = 100;
    await h.limits.refreshAccount('claude', X);

    expect(h.limits.stateOf('claude', X).providers).toEqual([
      expect.objectContaining({ windows: [expect.objectContaining({ usedPercent: 100 })] }),
    ]);
    expect(h.limits.stateOf('claude', null).providers[0]?.windows).toEqual([]);
    expect(h.limits.stateOf('claude', Y)).toEqual({ providers: [], accounts: [] });
  });

  it('emit() publica o estado inteiro, e dispose() descarta todos os serviços e para os ciclos', async () => {
    const h = setup();
    h.limits.start();
    h.limits.emit();
    expect(h.published).toHaveLength(1);
    expect(h.published[0]?.accounts).toHaveLength(2);

    h.limits.dispose();
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect([...h.services.values()].every((service) => service.disposed)).toBe(true);
    expect(h.reads('claude', null)).toBe(0);
  });
});
