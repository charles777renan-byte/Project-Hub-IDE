import type {
  LimitProblem,
  LimitProviderId,
  LimitWindowDto,
  ProviderLimitsDto,
} from '@project-hub/contracts';

/** Programas que o app mostra nos limites, na ordem fixa da tela. O Antigravity ainda não tem fonte de dados. */
export type LimitProgramId = LimitProviderId | 'antigravity';

export const LIMIT_PROVIDER_ORDER: readonly LimitProgramId[] = ['claude', 'codex', 'antigravity'];

/**
 * Programas com cartão, botão e seção: o Claude sempre (ele existe mesmo antes da primeira leitura) e os outros só
 * quando o estado dos limites os traz. Um programa novo só precisa do descritor e dos rótulos.
 */
export function presentProviders(
  providers: readonly Pick<ProviderLimitsDto, 'provider'>[],
): LimitProviderId[] {
  const present = new Set<string>(providers.map((entry) => entry.provider));
  return LIMIT_PROVIDER_ORDER.filter(
    (id): id is LimitProviderId => id === 'claude' || present.has(id),
  );
}

/** Programas "Em breve": os que o estado dos limites ainda não traz, na ordem fixa (o Claude nunca entra). */
export function pendingPrograms(
  providers: readonly Pick<ProviderLimitsDto, 'provider'>[],
): LimitProgramId[] {
  const present = new Set<string>(providers.map((entry) => entry.provider));
  return LIMIT_PROVIDER_ORDER.filter((id) => id !== 'claude' && !present.has(id));
}

/** Descritor de cada programa: o nome que a tela mostra. */
export const LIMIT_PROVIDERS: Record<LimitProgramId, { id: LimitProgramId; label: string }> = {
  claude: { id: 'claude', label: 'Claude' },
  codex: { id: 'codex', label: 'Codex' },
  antigravity: { id: 'antigravity', label: 'Antigravity CLI' },
};

/** Rótulo das janelas que o Início conhece, por programa; as outras aparecem pela duração ou pelo próprio `id`. */
const WINDOW_LABELS: Record<LimitProviderId, Record<string, string>> = {
  claude: {
    five_hour: 'Sessão atual',
    seven_day: 'Semanal (todos os modelos)',
  },
  codex: {
    five_hour: 'Sessão atual',
    seven_day: 'Semanal',
    thirty_day: 'Mensal',
  },
};

/** Mensagem fixa de cada problema de leitura do Claude. */
export const LIMIT_PROBLEM_TEXT: Record<LimitProblem, string> = {
  'not-installed': 'O Claude Code não foi encontrado.',
  'not-logged-in': 'O Claude Code pede login. Abra o Claude num terminal e entre.',
  'no-data': 'O limite ainda não foi registrado.',
  'no-limits':
    'Esta conta não tem limite de uso por janela (ela só existe para assinantes Pro e Max).',
  failed: 'Não foi possível ler os limites agora.',
};

/** Mensagem fixa de cada problema de leitura do Codex. */
const CODEX_PROBLEM_TEXT: Record<LimitProblem, string> = {
  'not-installed': 'Codex não encontrado neste computador.',
  'not-logged-in': 'O Codex pede login. Abra o Codex num terminal e entre.',
  'no-data': 'O Codex ainda não registrou o limite. Ele aparece depois da primeira resposta.',
  'no-limits': 'Esta conta do Codex não tem limite de uso por janela.',
  failed: 'Não foi possível ler os limites agora.',
};

/** Texto do problema de leitura de um programa. */
export function problemText(provider: LimitProviderId, problem: LimitProblem): string {
  return (provider === 'codex' ? CODEX_PROBLEM_TEXT : LIMIT_PROBLEM_TEXT)[problem];
}

export const LIMIT_EXPIRED_TEXT = 'Janela renovada · aguardando nova leitura';

const CODEX_EXPIRED_TEXT =
  'Janela renovada. O número novo aparece depois da próxima resposta do Codex.';

/** Texto da janela cujo `resetsAt` já passou: o percentual guardado não vale mais. */
export function expiredText(provider: LimitProviderId): string {
  return provider === 'codex' ? CODEX_EXPIRED_TEXT : LIMIT_EXPIRED_TEXT;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * Rótulo da janela: o do programa para o `id` que ele conhece ("Sessão atual", "Mensal"...); para outro `id` com
 * duração informada, "Janela de 8 h" ou "Janela de 14 dias"; sem nada disso, o próprio `id`.
 */
export function windowLabel(
  id: string,
  provider: LimitProviderId = 'claude',
  durationMinutes?: number,
): string {
  const known = WINDOW_LABELS[provider][id];
  if (known !== undefined) return known;
  if (durationMinutes === undefined || durationMinutes <= 0) return id;
  if (durationMinutes < 60 || (durationMinutes < 24 * 60 && durationMinutes % 60 !== 0)) {
    return `Janela de ${durationMinutes} min`;
  }
  if (durationMinutes < 24 * 60) return `Janela de ${durationMinutes / 60} h`;
  const days = Math.round(durationMinutes / (24 * 60));
  return days === 1 ? 'Janela de 1 dia' : `Janela de ${days} dias`;
}

/** Hora local "HH:MM" de um instante ISO; vazio se o instante for inválido. */
export function formatClock(iso: string): string {
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? '' : TIME_FORMAT.format(moment);
}

/** "HH:MM" se o instante é de hoje (hora local); senão "DD/MM às HH:MM", para a leitura velha não parecer de hoje. */
export function formatSeenAt(iso: string, now: Date): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '';
  const clock = TIME_FORMAT.format(moment);
  return moment.toDateString() === now.toDateString()
    ? `às ${clock}`
    : `em ${DATE_FORMAT.format(moment)} às ${clock}`;
}

/** A janela já renovou: o `resetsAt` passou (ou é ilegível), então o percentual guardado não vale mais. */
export function isWindowExpired(window: Pick<LimitWindowDto, 'resetsAt'>, now: Date): boolean {
  const reset = new Date(window.resetsAt).getTime();
  return Number.isNaN(reset) || reset <= now.getTime();
}

/** A partir de quantos dias o dia da semana sozinho confunde com o da semana corrente: aí entra a data. */
const DATE_FROM_DAYS = 6;

/**
 * Quando a janela renova, no fuso local: "Renova às 20:49" nas próximas 24 horas; mais longe, o dia da
 * semana abreviado e a hora ("Renova qui, 05:59"); a 6 dias ou mais, também a data ("Renova sex, 28/11, 05:59").
 * Vazio se o instante for inválido.
 */
export function formatRenewal(resetsAt: string, now: Date): string {
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return '';
  const time = TIME_FORMAT.format(reset);
  const left = reset.getTime() - now.getTime();
  if (left <= DAY_MS) return `Renova às ${time}`;
  const weekday = WEEKDAY_FORMAT.format(reset).replace('.', '');
  if (left >= DATE_FROM_DAYS * DAY_MS) {
    return `Renova ${weekday}, ${DATE_FORMAT.format(reset)}, ${time}`;
  }
  return `Renova ${weekday}, ${time}`;
}

/** Percentual usado, inteiro e preso entre 0 e 100. */
export function usedPercent(window: Pick<LimitWindowDto, 'usedPercent'>): number {
  return Math.min(100, Math.max(0, Math.round(window.usedPercent)));
}

/** Percentual restante: 100 menos o usado. */
export function remainingPercent(window: Pick<LimitWindowDto, 'usedPercent'>): number {
  return 100 - usedPercent(window);
}

/** "16% usado · 84% restante". */
export function usageText(window: Pick<LimitWindowDto, 'usedPercent'>): string {
  return `${usedPercent(window)}% usado · ${remainingPercent(window)}% restante`;
}

/** A partir deste percentual usado a barra avisa (âmbar). Até 74% ela é neutra. */
export const LIMIT_WARN_FROM = 75;
/** Acima deste percentual usado a barra fica crítica (vermelha). Em 90% exato ainda é aviso. */
export const LIMIT_CRITICAL_ABOVE = 90;

/** Nível da barra de uso: neutra, aviso (âmbar) ou crítica (vermelha). */
export type LimitLevel = 'normal' | 'aviso' | 'critico';

/**
 * Nível da barra pelo percentual usado já arredondado (o mesmo número que aparece na tela):
 * "normal" abaixo de 75, "aviso" de 75 a 90 (os dois inclusive) e "critico" acima de 90.
 */
export function limitLevel(window: Pick<LimitWindowDto, 'usedPercent'>): LimitLevel {
  const used = usedPercent(window);
  if (used > LIMIT_CRITICAL_ABOVE) return 'critico';
  if (used >= LIMIT_WARN_FROM) return 'aviso';
  return 'normal';
}

/** Rótulo curto das janelas que a barra de status resume; as outras só aparecem no painel. */
const SHORT_WINDOW_LABELS: Record<LimitProviderId, Record<string, string>> = {
  claude: { five_hour: '5h', seven_day: 'sem' },
  codex: { five_hour: '5h', seven_day: 'sem', thirty_day: 'mês' },
};

/** Rótulo curto da janela para a barra de status ("5h", "sem", "mês"); `undefined` para a janela que ela não resume. */
export function shortWindowLabel(
  id: string,
  provider: LimitProviderId = 'claude',
): string | undefined {
  return SHORT_WINDOW_LABELS[provider][id];
}

/** A janela esgotou: o percentual que a tela mostra chegou a 100. */
export function isWindowExhausted(window: Pick<LimitWindowDto, 'usedPercent'>): boolean {
  return usedPercent(window) >= 100;
}

/**
 * Quando a janela esgotada volta: "Esgotada · volta às 20:49" nas próximas 24 horas; mais longe, o dia da semana
 * ("Esgotada · volta sex, 05:59"). Só "Esgotada" se o instante for inválido.
 */
export function formatReturn(resetsAt: string, now: Date): string {
  const renewal = formatRenewal(resetsAt, now);
  return renewal === '' ? 'Esgotada' : `Esgotada · ${renewal.replace('Renova', 'volta')}`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Quanto falta até a renovação: "6h 49min", "1d 15h", "12min" ou "menos de 1min". Mostra as duas maiores unidades e
 * omite a que deu zero. Vazio se o instante já passou ou for inválido.
 */
export function formatCountdown(resetsAt: string, now: Date): string {
  const left = new Date(resetsAt).getTime() - now.getTime();
  if (Number.isNaN(left) || left <= 0) return '';
  if (left < MINUTE_MS) return 'menos de 1min';
  const total = Math.floor(left / MINUTE_MS);
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  const minutes = total % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
  return `${minutes}min`;
}

/** Duração das janelas que o app conhece. Sem ela não dá para saber quando a janela começou. */
const WINDOW_DURATION_MS: Record<string, number> = {
  five_hour: 5 * HOUR_MS,
  seven_day: 7 * DAY_MS,
};

/**
 * Quanto dura a janela, só para ordenar: a duração informada pelo programa, ou a da tabela do app (a mensal inclusa).
 * `Infinity` para a janela de duração desconhecida, que fica depois das outras.
 */
export function windowDurationMs(
  window: Pick<LimitWindowDto, 'id'> & Partial<Pick<LimitWindowDto, 'durationMinutes'>>,
): number {
  if (window.durationMinutes !== undefined) return window.durationMinutes * MINUTE_MS;
  return WINDOW_DURATION_MS[window.id] ?? (window.id === 'thirty_day' ? 30 * DAY_MS : Infinity);
}

/**
 * Quanto do tempo da janela já passou, de 0 a 100, contando do começo (a renovação menos a duração) até agora.
 * A duração informada pelo programa (`durationMinutes`) vale mais que a tabela do app.
 * `undefined` para janela de duração desconhecida, já renovada, com instante inválido ou com a renovação mais longe
 * que a própria duração (dado que não fecha).
 */
export function windowElapsedPercent(
  window: Pick<LimitWindowDto, 'id' | 'resetsAt'> &
    Partial<Pick<LimitWindowDto, 'durationMinutes'>>,
  now: Date,
): number | undefined {
  const duration =
    window.durationMinutes === undefined
      ? WINDOW_DURATION_MS[window.id]
      : window.durationMinutes * MINUTE_MS;
  if (duration === undefined) return undefined;
  const left = new Date(window.resetsAt).getTime() - now.getTime();
  if (Number.isNaN(left) || left <= 0 || left > duration) return undefined;
  return Math.round(((duration - left) / duration) * 100);
}

/**
 * Há quanto tempo foi a leitura: "Lido agora", "Lido há 2 min", "Lido há 2 h" ou "Lido há 2 d" (no Codex, "Visto":
 * o dado é o da última resposta dele). Vazio se inválido.
 */
export function formatAge(
  capturedAt: string,
  now: Date,
  provider: LimitProviderId = 'claude',
): string {
  const age = now.getTime() - new Date(capturedAt).getTime();
  if (Number.isNaN(age)) return '';
  const verb = provider === 'codex' ? 'Visto' : 'Lido';
  if (age < MINUTE_MS) return `${verb} agora`;
  if (age < HOUR_MS) return `${verb} há ${Math.floor(age / MINUTE_MS)} min`;
  if (age < DAY_MS) return `${verb} há ${Math.floor(age / HOUR_MS)} h`;
  return `${verb} há ${Math.floor(age / DAY_MS)} d`;
}

/**
 * Dias inteiros até a renovação, para o rodapé: "3d", "1d" e, com menos de um dia, "<1d". Vazio se o instante já
 * passou ou for inválido.
 */
export function formatDaysLeft(resetsAt: string, now: Date): string {
  const left = new Date(resetsAt).getTime() - now.getTime();
  if (Number.isNaN(left) || left <= 0) return '';
  const days = Math.floor(left / DAY_MS);
  return days > 0 ? `${days}d` : '<1d';
}
