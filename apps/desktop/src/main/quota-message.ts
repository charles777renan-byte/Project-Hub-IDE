import type { LimitsDto } from '@project-hub/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A mensagem da cota do Claude quando alguma janela está em 100% e ainda não renovou; `undefined` se nenhuma
 * está. Usa o último estado dos limites, sem ler de novo: a leitura do uso já traz a hora da renovação.
 * `markedUntil` é a conta marcada como esgotada pela linha de limite do agente: conta como mais uma janela.
 */
export function quotaExhaustedMessage(
  limits: LimitsDto,
  now: Date,
  markedUntil?: string,
): string | undefined {
  const claude = limits.providers.find((provider) => provider.provider === 'claude');
  const resets = (claude?.windows ?? [])
    .filter((window) => window.usedPercent >= 100)
    .map((window) => window.resetsAt);
  if (markedUntil !== undefined) resets.push(markedUntil);
  // Com a sessão e a semana esgotadas, vale a que renova por último: até lá o Claude não responde.
  const latest = resets
    .map((iso) => new Date(iso).getTime())
    .filter((time) => Number.isFinite(time) && time > now.getTime())
    .reduce((later, time) => Math.max(later, time), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(latest)) return undefined;
  return `A cota do Claude acabou. Renova ${renewalText(new Date(latest), now)}. Veja o uso no Início, em Uso do Claude.`;
}

/**
 * A frase da troca automática de conta, para a linha do tempo e o aviso: "Limite da conta Trabalho acabou
 * (renova às 20:10). A missão continuou na conta Pessoal." Sem a hora de renovação, fica sem o parêntese.
 */
export function accountSwitchText(
  input: { fromName: string; toName: string; resetsAt?: string },
  now: Date,
): string {
  const reset = input.resetsAt === undefined ? undefined : new Date(input.resetsAt);
  const renews =
    reset !== undefined && Number.isFinite(reset.getTime())
      ? ` (renova ${renewalText(reset, now)})`
      : '';
  return `Limite da conta ${input.fromName} acabou${renews}. A missão continuou na conta ${input.toName}.`;
}

/** "às 20:49" nas próximas 24 horas; depois, "em 03/11, às 06:00". */
function renewalText(reset: Date, now: Date): string {
  const time = reset.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (reset.getTime() - now.getTime() <= DAY_MS) return `às ${time}`;
  const day = reset.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `em ${day}, às ${time}`;
}
