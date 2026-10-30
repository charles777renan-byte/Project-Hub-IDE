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
