import { useState, type FormEvent } from 'react';
import type { MissionViewDto } from '@project-hub/contracts';
import { lastInputPrompt } from '../mission-text';
import { Timeline } from './Timeline';

/**
 * Painel Conversa do workspace da missão (seção 10.7): a caixa de resposta quando o agente pede
 * entrada, e a linha do tempo dos eventos. As aprovações pendentes não aparecem aqui: a decisão fica
 * na coluna "Aguardando você" (DecisionColumn), e a Conversa guarda só o histórico.
 */
export function ConversationPanel({
  view,
  busy,
  onAnswer,
}: {
  view: MissionViewDto;
  busy: boolean;
  /** Devolve `true` quando a resposta foi enviada, para a caixa limpar. */
  onAnswer: (text: string) => Promise<boolean>;
}) {
  const [answer, setAnswer] = useState('');
  const waitingInput = view.mission.status === 'waiting_input';
  const prompt = lastInputPrompt(view.events) ?? 'O agente aguarda a sua resposta.';

  async function handleAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = answer.trim();
    if (text === '') return;
    if (await onAnswer(text)) setAnswer('');
  }

  return (
    <section aria-label="Conversa da missão" className="workspace-panel">
      {waitingInput ? (
        <form className="form" aria-label="Resposta ao agente" onSubmit={handleAnswer}>
          <div className="field">
            <label htmlFor="mission-answer">{prompt}</label>
            <textarea
              id="mission-answer"
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

      <Timeline events={view.events} />
    </section>
  );
}
