// Só tipos do contrato: o barrel dos contratos puxaria o zod para o bundle do renderer.
import type { AgentActivity, AgentActivityDay } from '@project-hub/contracts';

/** Métrica do mapa: mensagens enviadas ou tokens (entrada nova mais saída). */
export type Metric = 'messages' | 'tokens';
/** Período do bloco: tudo, ou os últimos 7, 30 ou 90 dias. */
export type Period = 'all' | 7 | 30 | 90;
/** Agente filtrado: `'all'` para todos, ou o id de um agente. */
export type AgentFilter = 'all' | string;

/** Uma célula do mapa. `value` é `null` quando a métrica não existe para o filtro; `color` é o id do agente. */
export type DayCell = {
  date: string;
  value: number | null;
  level: 0 | 1 | 2 | 3 | 4;
  color: string | null;
};

export type OverviewStats = {
  messages: number | null;
  tokens: number | null;
  tokensPartial: boolean;
  streak: number;
  busiestWeekday: number | null;
  topAgent: string | null;
};

/** Dia local como `AAAA-MM-DD`, o mesmo agrupamento que o processo principal faz. */
function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Lê `AAAA-MM-DD` como data local (meio-dia não é preciso: só o calendário importa). */
function parseKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/**
 * Dias locais `AAAA-MM-DD` do período, do mais antigo ao de hoje. Conta pelo calendário, não em 24 h
 * fixas. `'all'` começa em `since` (o registro mais antigo do app); sem `since`, ou com `since` depois de
 * hoje, é só hoje.
 */
export function windowOf(period: Period, today: Date, since: string | null): string[] {
  const todayKey = dateKey(today);
  if (period === 'all') {
    if (since === null || since >= todayKey) return [todayKey];
    const days: string[] = [];
    const first = parseKey(since);
    for (let offset = 0; ; offset += 1) {
      const key = dateKey(
        new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset),
      );
      days.push(key);
      if (key >= todayKey) break;
    }
    return days;
  }
  return Array.from({ length: period }, (_, index) =>
    dateKey(
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period - 1 - index)),
    ),
  );
}

/** As linhas da resposta que valem para o filtro de agente. */
function rowsFor(data: AgentActivity, agent: AgentFilter): AgentActivityDay[] {
  return agent === 'all' ? data.days : data.days.filter((row) => row.agent === agent);
}

function byDate(rows: AgentActivityDay[]): Map<string, AgentActivityDay[]> {
  const grouped = new Map<string, AgentActivityDay[]>();
  for (const row of rows) {
    const list = grouped.get(row.date);
    if (list) list.push(row);
    else grouped.set(row.date, [row]);
  }
  return grouped;
}

/** Posição do agente na lista de `agents`; agente desconhecido vai para o fim. */
function orderOf(data: AgentActivity, id: string): number {
  const index = data.agents.findIndex((agent) => agent.id === id);
  return index === -1 ? data.agents.length : index;
}

/** A métrica existe para o filtro? Agente filtrado sem a métrica no registro dá `false`. */
function metricAvailable(data: AgentActivity, metric: Metric, agent: AgentFilter): boolean {
  if (agent === 'all') return true;
  const found = data.agents.find((item) => item.id === agent);
  if (!found) return true;
  return metric === 'messages' ? found.messagesAvailable : found.tokensAvailable;
}

/**
 * Soma e dominante de um dia. A soma só junta quem tem dado: `null` se todas as linhas do dia vêm sem a
 * métrica (falta de dado nunca vira zero); dia sem linha nenhuma vale 0. O dominante é o agente de maior
 * valor, e no empate o primeiro na ordem de `agents`.
 */
function dayValue(
  data: AgentActivity,
  rows: AgentActivityDay[],
  metric: Metric,
): { value: number | null; color: string | null } {
  if (rows.length === 0) return { value: 0, color: null };
  let total: number | null = null;
  let best: { agent: string; value: number } | null = null;
  for (const row of rows) {
    const amount = row[metric];
    if (amount === null) continue;
    total = (total ?? 0) + amount;
    if (
      amount > 0 &&
      (best === null ||
        amount > best.value ||
        (amount === best.value && orderOf(data, row.agent) < orderOf(data, best.agent)))
    ) {
      best = { agent: row.agent, value: amount };
    }
  }
  return { value: total, color: best?.agent ?? null };
}

/**
 * Uma célula por dia de `days`. `value` é a soma do filtro (ou de todos com dado). `level` vai de 0 a 4
 * pela fração do maior dia do período (até 25% é 1, até 50% é 2, até 75% é 3, acima disso é 4); dia sem
 * valor ou zerado é 0. `color` é o agente dominante do dia, `null` sem valor.
 */
export function dayCells(
  data: AgentActivity,
  days: string[],
  metric: Metric,
  agent: AgentFilter,
): DayCell[] {
  const unavailable = !metricAvailable(data, metric, agent);
  const grouped = byDate(rowsFor(data, agent));
  const values = days.map((date) =>
    unavailable ? { value: null, color: null } : dayValue(data, grouped.get(date) ?? [], metric),
  );
  const max = Math.max(0, ...values.map(({ value }) => value ?? 0));
  return days.map((date, index) => {
    const { value, color } = values[index] ?? { value: null, color: null };
    const level =
      value === null || value <= 0 || max === 0
        ? 0
        : Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
    return { date, value, level: level as DayCell['level'], color: value ? color : null };
  });
}

/** Soma de uma métrica numa lista de linhas; `null` quando nenhuma linha tem a métrica. */
function sumOf(rows: AgentActivityDay[], metric: Metric): number | null {
  let total: number | null = null;
  for (const row of rows) {
    const amount = row[metric];
    if (amount !== null) total = (total ?? 0) + amount;
  }
  return total;
}

/**
 * Totais do período: mensagens, tokens, sequência atual, dia da semana mais ativo e agente mais usado.
 * `tokensPartial` vale com "Todos" quando algum agente com mensagens no período não tem tokens (a tela
 * avisa "sem Antigravity"). `tokens` é `null` quando o filtro não tem tokens. A sequência conta os dias
 * seguidos com mensagem até hoje (o último de `days`), sem se limitar à janela. `busiestWeekday` vai de
 * 0 (domingo) a 6 (sábado).
 */
export function overviewStats(
  data: AgentActivity,
  days: string[],
  agent: AgentFilter,
): OverviewStats {
  const inWindow = new Set(days);
  const rows = rowsFor(data, agent).filter((row) => inWindow.has(row.date));

  const messages = metricAvailable(data, 'messages', agent) ? (sumOf(rows, 'messages') ?? 0) : null;
  // Com leitor de tokens e sem uso no período, o total é zero: "indisponível" fica para quem não tem leitor.
  const tokens = metricAvailable(data, 'tokens', agent) ? (sumOf(rows, 'tokens') ?? 0) : null;

  let tokensPartial = false;
  if (agent === 'all') {
    for (const item of data.agents) {
      const own = rows.filter((row) => row.agent === item.id);
      const hasMessages = (sumOf(own, 'messages') ?? 0) > 0;
      if (hasMessages && (!item.tokensAvailable || sumOf(own, 'tokens') === null)) {
        tokensPartial = true;
      }
    }
  }

  // Sequência: do último dia da janela (hoje) para trás, enquanto houver mensagem.
  const withMessages = new Set(
    rowsFor(data, agent)
      .filter((row) => (row.messages ?? 0) > 0)
      .map((row) => row.date),
  );
  let streak = 0;
  const last = days[days.length - 1];
  if (last !== undefined) {
    const start = parseKey(last);
    for (let offset = 0; ; offset += 1) {
      const key = dateKey(
        new Date(start.getFullYear(), start.getMonth(), start.getDate() - offset),
      );
      if (!withMessages.has(key)) break;
      streak += 1;
    }
  }

  const perWeekday = Array.from({ length: 7 }, () => 0);
  for (const row of rows) {
    const weekday = parseKey(row.date).getDay();
    perWeekday[weekday] = (perWeekday[weekday] ?? 0) + (row.messages ?? 0);
  }
  const peak = Math.max(...perWeekday);
  const busiestWeekday = peak > 0 ? perWeekday.indexOf(peak) : null;

  const perAgent = new Map<string, number>();
  for (const row of rows) {
    perAgent.set(row.agent, (perAgent.get(row.agent) ?? 0) + (row.messages ?? 0));
  }
  let topAgent: string | null = null;
  let topValue = 0;
  for (const [id, value] of [...perAgent].sort(
    (a, b) => orderOf(data, a[0]) - orderOf(data, b[0]),
  )) {
    if (value > topValue) {
      topAgent = id;
      topValue = value;
    }
  }

  return { messages, tokens, tokensPartial, streak, busiestWeekday, topAgent };
}

const ONE_DECIMAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/**
 * Número curto para a tela: abaixo de mil, inteiro; depois, uma casa em `k` ou `M` ("32,5k", "1,2M"). A casa é
 * cortada, não arredondada, para o número curto nunca passar do real. O valor inteiro fica no nome acessível.
 */
export function compactNumber(value: number): string {
  if (value < 1_000) return ONE_DECIMAL.format(value);
  const [unit, size] = value < 1_000_000 ? ['k', 1_000] : ['M', 1_000_000];
  return `${ONE_DECIMAL.format(Math.floor((value / size) * 10) / 10)}${unit}`;
}

/** Uma linha da tabela "Por agente": a soma de cada métrica no período, ou `null` quando o agente não tem leitor dela. */
export type AgentRow = {
  id: string;
  label: string;
  messages: number | null;
  tokens: number | null;
};

/**
 * Uma linha por agente do registro (`data.agents`), na ordem dele, com as mensagens e os tokens dentro de `days`.
 * Agente com leitor da métrica e sem uso no período vale 0; agente sem leitor da métrica vale `null`, para a tela
 * mostrar "indisponível" e nunca um zero que não existe.
 */
export function agentRows(data: AgentActivity, days: string[]): AgentRow[] {
  const inWindow = new Set(days);
  return data.agents.map((item) => {
    const own = data.days.filter((row) => row.agent === item.id && inWindow.has(row.date));
    return {
      id: item.id,
      label: item.label,
      messages: item.messagesAvailable ? (sumOf(own, 'messages') ?? 0) : null,
      tokens: item.tokensAvailable ? (sumOf(own, 'tokens') ?? 0) : null,
    };
  });
}

/**
 * Como os dias ocupam as colunas do mapa (semanas de domingo a sábado): `blanks` são os espaços antes do primeiro
 * dia, na primeira coluna, e `weeks` o número de colunas. O último dia (hoje) pode deixar a última coluna incompleta.
 */
export function weekLayout(days: string[]): { blanks: number; weeks: number } {
  const first = days[0];
  if (first === undefined) return { blanks: 0, weeks: 0 };
  const blanks = parseKey(first).getDay();
  return { blanks, weeks: Math.ceil((blanks + days.length) / 7) };
}

const MONTH_NAME = new Intl.DateTimeFormat('pt-BR', { month: 'short' });

/** "out", sem o ponto que a abreviatura do Intl traz ("out."). */
function monthLabel(date: Date): string {
  return MONTH_NAME.format(date).replace('.', '');
}

/**
 * A régua de meses do mapa: um item por coluna de semana, com o nome do mês na coluna em que o dia 1º cai e
 * `null` nas outras. A primeira coluna leva o mês do primeiro dia, a menos que o próximo mês comece logo na
 * segunda coluna: o texto de um não caberia antes do outro.
 */
export function monthMarks(days: string[]): (string | null)[] {
  const { blanks, weeks } = weekLayout(days);
  const marks: (string | null)[] = Array.from({ length: weeks }, () => null);
  days.forEach((key, index) => {
    const date = parseKey(key);
    if (date.getDate() === 1) marks[Math.floor((index + blanks) / 7)] = monthLabel(date);
  });
  const first = days[0];
  if (first !== undefined) {
    const firstMark = marks.findIndex((mark) => mark !== null);
    if (firstMark === -1 || firstMark >= 2) marks[0] = monthLabel(parseKey(first));
  }
  return marks;
}

/** O tamanho das células do mapa: maior para poucas semanas, menor para muitas, para o mapa caber na coluna dele. */
export type GridSize = 'roomy' | 'normal' | 'tight';

/**
 * Até 6 semanas (7 e 30 dias, que ocupam 2 e 5 ou 6) as células são maiores; de 7 a 26, normais; acima disso,
 * apertadas. O corte de 6 é o do mapa que cabe ao lado da tabela já em 31rem de bloco (ver home.css).
 */
export function gridSize(weeks: number): GridSize {
  if (weeks <= 6) return 'roomy';
  return weeks <= 26 ? 'normal' : 'tight';
}
