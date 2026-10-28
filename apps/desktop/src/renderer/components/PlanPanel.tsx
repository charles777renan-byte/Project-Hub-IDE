import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { dependencyText, roleLabel, stepStatus } from '../mission-text';
import { StatusChip } from './StatusChip';

/**
 * Aba Plano do workspace da missão (seção 10.7, RF-MIS-003). Mostra as etapas numeradas. As ações
 * principais (gerar o plano, aprovar e iniciar a missão) ficam no resumo da missão, no topo da página;
 * aqui só resta pedir outro plano enquanto o atual espera aprovação. Enquanto o plano não é aprovado,
 * nada muda no código.
 */
export function PlanPanel({
  mission,
  steps,
  busy,
  onRequestNewPlan,
}: {
  mission: MissionDto;
  steps: readonly MissionStepDto[];
  busy: boolean;
  onRequestNewPlan: () => void;
}) {
  return (
    <section aria-label="Plano da missão">
      {steps.length === 0 ? (
        <p className="empty">Ainda não há plano. Gere o plano para revisar as etapas.</p>
      ) : (
        <ol className="plan-steps" aria-label="Etapas do plano">
          {steps.map((step) => {
            const chip = stepStatus(step.status);
            const role = roleLabel(step.role);
            const after = dependencyText(step, steps);
            return (
              <li key={step.id} className="plan-step">
                <span className="plan-step-number">{step.position}</span>
                <span>
                  {step.title}
                  <span className="plan-step-agent">
                    {role === undefined ? ' · Agente simulado' : ` · ${role}`}
                    {after === undefined ? '' : ` · ${after}`}
                  </span>
                </span>
                <StatusChip label={chip.label} tone={chip.tone} />
              </li>
            );
          })}
        </ol>
      )}

      {mission.status === 'planned' ? (
        <div className="plan-review">
          <p className="muted">
            Revise as etapas. Nenhuma alteração é feita no código antes da sua aprovação.
          </p>
          <button type="button" className="btn-outline" disabled={busy} onClick={onRequestNewPlan}>
            Pedir novo plano
          </button>
        </div>
      ) : null}
    </section>
  );
}
