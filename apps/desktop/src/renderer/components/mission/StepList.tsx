import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { MissionStepDto } from '@project-hub/contracts';
import { PLAN_TEXT, agentLabel, dependencyText, roleLabel, stepStatus } from '../../mission-text';
import { ConfirmInline } from '../ConfirmButton';
import { StatusChip } from '../StatusChip';

/** Limites do título e da descrição de uma tarefa (os mesmos do contrato e da aplicação). */
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;

/** O que o renomear envia: o título sempre, e a descrição só quando a pessoa a mudou. */
export type StepRename = { title: string; description?: string };

/** Textos próprios da lista. Os que já existiam no plano vêm de `PLAN_TEXT`. */
const STEP_LIST_TEXT = {
  heading: 'Etapas',
  agent: (name: string) => `Agente: ${name}`,
  menu: (title: string) => `Ações da tarefa ${title}`,
  handle: (title: string) => `Reordenar tarefa ${title} (Alt e setas para cima e para baixo)`,
  viewDescription: 'Ver descrição',
  hideDescription: 'Ocultar descrição',
  rename: 'Renomear',
  moveUp: 'Subir',
  moveDown: 'Descer',
  remove: 'Remover',
} as const;

/**
 * A lista de etapas do plano: uma linha por tarefa, com a posição, o status, o título e o papel. As ações
 * ficam num menu "⋯" por linha (Ver descrição, Renomear, Subir, Descer, Remover), sem botões repetidos. O
 * título renomeia com duplo clique (o item "Renomear" do menu é o caminho do teclado), e o renomear edita
 * também a descrição, que vai ao prompt do agente executor. A alça reordena com Alt+setas. O agente
 * aparece uma vez, no cabeçalho; na linha, o programa só entra quando difere dele.
 *
 * A lista só mostra e avisa o que a pessoa pediu: quem aplica a edição é o processo principal, e a lista
 * nova volta pela página. O título longo é cortado pela CSS (reticências), então o texto inteiro fica no
 * DOM e na dica `title`, e o menu fica fora do elemento que encolhe.
 */
export function StepList({
  steps,
  agentName,
  onRename,
  onMove,
  onRemove,
  onViewDescription,
  expandedIds,
  editable = true,
  disabled = false,
}: {
  steps: readonly MissionStepDto[];
  /** Nome do agente do plano, dito uma vez no cabeçalho. */
  agentName: string;
  onRename: (stepId: string, edit: StepRename) => void;
  onMove: (stepId: string, direction: 'up' | 'down') => void;
  onRemove: (stepId: string) => void;
  onViewDescription: (stepId: string) => void;
  /** Tarefas com a descrição aberta. Quem guarda esse estado é o chamador. */
  expandedIds?: ReadonlySet<string> | undefined;
  /** Falso fora do estado planejado: sem alça nem edição, só ler a descrição. */
  editable?: boolean;
  /** Uma chamada em curso: nada da lista aceita ação. */
  disabled?: boolean;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  /** Item do menu que abre um campo ou uma pergunta: o foco vai para ele, não de volta ao "⋯". */
  const keepFocus = useRef(false);
  /** Tarefa cuja alça recebe o foco quando a ordem muda (mover uma linha pode refazer o nó). */
  const refocusHandle = useRef<string | null>(null);
  /** Tarefa cujo "⋯" recebe o foco quando o campo ou a pergunta fecha por ação da pessoa. */
  const refocusTrigger = useRef<string | null>(null);

  const order = steps.map((step) => step.id).join(',');
  // O foco só volta a um controle habilitado: durante a chamada em curso o controle está desabilitado, e o
  // pedido de foco espera o fim dela (o efeito roda de novo quando `disabled` muda) em vez de se perder.
  useEffect(() => {
    const id = refocusHandle.current;
    if (id === null) return;
    const handle = handles.current.get(id);
    if (handle !== undefined && handle.disabled) return;
    refocusHandle.current = null;
    handle?.focus();
  }, [order, disabled]);
  useEffect(() => {
    const id = refocusTrigger.current;
    if (id === null || renamingId !== null || removingId !== null) return;
    const trigger = triggers.current.get(id);
    if (trigger !== undefined && trigger.disabled) return;
    refocusTrigger.current = null;
    // O pedido pode ter ficado pendente (uma chamada recusada ou sem efeito). Se a pessoa já foi para outro
    // campo, o foco é dela: só se move o foco perdido (no corpo da página ou em nenhum elemento).
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    trigger?.focus();
  }, [renamingId, removingId, disabled, order]);
  // Fora do estado planejado não há edição: um renomear ou uma remoção abertos se fecham.
  useEffect(() => {
    if (editable) return;
    setRenamingId(null);
    setRemovingId(null);
  }, [editable]);

  if (steps.length === 0) {
    return <p className="empty">{PLAN_TEXT.empty}</p>;
  }

  function startRename(step: MissionStepDto) {
    if (!editable || disabled) return;
    setDraft(step.title);
    setDraftDescription(step.description ?? '');
    setRemovingId(null);
    setRenamingId(step.id);
  }
  function closeRename() {
    refocusTrigger.current = renamingId;
    setRenamingId(null);
  }
  /** O que mudou no rascunho: o título aparado, e se a descrição difere da gravada. */
  function renameDraft(step: MissionStepDto) {
    const title = draft.trim();
    const description = draftDescription.trim();
    const descriptionChanged = description !== (step.description ?? '').trim();
    const canSave = title !== '' && (title !== step.title || descriptionChanged);
    return { title, description, descriptionChanged, canSave };
  }
  function saveRename(step: MissionStepDto) {
    const { title, description, descriptionChanged, canSave } = renameDraft(step);
    // Enter não passa por controle desabilitado: com a lista parada ou só para leitura, nada é enviado.
    if (disabled || !editable) return;
    // A descrição só vai quando mudou: sem ela, a edição deixa a descrição da tarefa como está.
    if (canSave) onRename(step.id, descriptionChanged ? { title, description } : { title });
    closeRename();
  }
  function onRenameKey(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    step: MissionStepDto,
  ) {
    // Na descrição, Enter é quebra de linha: só o campo do título salva com Enter.
    if (event.key === 'Enter' && event.currentTarget instanceof HTMLInputElement) {
      event.preventDefault();
      saveRename(step);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeRename();
    }
  }
  /** Subir e Descer pelo menu: o foco volta ao "⋯" da linha quando a chamada em curso terminar. */
  function moveFromMenu(stepId: string, direction: 'up' | 'down') {
    refocusTrigger.current = stepId;
    onMove(stepId, direction);
  }
  function onHandleKey(
    event: KeyboardEvent<HTMLButtonElement>,
    step: MissionStepDto,
    index: number,
  ) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? 'up' : 'down';
    if (direction === 'up' ? index === 0 : index === steps.length - 1) return;
    refocusHandle.current = step.id;
    onMove(step.id, direction);
  }

  return (
    <div className="step-list">
      <div className="step-list__head">
        <span className="step-list__heading">{STEP_LIST_TEXT.heading}</span>
        <span className="step-list__agent">{STEP_LIST_TEXT.agent(agentName)}</span>
      </div>
      <ol className="step-list__rows" aria-label={PLAN_TEXT.tableLabel}>
        {steps.map((step, index) => {
          const chip = stepStatus(step.status);
          const program = agentLabel(step.agent);
          const detail = [
            roleLabel(step.role),
            dependencyText(step, steps),
            program === agentName ? undefined : program,
          ]
            .filter((part) => part !== undefined)
            .join(' · ');
          const description = step.description?.trim() ?? '';
          const renaming = renamingId === step.id && editable;
          const expanded = expandedIds?.has(step.id) === true && description !== '';
          const canEdit = editable && !disabled;
          const isFirst = index === 0;
          const isLast = index === steps.length - 1;
          const hasMenu = editable || description !== '';

          return (
            <li key={step.id} className="step-row">
              {editable ? (
                <button
                  type="button"
                  className="btn-ghost step-row__handle"
                  ref={(node) => {
                    if (node === null) handles.current.delete(step.id);
                    else handles.current.set(step.id, node);
                  }}
                  aria-label={STEP_LIST_TEXT.handle(step.title)}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  disabled={disabled}
                  onKeyDown={(event) => onHandleKey(event, step, index)}
                >
                  <span aria-hidden="true">⠿</span>
                </button>
              ) : null}
              <span className="step-row__number">{step.position}</span>
              <StatusChip label={chip.label} tone={chip.tone} />
              <span className="step-row__main">
                {renaming ? (
                  // Título e descrição se editam juntos, como prometia a fatia 2. Fecha por Salvar,
                  // Cancelar, Enter no título ou Escape; sair de um campo para o outro não fecha.
                  <span className="step-row__editor">
                    <input
                      type="text"
                      className="step-row__rename"
                      aria-label={PLAN_TEXT.newName(step.title)}
                      value={draft}
                      maxLength={TITLE_MAX}
                      disabled={disabled}
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => onRenameKey(event, step)}
                    />
                    <textarea
                      className="step-row__rename step-row__rename--description"
                      rows={4}
                      aria-label={PLAN_TEXT.newDescription(step.title)}
                      value={draftDescription}
                      maxLength={DESCRIPTION_MAX}
                      disabled={disabled}
                      onChange={(event) => setDraftDescription(event.target.value)}
                      onKeyDown={(event) => onRenameKey(event, step)}
                    />
                    <span className="step-row__editor-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        aria-label={PLAN_TEXT.saveName(step.title)}
                        disabled={!renameDraft(step).canSave || disabled || !editable}
                        onClick={() => saveRename(step)}
                      >
                        {PLAN_TEXT.save}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        aria-label={PLAN_TEXT.cancelRename(step.title)}
                        onClick={closeRename}
                      >
                        {PLAN_TEXT.cancel}
                      </button>
                    </span>
                  </span>
                ) : (
                  // O duplo clique é um atalho do mouse: o teclado usa o item "Renomear" do menu.
                  <span
                    className="step-row__title"
                    title={step.title}
                    onDoubleClick={() => startRename(step)}
                  >
                    {step.title}
                  </span>
                )}
                {detail === '' ? null : <span className="step-row__detail">{detail}</span>}
                {expanded && !renaming ? (
                  <p className="step-row__description">{description}</p>
                ) : null}
                {removingId === step.id && editable ? (
                  <ConfirmInline
                    question={PLAN_TEXT.removeQuestion(step.title)}
                    confirmLabel={STEP_LIST_TEXT.remove}
                    disabled={disabled}
                    focusBack
                    onConfirm={() => {
                      refocusTrigger.current = null;
                      setRemovingId(null);
                      onRemove(step.id);
                    }}
                    onCancel={() => {
                      refocusTrigger.current = step.id;
                      setRemovingId(null);
                    }}
                  />
                ) : null}
              </span>
              {hasMenu ? (
                <DropdownMenu.Root modal={false}>
                  <DropdownMenu.Trigger
                    className="menu-acoes__gatilho step-row__menu"
                    ref={(node) => {
                      if (node === null) triggers.current.delete(step.id);
                      else triggers.current.set(step.id, node);
                    }}
                    aria-label={STEP_LIST_TEXT.menu(step.title)}
                    disabled={disabled}
                  >
                    ⋯
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="menu-acoes"
                      align="end"
                      sideOffset={6}
                      collisionPadding={8}
                      onCloseAutoFocus={(event) => {
                        if (!keepFocus.current) return;
                        keepFocus.current = false;
                        event.preventDefault();
                      }}
                    >
                      {description === '' ? null : (
                        <DropdownMenu.Item
                          className="menu-acoes__item"
                          onSelect={() => onViewDescription(step.id)}
                        >
                          {expanded
                            ? STEP_LIST_TEXT.hideDescription
                            : STEP_LIST_TEXT.viewDescription}
                        </DropdownMenu.Item>
                      )}
                      {canEdit ? (
                        <>
                          <DropdownMenu.Item
                            className="menu-acoes__item"
                            onSelect={() => {
                              keepFocus.current = true;
                              startRename(step);
                            }}
                          >
                            {STEP_LIST_TEXT.rename}
                          </DropdownMenu.Item>
                          {isFirst ? null : (
                            <DropdownMenu.Item
                              className="menu-acoes__item"
                              onSelect={() => moveFromMenu(step.id, 'up')}
                            >
                              {STEP_LIST_TEXT.moveUp}
                            </DropdownMenu.Item>
                          )}
                          {isLast ? null : (
                            <DropdownMenu.Item
                              className="menu-acoes__item"
                              onSelect={() => moveFromMenu(step.id, 'down')}
                            >
                              {STEP_LIST_TEXT.moveDown}
                            </DropdownMenu.Item>
                          )}
                          <DropdownMenu.Item
                            className="menu-acoes__item menu-acoes__item--perigo"
                            onSelect={() => {
                              keepFocus.current = true;
                              setRenamingId(null);
                              setRemovingId(step.id);
                            }}
                          >
                            {STEP_LIST_TEXT.remove}
                          </DropdownMenu.Item>
                        </>
                      ) : null}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
