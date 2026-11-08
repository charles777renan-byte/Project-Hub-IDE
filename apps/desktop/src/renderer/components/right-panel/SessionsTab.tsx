import { useState } from 'react';
import type { SessionSummary } from '@project-hub/contracts';
import { CircleAlert, History, ICON_PROPS, Search } from '../Icon';
import { EmptyState } from '../EmptyState';
import { IndexingStrip } from './IndexingStrip';
import { SessionCard } from './SessionCard';
import { SessionDetail } from './SessionDetail';
import {
  countText,
  filterSessions,
  groupByFolder,
  pageOf,
  SESSIONS_PAGE_SIZE,
  type SessionScope,
} from './sessions-state';
import { SESSIONS_TEXT } from './sessions-text';
import { useSessions } from './use-sessions';

const SCOPES: readonly SessionScope[] = ['workspace', 'project', 'all'];

/**
 * A aba Sessões: o histórico dos programas de agente, com escopo, busca, a faixa de leitura e os cartões agrupados
 * por pasta. Um cartão abre o detalhe no lugar da lista. Sem projeto aberto, só o escopo Todos funciona.
 * A lista não é virtualizada ainda; por isso mostra uma página de cada vez, com "Mostrar mais".
 */
export function SessionsTab({ projectId }: { projectId: string | null }) {
  const [chosen, setChosen] = useState<SessionScope>('workspace');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(SESSIONS_PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  // Sem projeto, o único escopo que vale é Todos.
  const scope: SessionScope = projectId === null ? 'all' : chosen;
  const { state, refresh } = useSessions(scope, projectId);

  function chooseScope(next: SessionScope) {
    setChosen(next);
    setShown(SESSIONS_PAGE_SIZE);
  }

  function changeQuery(next: string) {
    setQuery(next);
    setShown(SESSIONS_PAGE_SIZE);
  }

  if (state.status === 'loading') {
    return (
      <div className="sessions-tab">
        <p className="sessions-tab__status" role="status">
          {SESSIONS_TEXT.loading}
        </p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="sessions-tab">
        <p className="sessions-tab__alert" role="alert">
          <CircleAlert {...ICON_PROPS} />
          <span>{state.message}</span>
        </p>
        <button type="button" className="sessions-tab__retry" onClick={refresh}>
          {SESSIONS_TEXT.retry}
        </button>
      </div>
    );
  }

  const { sessions, indexing } = state.data;
  const opened = openId === null ? undefined : sessions.find((item) => item.id === openId);
  if (opened !== undefined) {
    return (
      <div className="sessions-tab">
        <SessionDetail session={opened} projectId={projectId} onBack={() => setOpenId(null)} />
      </div>
    );
  }

  const filtering = query.trim() !== '';
  const matches: SessionSummary[] = filterSessions(sessions, query);
  const page = pageOf(matches, shown);
  const groups = groupByFolder(page.items);

  return (
    <div className="sessions-tab">
      <div className="sessions-tab__header">
        <div className="sessions-tab__scope" role="group" aria-label={SESSIONS_TEXT.scopeGroup}>
          {SCOPES.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={scope === id}
              disabled={projectId === null && id !== 'all'}
              className="sessions-tab__scope-button"
              onClick={() => chooseScope(id)}
            >
              {SESSIONS_TEXT.scope[id]}
            </button>
          ))}
        </div>
        <button type="button" className="sessions-tab__refresh" onClick={refresh}>
          {SESSIONS_TEXT.refresh}
        </button>
      </div>

      <div className="sessions-tab__search">
        <label className="sessions-tab__field">
          <Search {...ICON_PROPS} />
          <input
            type="search"
            aria-label={SESSIONS_TEXT.search}
            placeholder={SESSIONS_TEXT.searchPlaceholder}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
        </label>
        <p className="sessions-tab__count">
          {countText(matches.length, sessions.length, filtering)}
        </p>
      </div>

      <IndexingStrip indexing={indexing} />

      {sessions.length === 0 ? (
        <EmptyState icon={History} title={SESSIONS_TEXT.empty} hint={SESSIONS_TEXT.emptyHint} />
      ) : matches.length === 0 ? (
        <p className="sessions-tab__status">{SESSIONS_TEXT.noMatch}</p>
      ) : (
        <div className="sessions-tab__body">
          {groups.map((group) => (
            <section key={group.key} className="sessions-tab__group">
              <h3 className="sessions-tab__group-title" title={group.label}>
                {group.label}
              </h3>
              <ul className="sessions-tab__list">
                {group.sessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onOpen={() => setOpenId(session.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {page.hasMore ? (
            <button
              type="button"
              className="sessions-tab__more"
              onClick={() => setShown(shown + SESSIONS_PAGE_SIZE)}
            >
              {SESSIONS_TEXT.showMore}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
