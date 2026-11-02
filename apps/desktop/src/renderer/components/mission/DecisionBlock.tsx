import { useCallback, useId, useRef, useState, type FormEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import type { MissionViewDto } from '@project-hub/contracts';
import {
  DECISION_TEXT,
  MISSION_TEXT,
  PLAN_TEXT,
  decisionAnnouncement,
  decisionTextOf,
  lastInputPrompt,
  primaryActionOf,
  verifiedCriteria,
  type PrimaryAction,
} from '../../mission-text';
import { ApprovalCard } from '../ApprovalCard';
import { revealDecision, useDecisionOutOfView } from './decision-visibility';

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
 * Eventos da execução que concluiu a missão, pela mesma regra de `deriveConclusion`: a última
 * `execution.concluded` e os eventos com o mesmo `aggregateId`. Assim a verificação de uma tentativa
 * anterior não comprova critério na conclusão de outra. Sem nenhuma `execution.concluded` na lista, vale a
 * lista inteira.
 */
function eventsOfConclusion(events: MissionViewDto['events']): MissionViewDto['events'] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.eventType === 'execution.concluded') {
      return events.filter((other) => other.aggregateId === event.aggregateId);
    }
  }
  return events;
}

/**
 * Linha de testes do resumo. Sem verificação, diz que nada foi registrado; com verificação de zero testes,
 * não conta zero como se fosse um resultado.
 */
function testsLine(
  verification: NonNullable<MissionViewDto['conclusion']>['verification'],
): string {
  if (verification === undefined) return 'Testes: nenhuma verificação registrada.';
  if (verification.passed === 0 && verification.failed === 0) {
    return 'Testes: nenhum teste contado.';
  }
  const failed = verification.failed > 0 ? `, ${verification.failed} falharam` : '';
  return `Testes: ${verification.passed} passaram${failed}`;
}

/**
 * Fecho da missão (R130): a frase final do agente, o próximo passo do Git, a verificação e os critérios
 * comprovados, numa caixa discreta. A verificação aparece aqui para a pessoa ver antes de aprovar
 * (decisao-revisao-da-missao). Os arquivos alterados continuam fora: já aparecem na aba Diff. A frase vem
 * do agente e entra como texto, nunca como HTML.
 */
function ConclusionSummary({
  conclusion,
  criteriaVerified,
  criteriaTotal,
}: {
  conclusion: NonNullable<MissionViewDto['conclusion']>;
  /** Critérios de aceite da missão que os eventos comprovam (X de Y). */
  criteriaVerified: number;
  criteriaTotal: number;
}) {
  const { verification } = conclusion;
  const nextStep =
    conclusion.gitState === 'uncommitted'
      ? 'Há alterações sem commit na pasta da missão. Elas ainda não entraram no projeto.'
      : 'O trabalho está salvo na branch da missão. Ainda não entrou no projeto.';
  return (
    <section className="conclusion" aria-label="Resumo da conclusão">
      <p className="conclusion__summary">{conclusion.summary}</p>
      <ul className="conclusion__facts">
        <li className="conclusion__item">{nextStep}</li>
        <li className="conclusion__item">{testsLine(verification)}</li>
        {criteriaTotal > 0 ? (
          <li className="conclusion__item">
            {`Critérios: ${criteriaVerified} de ${criteriaTotal} verificados.`}
          </li>
        ) : null}
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
 *
 * O bloco fica no fluxo do corpo, inteiro, sem altura máxima nem rolagem própria. Quando ele rola para trás
 * do cabeçalho fixo, e a situação tem algo a fazer, uma barra compacta aparece no `barSlot` (o encaixe do
 * grupo fixo): a frase, a ação principal (ou Aprovar e Recusar, quando há uma aprovação só) e "Ver decisão".
 * Campos de texto não vão para a barra: "Ver decisão" leva o bloco de volta à vista.
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
  onCancelPlanning,
  onStart,
  onResume,
  onRetry,
  onDecide,
  onAnswer,
  onApproveReview,
  onRequestChanges,
  decisionRef,
  answerRef,
  barSlot = null,
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
  /** Interrompe o planejamento em andamento. Só aparece enquanto `planning`. */
  onCancelPlanning: () => void;
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
  /** Onde a barra aparece quando o bloco sai de vista. Sem encaixe, ou sem decisão à vista, não há barra. */
  barSlot?: HTMLElement | null;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  /** O bloco é do `decisionRef` da página e também daqui, para medir se ele saiu de vista. */
  const setSection = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      if (typeof decisionRef === 'function') decisionRef(node);
      else if (decisionRef !== null && decisionRef !== undefined) decisionRef.current = node;
    },
    [decisionRef],
  );
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
  /** Critérios da missão comprovados pelas verificações que passaram na execução da conclusão (X de Y). */
  const verified = verifiedCriteria(eventsOfConclusion(events));
  const criteriaTotal = view.mission.acceptanceCriteria.length;
  const criteriaVerified = view.mission.acceptanceCriteria.filter((criterion) =>
    verified.has(criterion.text.trim()),
  ).length;

  const primaryAction: Record<PrimaryAction, { run: () => void; disabled: boolean }> = {
    generate_plan: { run: onGeneratePlan, disabled: busy },
    approve_plan: { run: onApprovePlan, disabled: busy },
    start: { run: onStart, disabled: busy },
    resume: { run: onResume, disabled: controlBusy },
    retry: { run: onRetry, disabled: busy },
  };

  /** Só entra na barra o que se faz com um clique: caixas de texto ficam no bloco. */
  const singleApproval = pendingApprovals.length === 1 ? pendingApprovals[0] : undefined;
  const hasBarAction =
    primary !== undefined || reviewing || waitingInput || pendingApprovals.length > 0;
  const barVisible = useDecisionOutOfView(
    sectionRef,
    hasBarAction ? barSlot : null,
    `${status}:${pendingApprovals.length}`,
  );

  function showDecision() {
    const block = sectionRef.current;
    if (block === null) return;
    revealDecision(block, barSlot, true);
    block.focus({ preventScroll: true });
  }

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

  const bar =
    barVisible && barSlot !== null
      ? createPortal(
          <div className="decision-bar" role="group" aria-label={DECISION_TEXT.barLabel}>
            <p className="decision-bar__text">
              <strong>{MISSION_TEXT.decisionTitle}</strong>
              <span>{singleApproval?.title ?? decisionTextOf(status)}</span>
            </p>
            <div className="decision-bar__actions">
              {singleApproval !== undefined ? (
                <>
                  <button
                    type="button"
                    className="btn-decision"
                    disabled={busy}
                    onClick={() => onDecide(singleApproval.id, 'approved')}
                  >
                    Aprovar
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busy}
                    onClick={() => onDecide(singleApproval.id, 'rejected')}
                  >
                    Recusar
                  </button>
                </>
              ) : null}
              {reviewing ? (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={onApproveReview}
                >
                  {MISSION_TEXT.approveReview}
                </button>
              ) : null}
              {primary === undefined ? null : (
                <button
                  type="button"
                  className={primary === 'approve_plan' ? 'btn-decision' : 'btn-primary'}
                  disabled={primaryAction[primary].disabled}
                  onClick={primaryAction[primary].run}
                >
                  {primary === 'generate_plan' && planning
                    ? PLAN_TEXT.planning
                    : PRIMARY_LABEL[primary]}
                </button>
              )}
              <button type="button" className="btn-outline" onClick={showDecision}>
                {DECISION_TEXT.showDecision}
              </button>
            </div>
          </div>,
          barSlot,
        )
      : null;

  return (
    <>
      {bar}
      <section
        ref={setSection}
        tabIndex={-1}
        aria-labelledby={titleId}
        className={`decision-block mission-focus${reviewing ? ' decision-block--review' : ''}${planned ? ' decision-block--planned' : ''}`}
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
          <ConclusionSummary
            conclusion={conclusion}
            criteriaVerified={criteriaVerified}
            criteriaTotal={criteriaTotal}
          />
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
            <div className="form-actions decision-block__approve">
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={onApproveReview}
              >
                {MISSION_TEXT.approveReview}
              </button>
            </div>
            <form
              className="form decision-block__changes"
              aria-label="Pedir ajustes"
              onSubmit={handleRequestChanges}
            >
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
              {primary === 'generate_plan' && planning
                ? PLAN_TEXT.planning
                : PRIMARY_LABEL[primary]}
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
            {planning ? (
              <button type="button" className="btn-outline" onClick={onCancelPlanning}>
                {PLAN_TEXT.cancelPlanning}
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
    </>
  );
}
