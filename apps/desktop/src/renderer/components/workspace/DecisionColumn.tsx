import type { Ref } from 'react';
import type { MissionViewDto } from '@project-hub/contracts';
import { lastInputPrompt, requiredActionOf } from '../../mission-text';
import { ApprovalCard } from '../ApprovalCard';
import { Panel, PanelEmpty } from '../Panel';
import { AcceptancePanel } from './AcceptancePanel';
import { GitPanel } from './GitPanel';

/** Estados em que a próxima ação é do painel Plano: gerar, aprovar ou iniciar. */
const PLAN_STATUSES: ReadonlySet<MissionViewDto['mission']['status']> = new Set([
  'draft',
  'planned',
  'queued',
]);

/**
 * Coluna "Aguardando você" do workspace da missão (Tarefa 6): a reserva de 370px à direita da grade,
 * com três painéis empilhados. A decisão (aprovar ou recusar uma ação protegida) acontece só aqui; a
 * Conversa mostra o histórico e a caixa de resposta. As ações chegam por props da página, que é
 * quem já sabe chamar o processo principal.
 */
export function DecisionColumn({
  view,
  busy,
  onDecide,
  focusRef,
}: {
  view: MissionViewDto;
  busy: boolean;
  onDecide: (approvalId: string, decision: 'approved' | 'rejected') => void;
  /** Recebe o foco quando a missão espera a aprovação (o aviso do cabeçalho leva até aqui). */
  focusRef?: Ref<HTMLElement>;
}) {
  const { mission, project, pendingApprovals, events } = view;
  const waitingInput = mission.status === 'waiting_input';
  const count = pendingApprovals.length + (waitingInput ? 1 : 0);
  // Sem item, a coluna aponta o painel Plano quando é ali que a ação da missão está.
  const planAction = PLAN_STATUSES.has(mission.status)
    ? requiredActionOf(mission.status)
    : undefined;
  const emptyText =
    planAction === undefined
      ? 'Nada espera por você'
      : `Esta missão espera uma ação no painel Plano: ${planAction}.`;

  return (
    <aside
      ref={focusRef}
      tabIndex={-1}
      aria-label="Decisões da missão"
      className="mission-grid__reserve decision-column"
    >
      <Panel
        title="Aguardando você"
        accent="violet"
        tag={{ label: String(count), tone: count > 0 ? 'violet' : 'muted' }}
      >
        {count === 0 ? <PanelEmpty>{emptyText}</PanelEmpty> : null}
        {pendingApprovals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            busy={busy}
            onDecide={(decision) => onDecide(approval.id, decision)}
          />
        ))}
        {waitingInput ? (
          <div className="decision-question">
            <p>{lastInputPrompt(events) ?? 'O agente aguarda a sua resposta.'}</p>
            <p className="muted">Responda na Conversa.</p>
          </div>
        ) : null}
      </Panel>
      <AcceptancePanel criteria={mission.acceptanceCriteria} />
      <GitPanel
        defaultBranch={project.defaultBranch}
        hasWorktree={mission.worktreePath !== undefined}
      />
    </aside>
  );
}
