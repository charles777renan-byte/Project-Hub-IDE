import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { stepStatus } from '../mission-text';
import { StatusChip } from './StatusChip';

/**
 * Aba Plano do workspace da missão (seção 10.7, RF-MIS-003). Mostra as etapas numeradas e a decisão
 * que a missão espera: gerar o plano, aprovar o plano com a opção de pedir outro, ou iniciar a
 * missão já aprovada. Enquanto o plano não é aprovado, nada muda no código.
 */
export function PlanPanel({
  mission,
  steps,
  busy,
  onGeneratePlan,
  onApprovePlan,
  onRequestNewPlan,
  onStart,
}: {
  mission: MissionDto;
  steps: readonly MissionStepDto[];
  busy: boolean;
  onGeneratePlan: () => void;
  onApprovePlan: () => void;
  onRequestNewPlan: () => void;
  onStart: () => void;
}) {
  const status = mission.status;
  return (
    <section aria-label="Plano da missão">
      {steps.length === 0 ? (
        <p className="empty">Ainda não há plano. Gere o plano para revisar as etapas.</p>
      ) : (
        <ol className="plan-steps" aria-label="Etapas do plano">
          {steps.map((step) => {
            const chip = stepStatus(step.status);
            return (
              <li key={step.id} className="plan-step">
                <span className="plan-step-number">{step.position}</span>
                <span>
                  {step.title}
                  <span className="plan-step-agent"> · Agente simulado</span>
                </span>
                <StatusChip label={chip.label} tone={chip.tone} />
              </li>
            );
          })}
        </ol>
      )}

      {status === 'planned' ? (
        <section className="decision-card" aria-labelledby="plan-decision">
          <p className="eyebrow">Decisão</p>
          <h3 id="plan-decision">Aprovar plano?</h3>
          <p>Revise as etapas. Nenhuma alteração é feita no código antes da sua aprovação.</p>
          <div className="inline-actions">
            <button type="button" className="btn-decision" disabled={busy} onClick={onApprovePlan}>
              Aprovar plano
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={busy}
              onClick={onRequestNewPlan}
            >
              Pedir novo plano
            </button>
          </div>
        </section>
      ) : null}

      {status === 'draft' ? (
        <div className="inline-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={onGeneratePlan}>
            Gerar plano
          </button>
        </div>
      ) : null}

      {status === 'queued' ? (
        <div className="inline-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={onStart}>
            Iniciar missão
          </button>
        </div>
      ) : null}
    </section>
  );
}
