import type { LimitsDto } from '@project-hub/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A mensagem da cota do Claude quando alguma janela está em 100% e ainda não renovou; `undefined` se nenhuma
 * está. Usa o último estado dos limites, sem ler de novo: a leitura do uso já traz a hora da renovação.
 */
export function quotaExhaustedMessage(limits: LimitsDto, now: Date): string | undefined {
  const claude = limits.providers.find((provider) => provider.provider === 'claude');
  if (claude === undefined) return undefined;
  const waiting = claude.windows.filter(
    (window) => window.usedPercent >= 100 && new Date(window.resetsAt).getTime() > now.getTime(),
  );
  if (waiting.length === 0) return undefined;
  // Com a sessão e a semana esgotadas, vale a que renova por último: até lá o Claude não responde.
  const latest = waiting.reduce((later, window) =>
    new Date(window.resetsAt).getTime() > new Date(later.resetsAt).getTime() ? window : later,
  );
  return `A cota do Claude acabou. Renova ${renewalText(new Date(latest.resetsAt), now)}. Veja o uso no Início, em Uso do Claude.`;
}

/** "às 20:49" nas próximas 24 horas; depois, "em 03/11, às 06:00". */
function renewalText(reset: Date, now: Date): string {
  const time = reset.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (reset.getTime() - now.getTime() <= DAY_MS) return `às ${time}`;
  const day = reset.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `em ${day}, às ${time}`;
}
