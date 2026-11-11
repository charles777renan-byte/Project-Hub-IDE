import type { LimitProblem, LimitWindowDto } from '@project-hub/contracts';

/** Rótulo das janelas que o Início conhece; as outras aparecem pelo próprio `id`. */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: 'Sessão atual',
  seven_day: 'Semanal (todos os modelos)',
};

/** Mensagem fixa de cada problema de leitura. */
export const LIMIT_PROBLEM_TEXT: Record<LimitProblem, string> = {
  'not-installed': 'O Claude Code não foi encontrado.',
  'not-logged-in': 'O Claude Code pede login. Abra o Claude num terminal e entre.',
  'no-limits':
    'Esta conta não tem limite de uso por janela (ela só existe para assinantes Pro e Max).',
  failed: 'Não foi possível ler os limites agora.',
};

export const LIMIT_EXPIRED_TEXT = 'Janela renovada · aguardando nova leitura';

const DAY_MS = 24 * 60 * 60 * 1000;

const TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });

/** Rótulo da janela pelo `id`: "Sessão atual", "Semanal (todos os modelos)" ou o próprio `id`. */
export function windowLabel(id: string): string {
  return WINDOW_LABELS[id] ?? id;
}

/** Hora local "HH:MM" de um instante ISO; vazio se o instante for inválido. */
export function formatClock(iso: string): string {
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? '' : TIME_FORMAT.format(moment);
}

/** A janela já renovou: o `resetsAt` passou (ou é ilegível), então o percentual guardado não vale mais. */
export function isWindowExpired(window: Pick<LimitWindowDto, 'resetsAt'>, now: Date): boolean {
  const reset = new Date(window.resetsAt).getTime();
  return Number.isNaN(reset) || reset <= now.getTime();
}

/**
 * Quando a janela renova, no fuso local: "Renova às 20:49" nas próximas 24 horas; mais longe, o dia da
 * semana abreviado e a hora ("Renova qui, 05:59"). Vazio se o instante for inválido.
 */
export function formatRenewal(resetsAt: string, now: Date): string {
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return '';
  const time = TIME_FORMAT.format(reset);
  if (reset.getTime() - now.getTime() <= DAY_MS) return `Renova às ${time}`;
  const weekday = WEEKDAY_FORMAT.format(reset).replace('.', '');
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
const SHORT_WINDOW_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'sem',
};

/** Rótulo curto da janela para a barra de status ("5h", "sem"); `undefined` para a janela que ela não resume. */
export function shortWindowLabel(id: string): string | undefined {
  return SHORT_WINDOW_LABELS[id];
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
 * Quanto do tempo da janela já passou, de 0 a 100, contando do começo (a renovação menos a duração) até agora.
 * `undefined` para janela de duração desconhecida, já renovada, com instante inválido ou com a renovação mais longe
 * que a própria duração (dado que não fecha).
 */
export function windowElapsedPercent(
  window: Pick<LimitWindowDto, 'id' | 'resetsAt'>,
  now: Date,
): number | undefined {
  const duration = WINDOW_DURATION_MS[window.id];
  if (duration === undefined) return undefined;
  const left = new Date(window.resetsAt).getTime() - now.getTime();
  if (Number.isNaN(left) || left <= 0 || left > duration) return undefined;
  return Math.round(((duration - left) / duration) * 100);
}

/** Há quanto tempo foi a leitura: "Lido agora", "Lido há 2 min", "Lido há 2 h" ou "Lido há 2 d". Vazio se inválido. */
export function formatAge(capturedAt: string, now: Date): string {
  const age = now.getTime() - new Date(capturedAt).getTime();
  if (Number.isNaN(age)) return '';
  if (age < MINUTE_MS) return 'Lido agora';
  if (age < HOUR_MS) return `Lido há ${Math.floor(age / MINUTE_MS)} min`;
  if (age < DAY_MS) return `Lido há ${Math.floor(age / HOUR_MS)} h`;
  return `Lido há ${Math.floor(age / DAY_MS)} d`;
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
