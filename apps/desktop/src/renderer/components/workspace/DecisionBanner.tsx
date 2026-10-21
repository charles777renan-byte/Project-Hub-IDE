import type { MissionViewDto } from '@project-hub/contracts';
import { MISSION_TEXT, lastInputPrompt } from '../../mission-text';

/**
 * Banner "Aguardando você", fixo logo abaixo do resumo da missão e visível em todas as abas. Só existe
 * quando há algo pendente: uma aprovação de ação protegida ou o pedido de resposta do agente (os
 * mesmos dados que a Conversa usa para mostrar a decisão). Lista os itens em uma linha cada e leva
 * até a Conversa, onde ficam os controles da decisão. Quem troca de aba e põe o foco é a página.
 */
export function DecisionBanner({ view, onOpen }: { view: MissionViewDto; onOpen: () => void }) {
  const { mission, pendingApprovals, events } = view;
  const waitingInput = mission.status === 'waiting_input';
  if (pendingApprovals.length === 0 && !waitingInput) return null;

  return (
    <section aria-label="Aguardando você" className="decision-banner">
      <h2 className="decision-banner__title">Aguardando você</h2>
      <ul className="decision-banner__items">
        {pendingApprovals.map((approval) => (
          <li key={approval.id}>
            <span className="decision-banner__kind">Aprovação</span>
            <span>{approval.title}</span>
          </li>
        ))}
        {waitingInput ? (
          <li>
            <span className="decision-banner__kind">Resposta</span>
            <span>{lastInputPrompt(events) ?? 'O agente aguarda a sua resposta.'}</span>
          </li>
        ) : null}
      </ul>
      <button type="button" className="btn-outline" onClick={onOpen}>
        {MISSION_TEXT.decisionLink}
      </button>
    </section>
  );
}
