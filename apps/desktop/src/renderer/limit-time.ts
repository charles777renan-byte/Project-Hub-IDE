/** A hora de renovação do limite de uma conta, para a tela. */

const DAY_MS = 24 * 3_600_000;

function parts(iso: string): { time: string; day: string; date: Date } {
  const date = new Date(iso);
  return {
    date,
    time: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    day: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
  };
}

/** "às 20:10" nas próximas 24 horas; depois, "em 23/11, às 06:00". O mesmo texto do aviso do sistema. */
export function renewalPhrase(iso: string, now: Date): string {
  const { date, time, day } = parts(iso);
  if (date.getTime() - now.getTime() <= DAY_MS) return `às ${time}`;
  return `em ${day}, às ${time}`;
}

/** "20:10" nas próximas 24 horas; depois, "23/11 06:00". Para o estado curto ao lado da conta. */
export function clockOf(iso: string, now: Date): string {
  const { date, time, day } = parts(iso);
  if (date.getTime() - now.getTime() <= DAY_MS) return time;
  return `${day} ${time}`;
}
