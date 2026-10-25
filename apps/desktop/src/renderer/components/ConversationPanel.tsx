import { useState, type FormEvent, type Ref } from 'react';
import type { MissionViewDto } from '@project-hub/contracts';
import { conversationEvents, lastInputPrompt, MISSION_TEXT, situationOf } from '../mission-text';
import { ApprovalCard } from './ApprovalCard';
import { Timeline } from './Timeline';

/**
 * Aba Conversa do workspace da missão (seção 10.7): onde a decisão acontece (os cartões das aprovações
 * pendentes, a caixa de resposta quando o agente pede entrada e a revisão da conclusão, com aprovar ou
 * pedir ajustes) e, abaixo, a história da missão em
 * linguagem simples. O detalhe técnico (ferramentas, worktree, tentativas) fica só nos Logs. O banner
 * "Aguardando você" leva até aqui. As ações chegam por props da página, que é quem chama o processo
 * principal.
 */
export function ConversationPanel({
  view,
  busy,
  onAnswer,
  onDecide,
  onApprove,
  onRequestChanges,
  decisionRef,
  answerRef,
}: {
  view: MissionViewDto;
  busy: boolean;
  /** Devolve `true` quando a resposta foi enviada, para a caixa limpar. */
  onAnswer: (text: string) => Promise<boolean>;
  onDecide: (approvalId: string, decision: 'approved' | 'rejected') => void;
  /** Aprova a conclusão que o agente entregou. */
  onApprove: () => void;
  /** Pede ajustes. Devolve `true` quando o pedido foi aceito, para a caixa limpar. */
  onRequestChanges: (text: string) => Promise<boolean>;
  /** Recebe o foco quando a missão espera a aprovação ou a revisão (o banner e o resumo levam até aqui). */
  decisionRef?: Ref<HTMLElement>;
  /** Recebe o foco quando o agente espera uma resposta: o foco vai direto para a caixa de texto. */
  answerRef?: Ref<HTMLTextAreaElement>;
}) {
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const waitingInput = view.mission.status === 'waiting_input';
  const reviewing = view.mission.status === 'review';
  const prompt = lastInputPrompt(view.events) ?? 'O agente aguarda a sua resposta.';

  async function handleAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = answer.trim();
    if (text === '') return;
    if (await onAnswer(text)) setAnswer('');
  }

  async function handleRequestChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = feedback.trim();
    if (text === '') return;
    if (await onRequestChanges(text)) setFeedback('');
  }

  return (
    <section aria-label="Conversa da missão" className="workspace-panel">
      {reviewing ? (
        <section
          ref={decisionRef}
          tabIndex={-1}
          aria-label="Revisão da conclusão"
          className="mission-focus"
        >
          <p>{situationOf('review')}</p>
          <div className="form-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={onApprove}>
              {MISSION_TEXT.approveReview}
            </button>
          </div>
          <form className="form" aria-label="Pedir ajustes" onSubmit={handleRequestChanges}>
            <div className="field">
              <label htmlFor="mission-feedback">O que ajustar</label>
              <textarea
                id="mission-feedback"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="btn-outline"
                disabled={busy || feedback.trim() === ''}
              >
                {MISSION_TEXT.requestChanges}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {view.pendingApprovals.length === 0 ? null : (
        <section
          ref={decisionRef}
          tabIndex={-1}
          aria-label="Decisões da missão"
          className="mission-focus"
        >
          {view.pendingApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              busy={busy}
              onDecide={(decision) => onDecide(approval.id, decision)}
            />
          ))}
        </section>
      )}

      {waitingInput ? (
        <form className="form" aria-label="Resposta ao agente" onSubmit={handleAnswer}>
          <div className="field">
            <label htmlFor="mission-answer">{prompt}</label>
            <textarea
              id="mission-answer"
              ref={answerRef}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={busy || answer.trim() === ''}>
              Enviar resposta
            </button>
          </div>
        </form>
      ) : null}

      <Timeline events={conversationEvents(view.events)} />
    </section>
  );
}
