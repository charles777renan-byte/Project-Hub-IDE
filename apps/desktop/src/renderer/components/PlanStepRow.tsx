import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MissionStepDto, PlanEditInput } from '@project-hub/contracts';
import {
  AGENT_CHOICES,
  PLAN_TEXT,
  agentLabel,
  dependencyText,
  roleLabel,
  stepStatus,
} from '../mission-text';
import { ConfirmButton } from './ConfirmButton';
import { StatusChip } from './StatusChip';

/** Para onde a pessoa mandou a tarefa: o foco acompanha o movimento quando o botão usado some. */
type MoveIntent = 'up' | 'down';

/**
 * Uma linha da tabela de tarefas do Plano (TAREFA, AGENTE, STATUS). Com `editable`, a linha ganha as
 * ações da edição (renomear, subir, descer, remover) e o seletor de programa. O nome acessível de cada
 * controle leva o título da tarefa. A linha só mostra e avisa o que a pessoa pediu: quem aplica a edição
 * é o processo principal, e a lista nova volta pela página.
 */
export function PlanStepRow({
  step,
  steps,
  editable,
  busy,
  isFirst,
  isLast,
  onEdit,
}: {
  step: MissionStepDto;
  steps: readonly MissionStepDto[];
  editable: boolean;
  /** Uma chamada em curso: nenhum controle de edição aceita clique. */
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (edit: PlanEditInput) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(step.title);
  const renameRef = useRef<HTMLButtonElement>(null);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const moveIntent = useRef<MoveIntent | null>(null);
  /** Devolve o foco ao "Renomear" quando o campo fecha por ação da pessoa, e não na primeira montagem. */
  const refocusRename = useRef(false);

  // Subir até o topo (ou descer até o fim) tira o botão usado da tela: o foco vai para o botão oposto.
  // Espera a chamada acabar (botão desabilitado não recebe foco) e encerra o pedido, com a linha movida ou não.
  useEffect(() => {
    if (busy || moveIntent.current === null) return;
    if (moveIntent.current === 'up' && isFirst) downRef.current?.focus();
    if (moveIntent.current === 'down' && isLast) upRef.current?.focus();
    moveIntent.current = null;
  }, [busy, step.position, isFirst, isLast]);
  // Com o campo fechado e a chamada acabada (o botão desabilitado não recebe foco), o foco volta.
  useEffect(() => {
    if (!renaming && !busy && refocusRename.current) {
      refocusRename.current = false;
      renameRef.current?.focus();
    }
  }, [renaming, busy]);

  const role = roleLabel(step.role);
  const after = dependencyText(step, steps);
  const detail = [role, after].filter((part) => part !== undefined).join(' · ');
  const chip = stepStatus(step.status);
  const trimmed = name.trim();
  const canSave = trimmed !== '' && trimmed !== step.title;

  function startRename() {
    setName(step.title);
    setRenaming(true);
  }
  function closeRename() {
    refocusRename.current = true;
    setRenaming(false);
  }
  function saveRename() {
    if (!canSave) return;
    onEdit({ op: 'rename', title: trimmed });
    closeRename();
  }
  function onRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeRename();
    }
  }
  function move(intent: MoveIntent) {
    moveIntent.current = intent;
    onEdit({ op: 'move', toPosition: intent === 'up' ? step.position - 1 : step.position + 1 });
  }

  return (
    <tr className="plan-row">
      <td className="plan-row__task">
        <span className="plan-row__number">{step.position}</span>
        <span className="plan-row__body">
          {renaming ? (
            <span className="plan-row__rename">
              <input
                type="text"
                aria-label={PLAN_TEXT.newName(step.title)}
                value={name}
                maxLength={120}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={onRenameKey}
              />
              <button
                type="button"
                className="btn-secondary"
                aria-label={PLAN_TEXT.saveName(step.title)}
                disabled={!canSave || busy}
                onClick={saveRename}
              >
                {PLAN_TEXT.save}
              </button>
              <button
                type="button"
                aria-label={PLAN_TEXT.cancelRename(step.title)}
                onClick={closeRename}
              >
                {PLAN_TEXT.cancel}
              </button>
            </span>
          ) : (
            <span className="plan-row__title">{step.title}</span>
          )}
          {detail === '' ? null : <span className="plan-row__detail">{detail}</span>}
          {editable ? (
            <span className="plan-actions">
              <button
                type="button"
                ref={renameRef}
                className="btn-ghost"
                aria-label={PLAN_TEXT.rename(step.title)}
                disabled={busy || renaming}
                onClick={startRename}
              >
                {PLAN_TEXT.renameButton}
              </button>
              {isFirst ? null : (
                <button
                  type="button"
                  ref={upRef}
                  className="btn-ghost"
                  aria-label={PLAN_TEXT.moveUp(step.title)}
                  disabled={busy}
                  onClick={() => move('up')}
                >
                  {PLAN_TEXT.moveUpButton}
                </button>
              )}
              {isLast ? null : (
                <button
                  type="button"
                  ref={downRef}
                  className="btn-ghost"
                  aria-label={PLAN_TEXT.moveDown(step.title)}
                  disabled={busy}
                  onClick={() => move('down')}
                >
                  {PLAN_TEXT.moveDownButton}
                </button>
              )}
              <ConfirmButton
                label={PLAN_TEXT.removeButton}
                ariaLabel={PLAN_TEXT.remove(step.title)}
                question={PLAN_TEXT.removeQuestion(step.title)}
                confirmLabel={PLAN_TEXT.removeButton}
                disabled={busy}
                onConfirm={() => onEdit({ op: 'remove' })}
              />
            </span>
          ) : null}
        </span>
      </td>
      <td className="plan-row__agent">
        {editable ? (
          <select
            className={`plan-agent plan-agent--${step.agent}`}
            aria-label={PLAN_TEXT.program(step.title)}
            value={step.agent}
            disabled={busy}
            onChange={(event) => {
              const agent = event.target.value;
              if (agent === 'claude-code') onEdit({ op: 'agent', agent });
            }}
          >
            {AGENT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value} disabled={!choice.available}>
                {choice.available ? choice.label : `${choice.label} (${PLAN_TEXT.soon})`}
              </option>
            ))}
          </select>
        ) : (
          <span className={`plan-agent plan-agent--${step.agent}`}>{agentLabel(step.agent)}</span>
        )}
      </td>
      <td className="plan-row__status">
        <StatusChip label={chip.label} tone={chip.tone} />
      </td>
    </tr>
  );
}
