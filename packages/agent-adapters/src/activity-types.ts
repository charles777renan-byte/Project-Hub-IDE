/** Uso de um agente num dia local (`AAAA-MM-DD`). `tokens` é `null` quando o agente não informa tokens. */
export type DayUsage = { date: string; messages: number; tokens: number | null };

/** Um turno da conversa mostrado no detalhe: quem falou e o texto (já cortado). */
export type SessionTurn = { role: 'user' | 'agent'; text: string };

/**
 * O detalhe de uma sessão para a aba Sessões. Cada campo é `null` quando o programa não entrega o dado:
 * `null` é "sem dado", nunca zero, salvo `subagents`: no Codex e no Antigravity o spec manda zero, porque
 * o formato deles não grava subagentes.
 */
export type SessionDetail = {
  title: string | null;
  firstPrompt: string | null;
  lastAgentText: string | null;
  lastTurns: SessionTurn[] | null;
  model: string | null;
  subagents: number | null;
  messages: number;
};

/**
 * O que um leitor extrai de uma sessão de CLI: o id que o programa usa para retomar, onde ela rodou,
 * quando começou e quando foi a última atividade, o uso por dia e, para a aba Sessões, o detalhe.
 */
export type SessionActivity = {
  id: string;
  agent: string;
  cwd: string;
  startedAt: string;
  lastActivityAt: string;
  days: DayUsage[];
  detail?: SessionDetail;
};

/** Dia local de um instante ISO, no formato `AAAA-MM-DD`. Instante inválido devolve `undefined`. */
export function localDayOf(iso: string | number): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
