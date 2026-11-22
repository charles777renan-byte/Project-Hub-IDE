import { failure } from '@project-hub/application';
import {
  LIMIT_PROVIDER_VALUES,
  type AccountLimitsDto,
  type AppResult,
  type LimitProviderId,
  type LimitsDto,
  type ProviderLimitsDto,
} from '@project-hub/contracts';
import { ACCOUNT_REMOVED, type AccountUse } from './accounts/account-use';
import type { LimitsService } from './limits';

/** De quanto em quanto tempo o ciclo de um programa lê os limites, e a espera da primeira leitura. */
export type LimitsCycle = { firstReadDelayMs: number; intervalMs: number };

export type AccountLimitsDeps = {
  accounts: Pick<AccountUse, 'defaultOf' | 'listRoots' | 'labelOf' | 'kindOf'>;
  /** A conta tem painel ou agente de missão vivo agora. */
  isLive(provider: LimitProviderId, accountId: string | null): Promise<boolean>;
  /**
   * O serviço de limites de uma conta, com a sonda apontada para a pasta dela (`root`). `undefined`: o programa não
   * tem fonte de limites nesta instalação, e fica fora do estado. Quem monta a sonda dá a ela só a pasta: a leitura
   * de limites é um leitor, e nunca recebe o ambiente do lançamento.
   */
  serviceFor(
    provider: LimitProviderId,
    accountId: string | null,
    root: string,
  ): LimitsService | undefined;
  /** Apaga a última leitura guardada de uma conta que foi removida. */
  removeStored?(provider: LimitProviderId, accountId: string | null): void;
  /** Entrega o estado inteiro à janela principal (canal `limitsEvent`). */
  publish(limits: LimitsDto): void;
  /** A janela principal existe e não está minimizada. O ciclo só lê enquanto isso vale. */
  isActive(): boolean;
  cycles: Record<LimitProviderId, LimitsCycle>;
  /** O relógio da marcação de conta esgotada. Sem ele, o do sistema. */
  now?: () => Date;
};

export type AccountLimits = {
  /** `providers`: a conta padrão de cada programa. `accounts`: todas as contas com serviço. Nunca lê. */
  get(): LimitsDto;
  /** Lê a conta padrão e as contas com sessão viva, de todos os programas. Nunca rejeita. */
  refresh(): Promise<LimitsDto>;
  /** Lê a conta pedida, a pedido da pessoa. O intervalo mínimo entre leituras é do serviço da conta. */
  refreshAccount(
    provider: LimitProviderId,
    accountId: string | null,
  ): Promise<AppResult<LimitsDto>>;
  /** O estado só de uma conta, na forma de `LimitsDto`: é o que a mensagem de cota do planejador lê. */
  stateOf(provider: LimitProviderId, accountId: string | null): LimitsDto;
  /** Publica o estado inteiro agora. Cada serviço de conta chama isto no lugar do próprio `publish`. */
  emit(): void;
  /** Cria o serviço das contas novas e descarta o das removidas. Roda antes de toda leitura do estado. */
  sync(): void;
  /**
   * Marca a conta como esgotada até `until` (ISO): a linha de limite do agente chegou antes da leitura do uso.
   * Fica só em memória, e vale também para conta sem serviço de limites (conta API).
   */
  markExhausted(provider: LimitProviderId, accountId: string | null, until: string): void;
  /** Até quando a conta está esgotada, pela leitura do uso ou pela marcação; `undefined` se não está. */
  exhaustedUntil(provider: LimitProviderId, accountId: string | null): string | undefined;
  start(): void;
  dispose(): void;
};

/** A marcação de conta esgotada: até quando, e quando foi feita. */
export type ExhaustedMark = { until: string; markedAt: string };

function timeOf(iso: string | undefined): number {
  return iso === undefined ? Number.NaN : new Date(iso).getTime();
}

/**
 * Até quando a conta está esgotada. Conta a janela em 100% que ainda não renovou, e a marcação ainda no
 * futuro — a não ser que uma leitura posterior à marcação não tenha nenhuma janela em 100%: aí a cota voltou
 * antes da hora marcada. Vale a mais tardia das que contam; nenhuma, `undefined`.
 */
export function exhaustedUntilOf(
  snapshot: ProviderLimitsDto | undefined,
  mark: ExhaustedMark | undefined,
  now: Date,
): string | undefined {
  const full = (snapshot?.windows ?? []).filter((window) => window.usedPercent >= 100);
  const candidates = full.map((window) => window.resetsAt);
  if (mark !== undefined) {
    const readAfter = timeOf(snapshot?.capturedAt) > timeOf(mark.markedAt);
    if (!(readAfter && full.length === 0)) candidates.push(mark.until);
  }
  let latest: string | undefined;
  for (const candidate of candidates) {
    const time = timeOf(candidate);
    if (!Number.isFinite(time) || time <= now.getTime()) continue;
    if (latest === undefined || time > timeOf(latest)) latest = new Date(time).toISOString();
  }
  return latest;
}

type Entry = { provider: LimitProviderId; accountId: string | null; service: LimitsService };

function keyOf(provider: LimitProviderId, accountId: string | null): string {
  return JSON.stringify([provider, accountId]);
}

/**
 * Os limites de uso por conta. Cada conta de cada programa tem o seu serviço (o mesmo dos limites de sempre), e este
 * agregador decide quem é lido: sozinhas, só a conta padrão e as que têm sessão viva — cada leitura do Claude gasta
 * cota de verdade, então conta parada só é lida quando a pessoa pede. A falha de uma conta não derruba as outras.
 */
export function createAccountLimits(deps: AccountLimitsDeps): AccountLimits {
  const entries = new Map<string, Entry>();
  const timers = new Map<LimitProviderId, ReturnType<typeof setTimeout>>();
  // Fora das entradas: a conta API não tem serviço, e também pode ser marcada.
  const marks = new Map<string, ExhaustedMark>();
  const now = deps.now ?? (() => new Date());
  let disposed = false;

  function sync(): void {
    if (disposed) return;
    const present = new Set<string>();
    for (const provider of LIMIT_PROVIDER_VALUES) {
      for (const { accountId, root } of deps.accounts.listRoots(provider)) {
        // Conta API paga por uso: não tem limite de assinatura, e a leitura gastaria a chave dela.
        if (deps.accounts.kindOf(provider, accountId) === 'api') continue;
        const key = keyOf(provider, accountId);
        present.add(key);
        if (entries.has(key)) continue;
        const service = deps.serviceFor(provider, accountId, root);
        if (service !== undefined) entries.set(key, { provider, accountId, service });
      }
    }
    for (const [key, entry] of entries) {
      if (present.has(key)) continue;
      entry.service.dispose();
      entries.delete(key);
      try {
        deps.removeStored?.(entry.provider, entry.accountId);
      } catch (error) {
        console.warn('Falha ao apagar a última leitura dos limites de uma conta removida:', error);
      }
    }
  }

  function entriesOf(provider: LimitProviderId): Entry[] {
    return [...entries.values()].filter((entry) => entry.provider === provider);
  }

  function get(): LimitsDto {
    sync();
    const providers: ProviderLimitsDto[] = [];
    const accounts: AccountLimitsDto[] = [];
    for (const provider of LIMIT_PROVIDER_VALUES) {
      const own = entriesOf(provider);
      const defaultId = deps.accounts.defaultOf(provider);
      // Padrão por chave de API: o programa fica sem limites, e não mostra os da Principal no lugar.
      const chosen =
        deps.accounts.kindOf(provider, defaultId) === 'api'
          ? undefined
          : (entries.get(keyOf(provider, defaultId)) ?? entries.get(keyOf(provider, null)));
      if (chosen !== undefined) providers.push(chosen.service.snapshot());
      for (const entry of own) {
        accounts.push({
          ...entry.service.snapshot(),
          accountId: entry.accountId,
          accountName: deps.accounts.labelOf(provider, entry.accountId).name,
        });
      }
    }
    return { providers, accounts };
  }

  /** `refresh` do serviço nunca rejeita; o `catch` protege contra um serviço que quebre essa regra. */
  async function read(entry: Entry): Promise<void> {
    try {
      await entry.service.refresh();
    } catch (error) {
      console.warn('Falha ao atualizar os limites de uma conta:', error);
    }
  }

  /** A conta é lida sozinha: é a padrão do programa, ou tem sessão viva. */
  async function wanted(entry: Entry): Promise<boolean> {
    if (deps.accounts.defaultOf(entry.provider) === entry.accountId) return true;
    try {
      return await deps.isLive(entry.provider, entry.accountId);
    } catch {
      return false;
    }
  }

  async function refreshProvider(provider: LimitProviderId): Promise<void> {
    sync();
    await Promise.all(
      entriesOf(provider).map(async (entry) => {
        if (await wanted(entry)) await read(entry);
      }),
    );
  }

  function arm(provider: LimitProviderId, delayMs: number): void {
    const timer = setTimeout(() => {
      timers.delete(provider);
      if (disposed) return;
      // Janela minimizada ou fechada: pula esta rodada e tenta de novo na próxima.
      if (deps.isActive()) void refreshProvider(provider);
      arm(provider, deps.cycles[provider].intervalMs);
    }, delayMs);
    // O timer não pode segurar o processo aberto.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    timers.set(provider, timer);
  }

  return {
    get,
    sync,

    async refresh() {
      if (disposed) return get();
      await Promise.all(LIMIT_PROVIDER_VALUES.map((provider) => refreshProvider(provider)));
      return get();
    },

    async refreshAccount(provider, accountId) {
      sync();
      const entry = entries.get(keyOf(provider, accountId));
      if (entry === undefined) return failure('VALIDATION_FAILED', ACCOUNT_REMOVED);
      await read(entry);
      return { ok: true, data: get() };
    },

    stateOf(provider, accountId) {
      sync();
      const entry = entries.get(keyOf(provider, accountId));
      return { providers: entry === undefined ? [] : [entry.service.snapshot()], accounts: [] };
    },

    markExhausted(provider, accountId, until) {
      marks.set(keyOf(provider, accountId), { until, markedAt: now().toISOString() });
    },

    exhaustedUntil(provider, accountId) {
      sync();
      const key = keyOf(provider, accountId);
      return exhaustedUntilOf(entries.get(key)?.service.snapshot(), marks.get(key), now());
    },

    emit() {
      // A janela pode ter fechado: um erro de envio não pode derrubar a leitura de quem publicou.
      try {
        deps.publish(get());
      } catch (error) {
        console.warn('Falha ao publicar os limites da assinatura:', error);
      }
    },

    start() {
      if (disposed) return;
      sync();
      for (const provider of LIMIT_PROVIDER_VALUES) {
        const current = timers.get(provider);
        if (current !== undefined) clearTimeout(current);
        // Programa sem serviço nenhum não tem o que ler: o ciclo dele nem arma.
        if (entriesOf(provider).length > 0) arm(provider, deps.cycles[provider].firstReadDelayMs);
      }
    },

    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const entry of entries.values()) entry.service.dispose();
    },
  };
}
