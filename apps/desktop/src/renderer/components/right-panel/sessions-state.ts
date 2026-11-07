import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { SessionSummary, SessionsListResult } from '@project-hub/contracts';

/** Quantas sessões a lista mostra de cada vez; "Mostrar mais" soma mais uma página. */
export const SESSIONS_PAGE_SIZE = 100;

export type SessionScope = 'workspace' | 'project' | 'all';

export type IndexingEntry = SessionsListResult['indexing'][number];

/** Nome de cada programa no painel, como o resto do app o chama. */
export const SESSION_PROVIDER_LABEL: Record<SessionSummary['provider'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity CLI',
};

/** Tira acento e caixa, para a busca achar "Sessão" com "sessao". */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();
}

/** O que a busca olha: os campos do resumo (título, prompt, último texto, pasta, branch e modelo), nunca o transcript. */
function searchableFields(session: SessionSummary): string[] {
  return [
    session.title,
    session.firstPrompt,
    session.lastAgentText,
    session.folder,
    session.branch,
    session.model,
  ].filter((field): field is string => field !== null);
}

/** As sessões cujo resumo contém o texto da busca. Busca vazia devolve tudo, na mesma ordem. */
export function filterSessions(
  sessions: readonly SessionSummary[],
  query: string,
): SessionSummary[] {
  const needle = foldText(query.trim());
  if (needle === '') return [...sessions];
  return sessions.filter((session) =>
    searchableFields(session).some((field) => foldText(field).includes(needle)),
  );
}

/** O contador do cabeçalho: "N de M sessões" com busca; "M sessões" sem. */
export function countText(shown: number, total: number, filtering: boolean): string {
  const noun = total === 1 ? 'sessão' : 'sessões';
  if (filtering) return `${shown} de ${total} ${noun}`;
  return `${total} ${noun}`;
}

export type SessionGroup = { key: string; label: string; sessions: SessionSummary[] };

/** Agrupa pela pasta de origem, na ordem em que as sessões chegam (a mais recente primeiro). */
export function groupByFolder(sessions: readonly SessionSummary[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const group = groups.get(session.folder);
    if (group === undefined) {
      groups.set(session.folder, {
        key: session.folder,
        label: session.folder,
        sessions: [session],
      });
    } else {
      group.sessions.push(session);
    }
  }
  return [...groups.values()];
}

/** Os primeiros `shown` itens e se sobra mais. */
export function pageOf<T>(items: readonly T[], shown: number): { items: T[]; hasMore: boolean } {
  return { items: items.slice(0, shown), hasMore: items.length > shown };
}

/** Soma da faixa de indexação, por programa somado. */
export function indexingTotals(indexing: readonly IndexingEntry[]): {
  read: number;
  total: number;
  unreadable: number;
  done: boolean;
} {
  const sums = indexing.reduce(
    (sum, entry) => ({
      read: sum.read + entry.read,
      total: sum.total + entry.total,
      unreadable: sum.unreadable + entry.unreadable,
    }),
    { read: 0, total: 0, unreadable: 0 },
  );
  // Terminado quando cada programa já tem todos os arquivos lidos ou marcados como ilegíveis.
  const done = indexing.every((entry) => entry.read + entry.unreadable >= entry.total);
  return { ...sums, done };
}

/** "agora", "há 11 min", "há 3 h", "há 2 d" e, depois de 30 dias, a data. Vazio só se a data não existe. */
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} d`;
  return format(new Date(then), 'dd/MM/yyyy', { locale: ptBR });
}

/** O nome que o cartão mostra: o título do programa, ou o primeiro prompt, ou um texto de reserva. */
export function sessionTitle(session: SessionSummary): string {
  return session.title ?? session.firstPrompt ?? 'Sessão sem título';
}
