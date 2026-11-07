import { useState } from 'react';
import type { SessionSummary } from '@project-hub/contracts';
import { requestResumeSession } from '../../workspaces-events';
import { ArrowLeft, CircleAlert, Copy, ICON_PROPS } from '../Icon';
import { ProviderIcon } from '../ProviderIcon';
import { relativeTime, SESSION_PROVIDER_LABEL, sessionTitle } from './sessions-state';
import { SESSIONS_TEXT } from './sessions-text';

/** Um dado que o programa não grava: o texto "sem dado" no lugar, para a seção não sumir. */
function orNoData(value: string | null) {
  return value === null ? (
    <span className="sessions-tab__nodata">{SESSIONS_TEXT.noData}</span>
  ) : (
    value
  );
}

/**
 * O detalhe de uma sessão, no lugar da lista. Cabeçalho, primeiro prompt (com Copiar), últimos turnos e a
 * retomada. Retomar pede ao workspace do projeto (o evento da janela) e mostra a resposta, se houver erro.
 */
export function SessionDetail({
  session,
  projectId,
  onBack,
}: {
  session: SessionSummary;
  projectId: string | null;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reason =
    projectId === null ? SESSIONS_TEXT.resumeNeedsProject : session.resumeBlockedReason;
  const blocked = projectId === null || !session.resumable;

  function copyPrompt() {
    if (session.firstPrompt === null) return;
    navigator.clipboard
      .writeText(session.firstPrompt)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }

  function resume() {
    if (projectId === null || blocked) return;
    setMessage(null);
    void requestResumeSession(projectId, session.id).then((answer) => setMessage(answer));
  }

  return (
    <div className="sessions-tab__detail">
      <button type="button" className="sessions-tab__back" onClick={onBack}>
        <ArrowLeft {...ICON_PROPS} />
        <span>{SESSIONS_TEXT.back}</span>
      </button>

      <header className="sessions-tab__detail-head">
        <h3 className="sessions-tab__detail-title">{sessionTitle(session)}</h3>
        <p className="sessions-tab__detail-meta">
          <ProviderIcon provider={session.provider} size={14} />
          <span>{SESSION_PROVIDER_LABEL[session.provider]}</span>
          <span>{relativeTime(session.lastActivityAt, Date.now())}</span>
        </p>
        <p className="sessions-tab__folder" title={session.folder}>
          {session.folder}
        </p>
      </header>

      <section className="sessions-tab__section">
        <div className="sessions-tab__section-head">
          <h4>{SESSIONS_TEXT.firstPrompt}</h4>
          {session.firstPrompt === null ? null : (
            <button type="button" className="sessions-tab__copy" onClick={copyPrompt}>
              <Copy {...ICON_PROPS} />
              <span>{copied ? SESSIONS_TEXT.copied : SESSIONS_TEXT.copy}</span>
            </button>
          )}
        </div>
        <p className="sessions-tab__prompt">{orNoData(session.firstPrompt)}</p>
      </section>

      <section className="sessions-tab__section">
        <h4>{SESSIONS_TEXT.lastAgentText}</h4>
        <p className="sessions-tab__prompt">{orNoData(session.lastAgentText)}</p>
      </section>

      <section className="sessions-tab__section">
        <h4>{SESSIONS_TEXT.lastTurns}</h4>
        {session.lastTurns === null ? (
          <p className="sessions-tab__nodata">{SESSIONS_TEXT.noData}</p>
        ) : (
          <ol className="sessions-tab__turns">
            {session.lastTurns.map((turn, index) => (
              <li key={index} className={`sessions-tab__turn sessions-tab__turn--${turn.role}`}>
                <span className="sessions-tab__turn-role">
                  {turn.role === 'user' ? SESSIONS_TEXT.turnUser : SESSIONS_TEXT.turnAgent}
                </span>
                <span className="sessions-tab__turn-text">{turn.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="sessions-tab__resume">
        <button
          type="button"
          className="sessions-tab__resume-button"
          disabled={blocked}
          onClick={resume}
        >
          {SESSIONS_TEXT.resume}
        </button>
        {blocked && reason !== null ? <p className="sessions-tab__reason">{reason}</p> : null}
        {message === null ? null : (
          <p className="sessions-tab__alert" role="alert">
            <CircleAlert {...ICON_PROPS} />
            <span>{message}</span>
          </p>
        )}
      </section>
    </div>
  );
}
