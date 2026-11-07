import type { SessionSummary } from '@project-hub/contracts';
import { ProviderIcon } from '../ProviderIcon';
import { GitBranch, ICON_PROPS } from '../Icon';
import { relativeTime, SESSION_PROVIDER_LABEL, sessionTitle } from './sessions-state';
import { SESSIONS_TEXT } from './sessions-text';

/**
 * Um cartão da lista: o nome da sessão, a última fala do agente em duas linhas e, embaixo, o programa, as
 * contagens, o modelo e o branch quando é worktree. Todo texto entra como filho de texto do React.
 */
export function SessionCard({ session, onOpen }: { session: SessionSummary; onOpen: () => void }) {
  const lastAgent = session.lastAgentText;
  return (
    <li className="sessions-tab__card">
      <button type="button" className="sessions-tab__card-open" onClick={onOpen}>
        <span className="sessions-tab__card-head">
          <ProviderIcon provider={session.provider} size={14} />
          <span className="sessions-tab__card-title">{sessionTitle(session)}</span>
          <span className="sessions-tab__card-time">
            {relativeTime(session.lastActivityAt, Date.now())}
          </span>
        </span>
        {lastAgent === null ? null : <span className="sessions-tab__card-last">{lastAgent}</span>}
        <span className="sessions-tab__card-meta">
          <span>{SESSION_PROVIDER_LABEL[session.provider]}</span>
          {session.messages === null ? null : (
            <span>{SESSIONS_TEXT.messages(session.messages)}</span>
          )}
          {session.subagents === null || session.subagents === 0 ? null : (
            <span>{SESSIONS_TEXT.subagents(session.subagents)}</span>
          )}
          {session.model === null ? null : <span>{session.model}</span>}
          {!session.isWorktree || session.branch === null ? null : (
            <span className="sessions-tab__chip">
              <GitBranch {...ICON_PROPS} />
              {session.branch}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
