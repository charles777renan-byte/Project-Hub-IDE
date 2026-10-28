import { useId, useState } from 'react';
import type { MissionDto, MissionStepDto, PlanEditInput } from '@project-hub/contracts';
import { PLAN_TEXT } from '../mission-text';
import { PlanStepRow } from './PlanStepRow';

/** Limite da instrução do novo plano, o mesmo do contrato (`planMissionInputSchema`). */
const INSTRUCTION_MAX = 1000;

/**
 * Aba Plano do workspace da missão (seção 10.7, RF-MIS-003): a tabela de tarefas (TAREFA, AGENTE,
 * STATUS). Com a missão planejada, a pessoa revisa e edita as tarefas (renomear, mover, remover e trocar
 * o programa) e pode pedir outro plano, com uma instrução opcional. Fora desse estado a tabela é só
 * leitura. Gerar o plano (Orquestrar) e aprovar ficam no resumo da missão, no topo da página. Planejar
 * usa a cota do Claude, por isso só acontece num clique, com o aviso ao lado. Enquanto o plano não é
 * aprovado, nada muda no código.
 */
export function PlanPanel({
  mission,
  steps,
  busy,
  planning,
  error,
  onEditStep,
  onRequestNewPlan,
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
  /** Pede outro plano; a instrução vem aparada e vazia quando a pessoa não escreveu nada. */
  onRequestNewPlan: (instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const warningId = useId();
  const instructionId = useId();
  const hintId = useId();
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

      {editable ? (
        <div className="plan-review">
          <p className="muted">{PLAN_TEXT.reviewHint}</p>
          <div className="field plan-review__instruction">
            <label htmlFor={instructionId}>{PLAN_TEXT.instructionLabel}</label>
            <textarea
              id={instructionId}
              rows={2}
              maxLength={INSTRUCTION_MAX}
              aria-describedby={hintId}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <p id={hintId} className="field-hint">
              {PLAN_TEXT.instructionHint}
            </p>
          </div>
          <div className="plan-review__replan">
            <button
              type="button"
              className="btn-outline"
              aria-describedby={warningId}
              disabled={locked}
              onClick={() => onRequestNewPlan(instruction.trim())}
            >
              {planning ? PLAN_TEXT.planning : PLAN_TEXT.replan}
            </button>
            <p id={warningId} className="plan-quota">
              {PLAN_TEXT.quotaWarning}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
