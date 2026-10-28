import type { AppResult } from '@project-hub/contracts';
import type { MissionRole, MissionStep } from '@project-hub/domain';
import { failure } from '../result';

/** Tarefa proposta pelo planejador. `dependsOn` são posições a partir de 1, sempre de tarefas anteriores. */
export type PlannedTask = {
  title: string;
  description: string;
  role: MissionRole;
  dependsOn: number[];
};

/** Quantas tarefas um plano pode ter. */
export const MAX_PLAN_TASKS = 12;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * Confere o plano proposto e devolve as tarefas com título e descrição aparados. Como a dependência só
 * aponta para trás, o plano não tem ciclo. A mensagem diz qual tarefa tem o problema, pela posição.
 */
export function validatePlan(tasks: readonly PlannedTask[]): AppResult<PlannedTask[]> {
  if (tasks.length === 0) return failure('VALIDATION_FAILED', 'O plano não tem nenhuma tarefa.');
  if (tasks.length > MAX_PLAN_TASKS) {
    return failure(
      'VALIDATION_FAILED',
      `O plano tem ${tasks.length} tarefas, e o máximo é ${MAX_PLAN_TASKS}.`,
    );
  }

  const cleaned: PlannedTask[] = [];
  for (const [index, task] of tasks.entries()) {
    const position = index + 1;
    const title = task.title.trim();
    const description = task.description.trim();
    if (title === '') {
      return failure('VALIDATION_FAILED', `A tarefa ${position} está sem título.`);
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return failure(
        'VALIDATION_FAILED',
        `O título da tarefa ${position} passa de ${MAX_TITLE_LENGTH} caracteres.`,
      );
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return failure(
        'VALIDATION_FAILED',
        `A descrição da tarefa ${position} passa de ${MAX_DESCRIPTION_LENGTH} caracteres.`,
      );
    }
    for (const dependency of task.dependsOn) {
      if (dependency === position) {
        return failure('VALIDATION_FAILED', `A tarefa ${position} depende dela mesma.`);
      }
      if (dependency > position) {
        return failure(
          'VALIDATION_FAILED',
          `A tarefa ${position} depende da tarefa ${dependency}, que vem depois dela.`,
        );
      }
      if (!Number.isInteger(dependency) || dependency < 1) {
        return failure(
          'VALIDATION_FAILED',
          `A tarefa ${position} depende de uma tarefa que não existe (${dependency}).`,
        );
      }
    }
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      return failure('VALIDATION_FAILED', `A tarefa ${position} repete uma dependência.`);
    }
    cleaned.push({ title, description, role: task.role, dependsOn: [...task.dependsOn] });
  }
  return { ok: true, data: cleaned };
}

/** As etapas da missão a partir do plano validado: ids novos, posição de 1 a n e dependências em ids. */
export function tasksToSteps(
  missionId: string,
  tasks: readonly PlannedTask[],
  newId: () => string,
): MissionStep[] {
  const ids = tasks.map(() => newId());
  return tasks.map((task, index) => ({
    id: ids[index] as string,
    missionId,
    position: index + 1,
    title: task.title,
    description: task.description,
    kind: 'custom',
    status: 'pending',
    dependsOn: task.dependsOn.map((position) => ids[position - 1] as string),
    agent: 'claude-code',
    role: task.role,
  }));
}
