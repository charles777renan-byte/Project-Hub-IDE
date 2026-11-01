import { useState } from 'react';
import type { MissionDto, MissionStepDto, PlanEditInput } from '@project-hub/contracts';
import { PLAN_TEXT, agentLabel } from '../mission-text';
import { OrchestratorBoard } from './OrchestratorBoard';
import { StepList } from './mission/StepList';

/**
 * O plano no centro da missão (seção 10.7, RF-MIS-003). Enquanto o planejamento roda, mostra o quadro do
 * orquestrador (só leitura), que diz o que o agente está fazendo, e a lista de etapas não aparece. Fora do
 * planejamento, só a lista (o quadro não aparece), e a mensagem de plano vazio é dela. Com a missão
 * planejada, a pessoa edita as tarefas pelo menu de cada linha (renomear, mover, remover); fora desse
 * estado a lista é só leitura. Orquestrar, aprovar e pedir outro plano ficam no bloco "Sua decisão".
 * Enquanto o plano não é aprovado, nada muda no código.
 */
export function PlanPanel({
  mission,
  steps,
  busy,
  planning,
  error,
  onEditStep,
}: {
  mission: MissionDto;
  steps: readonly MissionStepDto[];
  /** Uma chamada em curso (planejar, edição, aprovação…): os controles ficam desabilitados. */
  busy: boolean;
  /** O planejamento em curso, que pode levar alguns minutos. */
  planning: boolean;
  /** Falha de uma edição das tarefas ou de um novo plano, dita pelo processo principal. */
  error?: string | undefined;
  onEditStep: (stepId: string, edit: PlanEditInput) => void;
}) {
  const editable = mission.status === 'planned';
  /** Uma regra só: com qualquer chamada em curso, planejar inclusive, nada do painel muda o plano. */
  const locked = busy || planning;
  /** Tarefas com a descrição aberta: é só estado de tela, a descrição já vem com a tarefa. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const agents = [...new Set(steps.map((step) => agentLabel(step.agent)))];
  const agentName = agents.length === 0 ? agentLabel('claude-code') : agents.join(', ');

  function toggleDescription(stepId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(stepId)) next.add(stepId);
      return next;
    });
  }
  function move(stepId: string, direction: 'up' | 'down') {
    const step = steps.find((candidate) => candidate.id === stepId);
    if (step === undefined) return;
    onEditStep(stepId, {
      op: 'move',
      toPosition: direction === 'up' ? step.position - 1 : step.position + 1,
    });
  }

  return (
    <section aria-label="Plano da missão">
      {planning ? (
        <p role="status" className="plan-status">
          {PLAN_TEXT.planning} {PLAN_TEXT.planningHint}
        </p>
      ) : null}

      {error === undefined ? null : (
        <p role="alert" className="page-alert">
          {error}
        </p>
      )}

      {planning ? (
        <OrchestratorBoard steps={steps} />
      ) : (
        <StepList
          steps={steps}
          agentName={agentName}
          expandedIds={expanded}
          editable={editable}
          disabled={locked}
          onRename={(stepId, edit) => onEditStep(stepId, { op: 'rename', ...edit })}
          onMove={move}
          onRemove={(stepId) => onEditStep(stepId, { op: 'remove' })}
          onViewDescription={toggleDescription}
        />
      )}
    </section>
  );
}
