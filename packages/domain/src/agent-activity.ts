/** Terminal do app, com a pasta do projeto, como a consulta de terminais a entrega. */
export type AppTerminal = {
  /** Id do provedor (`claude`, `codex`, `antigravity`). */
  provider: string;
  /** Pasta do projeto do terminal. */
  folder: string;
  createdAt: string;
  /** Sem ele, o terminal ainda está aberto e vale até o instante de agora. */
  closedAt?: string;
};

/** Um dia de uma sessão de CLI. `tokens` é `null` quando o agente não informa tokens. */
type SessionDay = { date: string; messages: number; tokens: number | null };

/**
 * Sessão de CLI na forma que o domínio liga ao app. É a mesma forma de `SessionActivity` dos leitores
 * de `agent-adapters`; o domínio não importa esse pacote, então o tipo fica aqui.
 */
export type SessionForLink = {
  agent: string;
  cwd: string;
  startedAt: string;
  days: SessionDay[];
};

/** Tokens de uma execução de missão. Entram no agente `claude`, no dia local do término. */
export type MissionTokens = { finishedAt: string; tokens: number };

/** Uma linha de `sumByDay`: o agente e o dia, com mensagens e tokens somados. */
export type AgentDayTotal = {
  date: string;
  agent: string;
  messages: number;
  tokens: number | null;
};

/** Folga antes da criação do terminal em que a sessão ainda conta como dele: 60 s. */
const LINK_SLACK_MS = 60_000;

/** Pasta em forma comparável: barras para `/`, sem barra final e, se pedido, em minúsculas. */
function normalizeFolder(path: string, caseInsensitive: boolean): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseInsensitive ? slashed.toLowerCase() : slashed;
}

/** A pasta da sessão é a do terminal ou uma subpasta dela: `proj/xy` não casa com `proj/x`. */
function isInside(cwd: string, folder: string): boolean {
  return cwd === folder || cwd.startsWith(`${folder}/`);
}

/** Dia local `AAAA-MM-DD` de um instante ISO. */
function localDate(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Soma de tokens em que `null` é a falta de dado: só fica `null` quando as duas parcelas faltam. */
function sumTokens(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/**
 * Devolve só as sessões que se ligam a um terminal do app: mesmo agente, pasta igual à do terminal ou
 * subpasta dela, e horário entre 60 s antes da criação do terminal e o fechamento (ou `nowIso`, se ainda
 * estiver aberto). As pastas se comparam normalizadas; no Windows a comparação ignora maiúsculas, por
 * isso `caseInsensitive` vem verdadeiro por padrão.
 */
export function linkToApp(
  sessions: SessionForLink[],
  terminals: AppTerminal[],
  nowIso: string,
  caseInsensitive = true,
): SessionForLink[] {
  const spans = terminals.map((terminal) => ({
    provider: terminal.provider,
    folder: normalizeFolder(terminal.folder, caseInsensitive),
    from: Date.parse(terminal.createdAt) - LINK_SLACK_MS,
    to: Date.parse(terminal.closedAt ?? nowIso),
  }));
  return sessions.filter((session) => {
    const cwd = normalizeFolder(session.cwd, caseInsensitive);
    const startedAt = Date.parse(session.startedAt);
    return spans.some(
      (span) =>
        span.provider === session.agent &&
        isInside(cwd, span.folder) &&
        startedAt >= span.from &&
        startedAt <= span.to,
    );
  });
}

/**
 * Soma mensagens e tokens por `(dia, agente)`. Os tokens de missão entram no agente `claude`, no dia
 * local do término, sem somar mensagens. Um dia só fica sem tokens quando todas as parcelas do agente
 * naquele dia são `null`. A saída vem ordenada por data e agente.
 */
export function sumByDay(sessions: SessionForLink[], missions: MissionTokens[]): AgentDayTotal[] {
  const totals = new Map<string, AgentDayTotal>();
  const add = (date: string, agent: string, messages: number, tokens: number | null): void => {
    const key = JSON.stringify([date, agent]);
    const current = totals.get(key);
    if (current === undefined) {
      totals.set(key, { date, agent, messages, tokens });
      return;
    }
    current.messages += messages;
    current.tokens = sumTokens(current.tokens, tokens);
  };
  for (const session of sessions) {
    for (const day of session.days) {
      add(day.date, session.agent, day.messages, day.tokens);
    }
  }
  for (const mission of missions) {
    add(localDate(mission.finishedAt), 'claude', 0, mission.tokens);
  }
  return [...totals.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.agent.localeCompare(b.agent),
  );
}
