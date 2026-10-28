import type { AppResult } from '@project-hub/contracts';
import { MISSION_AGENTS, type MissionAgent, type MissionStep } from '@project-hub/domain';
import { failure } from '../result';

/** Edição de uma tarefa do plano antes de a missão iniciar. */
export type PlanEdit =
  | { op: 'rename'; title: string; description?: string }
  | { op: 'remove' }
  | { op: 'move'; toPosition: number }
  | { op: 'agent'; agent: MissionAgent };

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;

/** Como a mensagem chama a tarefa: pela posição e pelo título. */
function label(step: MissionStep): string {
  return `${step.position} («${step.title}»)`;
}

/** Posições de 1 a n, na ordem em que as tarefas estão. */
function renumber(steps: readonly MissionStep[]): MissionStep[] {
  return steps.map((step, index) => ({ ...step, position: index + 1 }));
}

/**
 * Aplica uma edição às tarefas do plano e devolve a lista nova, com posições de 1 a n. Função pura: a
 * lista recebida não muda, e os ids das tarefas são mantidos. Quando a edição não vale, devolve
 * `VALIDATION_FAILED` com uma mensagem que cita a tarefa.
 */
export function applyPlanEdit(
  steps: readonly MissionStep[],
  stepId: string,
  edit: PlanEdit,
): AppResult<MissionStep[]> {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((step) => step.id === stepId);
  const target = ordered[index];
  if (target === undefined) {
    return failure('VALIDATION_FAILED', 'A tarefa não está mais neste plano.');
  }
  switch (edit.op) {
    case 'rename':
      return rename(ordered, index, target, edit);
    case 'remove':
      return remove(ordered, index, target);
    case 'move':
      return move(ordered, index, target, edit.toPosition);
    case 'agent':
      return setAgent(ordered, index, target, edit.agent);
    default:
      return failure('VALIDATION_FAILED', 'Esta edição do plano não existe.');
  }
}

function replaceAt(
  ordered: readonly MissionStep[],
  index: number,
  changed: MissionStep,
): AppResult<MissionStep[]> {
  return { ok: true, data: renumber(ordered.map((step, i) => (i === index ? changed : step))) };
}

function rename(
  ordered: readonly MissionStep[],
  index: number,
  target: MissionStep,
  edit: { title: string; description?: string },
): AppResult<MissionStep[]> {
  const title = edit.title.trim();
  if (title === '') {
    return failure('VALIDATION_FAILED', `A tarefa ${label(target)} precisa de um título.`);
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return failure(
      'VALIDATION_FAILED',
      `O título da tarefa ${label(target)} passa de ${MAX_TITLE_LENGTH} caracteres.`,
    );
  }
  const description = edit.description === undefined ? target.description : edit.description.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return failure(
      'VALIDATION_FAILED',
      `A descrição da tarefa ${label(target)} passa de ${MAX_DESCRIPTION_LENGTH} caracteres.`,
    );
  }
  return replaceAt(ordered, index, { ...target, title, description });
}

/** Quem dependia da tarefa removida passa a depender das dependências dela, sem repetir nenhuma. */
function remove(
  ordered: readonly MissionStep[],
  index: number,
  target: MissionStep,
): AppResult<MissionStep[]> {
  if (ordered.length === 1) {
    return failure(
      'VALIDATION_FAILED',
      `A tarefa ${label(target)} é a única do plano e não pode ser removida.`,
    );
  }
  const rest = ordered
    .filter((_, i) => i !== index)
    .map((step) => {
      if (!step.dependsOn.includes(target.id)) return step;
      const rewired = step.dependsOn.flatMap((id) => (id === target.id ? target.dependsOn : [id]));
      return { ...step, dependsOn: [...new Set(rewired)] };
    });
  return { ok: true, data: renumber(rest) };
}

/** Recusa a ordem em que alguma tarefa vem antes de uma tarefa da qual depende (dependentes incluídas). */
function move(
  ordered: readonly MissionStep[],
  index: number,
  target: MissionStep,
  toPosition: number,
): AppResult<MissionStep[]> {
  if (!Number.isInteger(toPosition) || toPosition < 1 || toPosition > ordered.length) {
    return failure(
      'VALIDATION_FAILED',
      `A posição da tarefa ${label(target)} deve estar entre 1 e ${ordered.length}.`,
    );
  }
  const moved = ordered.filter((_, i) => i !== index);
  moved.splice(toPosition - 1, 0, target);

  const seen = new Set<string>();
  for (const step of moved) {
    const late = step.dependsOn.find((id) => !seen.has(id) && ordered.some((s) => s.id === id));
    if (late !== undefined) {
      const dependency = ordered.find((s) => s.id === late) as MissionStep;
      return failure(
        'VALIDATION_FAILED',
        `A tarefa ${label(step)} depende da tarefa ${label(dependency)}, que precisa vir antes dela.`,
      );
    }
    seen.add(step.id);
  }
  return { ok: true, data: renumber(moved) };
}

function setAgent(
  ordered: readonly MissionStep[],
  index: number,
  target: MissionStep,
  agent: MissionAgent,
): AppResult<MissionStep[]> {
  if (!MISSION_AGENTS.includes(agent)) {
    return failure(
      'VALIDATION_FAILED',
      `O programa escolhido para a tarefa ${label(target)} não está disponível.`,
    );
  }
  return replaceAt(ordered, index, { ...target, agent });
}

/** O registro da auditoria `plan.edited`: a operação, o título da tarefa e o que mudou nela. */
export function planEditAudit(edit: PlanEdit, target: MissionStep): Record<string, unknown> {
  switch (edit.op) {
    case 'rename':
      return { op: edit.op, title: edit.title.trim(), previousTitle: target.title };
    case 'move':
      return { op: edit.op, title: target.title, toPosition: edit.toPosition };
    case 'agent':
      return { op: edit.op, title: target.title, agent: edit.agent };
    default:
      return { op: edit.op, title: target.title };
  }
}
