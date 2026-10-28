import type { MissionDto, MissionStepDto, PlanEditInput } from '@project-hub/contracts';
import { PLAN_TEXT } from '../mission-text';
import { OrchestratorBoard } from './OrchestratorBoard';
import { PlanStepRow } from './PlanStepRow';

/**
 * O plano no centro da missão (seção 10.7, RF-MIS-003): o quadro do orquestrador (quando há tarefas com
 * papel, só leitura) e a tabela de tarefas (TAREFA, AGENTE, STATUS). Com a missão planejada, a pessoa
 * edita as tarefas (renomear, mover, remover e trocar o programa). Fora desse estado a tabela é só
 * leitura. Orquestrar, aprovar e pedir outro plano ficam no bloco "Sua decisão". Enquanto o plano não
 * é aprovado, nada muda no código.
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

      <OrchestratorBoard steps={steps} />

      {steps.length === 0 ? (
        <p className="empty">{PLAN_TEXT.empty}</p>
      ) : (
        <table className="plan-table" aria-label={PLAN_TEXT.tableLabel}>
          <thead>
            <tr>
              <th scope="col">{PLAN_TEXT.columns.task}</th>
              <th scope="col">{PLAN_TEXT.columns.agent}</th>
              <th scope="col">{PLAN_TEXT.columns.status}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, index) => (
              <PlanStepRow
                key={step.id}
                step={step}
                steps={steps}
                editable={editable}
                busy={locked}
                isFirst={index === 0}
                isLast={index === steps.length - 1}
                onEdit={(edit) => onEditStep(step.id, edit)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
