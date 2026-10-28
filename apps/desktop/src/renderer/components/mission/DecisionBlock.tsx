import { useId, useState, type FormEvent, type Ref } from 'react';
import type { MissionViewDto } from '@project-hub/contracts';
import {
  DECISION_TEXT,
  MISSION_TEXT,
  PLAN_TEXT,
  decisionAnnouncement,
  decisionTextOf,
  lastInputPrompt,
  primaryActionOf,
  type PrimaryAction,
} from '../../mission-text';
import { ApprovalCard } from '../ApprovalCard';

/** Limite da instrução do novo plano, o mesmo do contrato (`planMissionInputSchema`). */
const INSTRUCTION_MAX = 1000;

/** Rótulo da ação principal de cada situação. */
const PRIMARY_LABEL: Record<PrimaryAction, string> = {
  generate_plan: MISSION_TEXT.generatePlan,
  approve_plan: MISSION_TEXT.approvePlan,
  start: MISSION_TEXT.start,
  resume: MISSION_TEXT.resume,
  retry: MISSION_TEXT.retry,
};

/**
 * Fecho da missão (R130): a frase final do agente e o estado do Git, numa caixa discreta. A verificação e
 * os arquivos alterados já aparecem nas abas Testes e Diff, então não se repetem aqui. A frase vem do
 * agente e entra como texto, nunca como HTML.
 */
function ConclusionSummary({
  conclusion,
}: {
  conclusion: NonNullable<MissionViewDto['conclusion']>;
}) {
  return (
    <section className="conclusion" aria-label="Resumo da conclusão">
      <p className="conclusion__summary">{conclusion.summary}</p>
      <ul className="conclusion__facts">
        <li className="conclusion__item">
          {conclusion.gitState === 'uncommitted'
            ? 'Git: alterações sem commit'
            : 'Git: sem alterações pendentes'}
        </li>
      </ul>
    </section>
  );
}

/**
 * "Sua decisão": o bloco do fim da missão, o único lugar do que a situação espera da pessoa. Cada
 * situação mostra uma frase curta e o que cabe a ela: Orquestrar (com o aviso da cota); Aprovar plano, a
 * instrução opcional e Planejar de novo; Iniciar missão; Retomar; os cartões de aprovação e a caixa de
 * resposta do agente; o resumo da conclusão com Aprovar conclusão e Pedir ajustes; Tentar de novo. Em
 * execução só diz que o Orquestrador acompanha. A falha de uma ação aparece aqui, junto dos botões.
 *
 * Só mostra e chama o que a página passa: o comportamento das ações, os bloqueios (`busy`, `planning`) e
 * as mensagens ficam na página. Quem guarda aqui é o que a pessoa digita (resposta, ajustes e instrução).
 * A região `status` fica montada o tempo todo, vazia até uma decisão chegar: só assim o leitor de tela
 * anuncia a decisão nova mesmo com outra aba do painel inferior aberta. O bloco também é o alvo do foco
 * (`decisionRef`; `answerRef` quando o agente espera uma resposta).
 */
export function DecisionBlock({
  view,
  busy,
  planning,
  controlBusy,
  error,
  onGeneratePlan,
  onApprovePlan,
  onRequestNewPlan,
  onStart,
  onResume,
  onRetry,
  onDecide,
  onAnswer,
  onApproveReview,
  onRequestChanges,
  decisionRef,
  answerRef,
}: {
  view: MissionViewDto;
  /** Chamadas longas (planejar, aprovar, iniciar, decidir, responder e tentar de novo): desabilitam as ações. */
  busy: boolean;
  /** O planejamento em curso (pode levar minutos): o Orquestrar mostra "Planejando…". */
  planning: boolean;
  /** Pausar, retomar, cancelar e excluir: cada uma só cobre a própria chamada. */
  controlBusy: boolean;
  /** Falha da última ação da decisão, dita pelo processo principal. */
  error?: string | undefined;
  onGeneratePlan: () => void;
  onApprovePlan: () => void;
  /** Pede outro plano; a instrução vem aparada e vazia quando a pessoa não escreveu nada. */
  onRequestNewPlan: (instruction: string) => void;
  onStart: () => void;
  onResume: () => void;
  onRetry: () => void;
  onDecide: (approvalId: string, decision: 'approved' | 'rejected') => void;
  /** Devolve `true` quando a resposta foi enviada, para a caixa limpar. */
  onAnswer: (text: string) => Promise<boolean>;
  /** Aprova a conclusão que o agente entregou. */
  onApproveReview: () => void;
  /** Pede ajustes. Devolve `true` quando o pedido foi aceito, para a caixa limpar. */
  onRequestChanges: (text: string) => Promise<boolean>;
  /** Recebe o foco quando a missão espera a decisão (o bloco é o alvo). */
  decisionRef?: Ref<HTMLElement>;
  /** Recebe o foco quando o agente espera uma resposta: o foco vai direto para a caixa de texto. */
  answerRef?: Ref<HTMLTextAreaElement>;
}) {
  const titleId = useId();
  const quotaId = useId();
  const instructionId = useId();
  const instructionHintId = useId();
  const answerId = useId();
  const feedbackId = useId();
  const [instruction, setInstruction] = useState('');
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState('');
  const { mission, pendingApprovals, events, conclusion } = view;
  const status = mission.status;
  const primary = primaryActionOf(status);
  const waitingInput = status === 'waiting_input';
  const reviewing = status === 'review';
  const planned = status === 'planned';
  /** Uma regra só: com qualquer chamada em curso, planejar inclusive, nada do bloco muda o plano. */
  const locked = busy || planning;
  const prompt = lastInputPrompt(events) ?? DECISION_TEXT.answerPromptFallback;

  const primaryAction: Record<PrimaryAction, { run: () => void; disabled: boolean }> = {
    generate_plan: { run: onGeneratePlan, disabled: busy },
    approve_plan: { run: onApprovePlan, disabled: busy },
    start: { run: onStart, disabled: busy },
    resume: { run: onResume, disabled: controlBusy },
    retry: { run: onRetry, disabled: busy },
  };

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
    <section
      ref={decisionRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="decision-block mission-focus"
    >
      <h2 id={titleId} className="mission-section-title">
        {MISSION_TEXT.decisionTitle}
      </h2>
      {/* A região fica montada o tempo todo: só assim o leitor de tela anuncia a decisão quando ela chega. */}
      <p role="status" aria-live="polite" className="decision-announce visually-hidden">
        {decisionAnnouncement(view)}
      </p>
      <p>{decisionTextOf(status)}</p>
      {planned ? <p className="muted">{DECISION_TEXT.plannedReassurance}</p> : null}

      {(reviewing || status === 'succeeded') && conclusion !== undefined ? (
        <ConclusionSummary conclusion={conclusion} />
      ) : null}

      {pendingApprovals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          busy={busy}
          onDecide={(decision) => onDecide(approval.id, decision)}
        />
      ))}

      {waitingInput ? (
        <form className="form" aria-label="Resposta ao agente" onSubmit={handleAnswer}>
          <div className="field">
            <label htmlFor={answerId}>{prompt}</label>
            <textarea
              id={answerId}
              ref={answerRef}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={busy || answer.trim() === ''}>
              {DECISION_TEXT.sendAnswer}
            </button>
          </div>
        </form>
      ) : null}

      {reviewing ? (
        <>
          <div className="form-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={onApproveReview}>
              {MISSION_TEXT.approveReview}
            </button>
          </div>
          <form className="form" aria-label="Pedir ajustes" onSubmit={handleRequestChanges}>
            <div className="field">
              <label htmlFor={feedbackId}>{DECISION_TEXT.feedbackLabel}</label>
              <textarea
                id={feedbackId}
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
        </>
      ) : null}

      {planned ? (
        <div className="field decision-block__instruction">
          <label htmlFor={instructionId}>{PLAN_TEXT.instructionLabel}</label>
          <textarea
            id={instructionId}
            rows={2}
            maxLength={INSTRUCTION_MAX}
            aria-describedby={instructionHintId}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <p id={instructionHintId} className="field-hint">
            {PLAN_TEXT.instructionHint}
          </p>
        </div>
      ) : null}

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
          {planned ? (
            <button
              type="button"
              className="btn-outline"
              aria-describedby={quotaId}
              disabled={locked}
              onClick={() => onRequestNewPlan(instruction.trim())}
            >
              {planning ? PLAN_TEXT.planning : PLAN_TEXT.replan}
            </button>
          ) : null}
          {primary === 'generate_plan' || planned ? (
            <p id={quotaId} className="plan-quota">
              {PLAN_TEXT.quotaWarning}
            </p>
          ) : null}
        </div>
      )}

      {error === undefined ? null : (
        <p role="alert" className="page-alert">
          {error}
        </p>
      )}
    </section>
  );
}
