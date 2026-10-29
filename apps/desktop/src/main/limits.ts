import type {
  LimitProblem,
  LimitsDto,
  LimitWindowDto,
  ProviderLimitsDto,
} from '@project-hub/contracts';
import type { LimitsReading } from './claude-limits';
import type { LimitsStore } from './limits-store';

/** Primeira leitura depois de a janela principal abrir: dá tempo de a tela subir antes do processo filho. */
const FIRST_READ_DELAY_MS = 5_000;
/** Intervalo entre as leituras automáticas. */
const READ_INTERVAL_MS = 15 * 60_000;
/** Menor distância entre duas leituras. Cada uma gasta cota de verdade, então pedido em rajada não lê de novo. */
const COOLDOWN_MS = 60_000;

/** O que o serviço precisa da sonda. Nos testes, uma imitação dela. */
export type LimitsProbePort = {
  read(signal: AbortSignal): Promise<LimitsReading>;
};

export type LimitsServiceOptions = {
  /**
   * Sonda do Claude. Sem ela o serviço fica inerte: `get()` devolve o estado vazio, `refresh()` não lê nada e
   * nenhum timer é armado. É o estado dos testes de ponta a ponta sem o CLI falso, para a suíte não gastar a
   * cota real de quem a roda.
   */
  probe?: LimitsProbePort | undefined;
  /** Onde a última leitura boa fica guardada. Sem ele, a tela só vê números depois da primeira leitura. */
  store?: LimitsStore | undefined;
  /** Entrega o estado novo à janela principal (canal `limitsEvent`). */
  publish: (limits: LimitsDto) => void;
  /** A janela principal existe e não está minimizada. A leitura automática só roda enquanto isso vale. */
  isActive: () => boolean;
  /** Relógio. Os testes passam um falso. */
  now?: () => Date;
  /** Espera da primeira leitura. O padrão é 5 s; só os testes passam outro valor. */
  firstReadDelayMs?: number;
  /** Intervalo entre leituras automáticas. O padrão é 15 min; só os testes passam outro valor. */
  intervalMs?: number;
  /** Distância mínima entre leituras. O padrão é 60 s; só os testes passam outro valor. */
  cooldownMs?: number;
};

export type LimitsService = {
  /** O estado de agora, da memória. Nunca lê. */
  get(): LimitsDto;
  /**
   * Lê os limites e devolve o estado depois da leitura. Uma leitura por vez: quem pede durante uma leitura
   * espera a mesma. Um pedido a menos de 60 s do fim da última leitura, boa ou ruim, devolve o estado sem ler.
   * Nunca rejeita: falha vira `problem` no estado.
   */
  refresh(): Promise<LimitsDto>;
  /**
   * A janela principal abriu: arma a primeira leitura para 5 s depois e as seguintes a cada 15 min. Chamar de
   * novo (janela reaberta) recomeça a contagem.
   */
  start(): void;
  /** Para o timer e aborta a leitura em andamento (o `claude` filho não pode sobreviver ao app). */
  dispose(): void;
};

/**
 * Serviço dos limites da assinatura: guarda o estado do Claude, lê pela sonda, publica as mudanças e agenda
 * as leituras automáticas. A leitura que falha mantém as janelas da última boa e põe o `problem`; só a
 * leitura boa (ou "conta sem limite") troca os números.
 */
export function createLimitsService(options: LimitsServiceOptions): LimitsService {
  const { probe, store } = options;
  const now = options.now ?? (() => new Date());
  const firstReadDelayMs = options.firstReadDelayMs ?? FIRST_READ_DELAY_MS;
  const intervalMs = options.intervalMs ?? READ_INTERVAL_MS;
  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;

  // Sem sonda, o arquivo guardado também fica de fora: o estado vazio é o combinado.
  const stored = probe === undefined ? undefined : store?.load();
  let windows: LimitWindowDto[] = stored?.windows ?? [];
  let capturedAt: string | undefined = stored?.capturedAt;
  let problem: LimitProblem | undefined;
  let refreshing = false;

  let inflight: Promise<LimitsDto> | undefined;
  let controller: AbortController | undefined;
  let lastFinishedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function snapshot(): ProviderLimitsDto {
    return {
      provider: 'claude',
      windows: windows.map((window) => ({ ...window })),
      ...(capturedAt === undefined ? {} : { capturedAt }),
      refreshing,
      ...(problem === undefined ? {} : { problem }),
    };
  }

  function get(): LimitsDto {
    return { providers: [snapshot()] };
  }

  /** A janela pode ter fechado entre a leitura e o envio; um erro de envio não pode derrubar a leitura. */
  function publish(): void {
    try {
      options.publish(get());
    } catch (error) {
      console.warn('Falha ao publicar os limites da assinatura:', error);
    }
  }

  function persist(): void {
    if (store === undefined || capturedAt === undefined) return;
    try {
      store.save({ windows, capturedAt });
    } catch (error) {
      console.warn('Falha ao guardar a última leitura dos limites:', error);
    }
  }

  function apply(reading: LimitsReading): void {
    if (reading.ok) {
      windows = reading.windows;
      capturedAt = reading.capturedAt;
      problem = undefined;
      persist();
      return;
    }
    problem = reading.problem;
    // Conta sem limite por janela é uma leitura boa que diz "não há número": os números antigos eram de
    // outra conta. As outras falhas não sabem nada novo e mantêm o que se sabia.
    if (reading.problem === 'no-limits') {
      windows = [];
      capturedAt = now().toISOString();
      persist();
    }
  }

  async function read(probePort: LimitsProbePort): Promise<LimitsDto> {
    const abort = new AbortController();
    controller = abort;
    refreshing = true;
    publish();
    let reading: LimitsReading;
    try {
      reading = await probePort.read(abort.signal);
    } catch {
      reading = { ok: false, problem: 'failed' };
    }
    if (controller === abort) controller = undefined;
    // Depois do `dispose` a janela já se foi: nada de estado novo, arquivo nem evento.
    if (disposed) return get();
    lastFinishedAt = now().getTime();
    refreshing = false;
    apply(reading);
    publish();
    return get();
  }

  function refresh(): Promise<LimitsDto> {
    if (probe === undefined || disposed) return Promise.resolve(get());
    if (inflight !== undefined) return inflight;
    if (lastFinishedAt !== undefined && now().getTime() - lastFinishedAt < cooldownMs) {
      return Promise.resolve(get());
    }
    const pending = read(probe).finally(() => {
      if (inflight === pending) inflight = undefined;
    });
    inflight = pending;
    return pending;
  }

  function arm(delayMs: number): void {
    timer = setTimeout(tick, delayMs);
    // O timer não pode segurar o processo aberto.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  }

  function tick(): void {
    timer = undefined;
    if (disposed) return;
    // Janela minimizada ou fechada: pula esta rodada e tenta de novo na próxima.
    if (options.isActive()) void refresh();
    arm(intervalMs);
  }

  return {
    get,
    refresh,
    start() {
      if (probe === undefined || disposed) return;
      if (timer !== undefined) clearTimeout(timer);
      arm(firstReadDelayMs);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      controller?.abort();
    },
  };
}
