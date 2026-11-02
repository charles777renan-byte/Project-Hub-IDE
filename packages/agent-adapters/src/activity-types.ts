/** Uso de um agente num dia local (`AAAA-MM-DD`). `tokens` é `null` quando o agente não informa tokens. */
export type DayUsage = { date: string; messages: number; tokens: number | null };

/** O que um leitor extrai de uma sessão de CLI: onde ela rodou, quando começou e o uso por dia. */
export type SessionActivity = {
  agent: string;
  cwd: string;
  startedAt: string;
  days: DayUsage[];
};

/** Dia local de um instante ISO, no formato `AAAA-MM-DD`. Instante inválido devolve `undefined`. */
export function localDayOf(iso: string | number): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
