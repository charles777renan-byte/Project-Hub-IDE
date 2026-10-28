import type { Mission, MissionRole, MissionStep } from '@project-hub/domain';

/** Nome do papel como aparece no prompt do agente. */
const ROLE_LABELS: Record<MissionRole, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Banco de dados',
  docs: 'Documentação',
  qa: 'QA',
  general: 'Geral',
};

/** As tarefas do plano: etapas com papel. Sem nenhuma, a missão roda numa sessão só. */
export function tasksOf(steps: readonly MissionStep[]): MissionStep[] {
  return steps.filter((step) => step.role !== undefined);
}

/**
 * A próxima tarefa a rodar: a primeira, na ordem do plano, que ainda não terminou e cujas
 * dependências todas terminaram. `justDone` conta como concluída, para decidir se há continuação antes
 * de gravar o fim da tarefa atual. Uma tarefa que ficou `running` ou `failed` volta a ser a próxima.
 */
export function nextTask(
  steps: readonly MissionStep[],
  justDone?: string,
): MissionStep | undefined {
  const tasks = tasksOf(steps);
  const done = new Set(tasks.filter((task) => task.status === 'succeeded').map((task) => task.id));
  if (justDone !== undefined) done.add(justDone);
  return tasks.find(
    (task) =>
      !done.has(task.id) && task.status !== 'skipped' && task.dependsOn.every((id) => done.has(id)),
  );
}

/** O prompt da tarefa: o objetivo da missão, o papel, o que fazer e o que as tarefas anteriores entregaram. */
export function taskPrompt(
  mission: Mission,
  task: MissionStep,
  steps: readonly MissionStep[],
): string {
  const role = task.role === undefined ? ROLE_LABELS.general : ROLE_LABELS[task.role];
  const finished = tasksOf(steps).filter((other) => other.status === 'succeeded');
  const parts = [
    mission.objective,
    `Sua tarefa (${role}): ${task.title}`,
    ...(task.description.trim() === '' ? [] : [task.description.trim()]),
  ];
  if (finished.length > 0) {
    parts.push(
      `Tarefas já concluídas neste mesmo worktree:\n${finished.map((other) => `- ${other.title}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}
