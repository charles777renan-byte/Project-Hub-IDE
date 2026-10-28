import { useId } from 'react';
import type { MissionViewDto } from '@project-hub/contracts';
import { MISSION_TEXT, PLAN_TEXT, primaryActionOf, type PrimaryAction } from '../../mission-text';
import { DecisionBanner } from '../workspace/DecisionBanner';

/** Rótulo da ação principal de cada situação. */
const PRIMARY_LABEL: Record<PrimaryAction, string> = {
  generate_plan: MISSION_TEXT.generatePlan,
  approve_plan: MISSION_TEXT.approvePlan,
  start: MISSION_TEXT.start,
  resume: MISSION_TEXT.resume,
  retry: MISSION_TEXT.retry,
};

/**
 * "Sua decisão": o bloco do fim da missão, o único lugar da ação principal que a situação permite
 * (Orquestrar, com o aviso da cota, Aprovar plano, Iniciar missão, Retomar ou Tentar de novo). Só mostra e
 * chama o que a página passa: o comportamento das ações, os bloqueios (`busy`, `planning`) e as mensagens
 * ficam na página. Por ora o bloco também leva o aviso "Aguardando você" (os cartões de aprovação e
 * pergunta ainda moram na Conversa), numa região `status` que fica montada o tempo todo: só assim o leitor
 * de tela anuncia o aviso quando ele entra.
 */
export function DecisionBlock({
  view,
  busy,
  planning,
  controlBusy,
  onGeneratePlan,
  onApprovePlan,
  onStart,
  onResume,
  onRetry,
  onOpenDecision,
}: {
  view: MissionViewDto;
  /** Chamadas longas (planejar, aprovar, iniciar e tentar de novo): desabilitam a ação principal. */
  busy: boolean;
  /** O planejamento em curso (pode levar minutos): o Orquestrar mostra "Planejando…". */
  planning: boolean;
  /** Pausar, retomar, cancelar e excluir: cada uma só cobre a própria chamada. */
  controlBusy: boolean;
  onGeneratePlan: () => void;
  onApprovePlan: () => void;
  onStart: () => void;
  onResume: () => void;
  onRetry: () => void;
  /** Leva à Conversa, onde ficam os controles da decisão pendente. */
  onOpenDecision: () => void;
}) {
  const titleId = useId();
  const quotaId = useId();
  const primary = primaryActionOf(view.mission.status);

  const primaryAction: Record<PrimaryAction, { run: () => void; disabled: boolean }> = {
    generate_plan: { run: onGeneratePlan, disabled: busy },
    approve_plan: { run: onApprovePlan, disabled: busy },
    start: { run: onStart, disabled: busy },
    resume: { run: onResume, disabled: controlBusy },
    retry: { run: onRetry, disabled: busy },
  };

  return (
    <section aria-labelledby={titleId} className="decision-block">
      <h2 id={titleId} className="mission-section-title">
        {MISSION_TEXT.decisionTitle}
      </h2>
      {/* A região fica montada o tempo todo: só assim o leitor de tela anuncia o aviso quando ele entra. */}
      <div role="status" aria-live="polite" className="decision-status">
        <DecisionBanner view={view} onOpen={onOpenDecision} />
      </div>
      {primary === undefined ? null : (
        <div className="decision-block__actions">
          <button
            type="button"
            className={primary === 'approve_plan' ? 'btn-decision' : 'btn-primary'}
            aria-describedby={primary === 'generate_plan' ? quotaId : undefined}
            disabled={primaryAction[primary].disabled}
            onClick={primaryAction[primary].run}
          >
            {primary === 'generate_plan' && planning ? PLAN_TEXT.planning : PRIMARY_LABEL[primary]}
          </button>
          {primary === 'generate_plan' ? (
            <p id={quotaId} className="plan-quota">
              {PLAN_TEXT.quotaWarning}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
