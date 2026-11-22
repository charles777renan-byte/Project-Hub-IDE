import type { Mission, MissionRole, MissionStep } from '@project-hub/domain';
import { verificationRequest } from './criteria';

/**
 * O prompt com o pedido de verificação no fim: os critérios de aceite da missão, o pedido dos testes e o da
 * linha em que o agente indica os critérios comprovados (`criteria.ts`). É esse pedido que dá à revisão uma
 * verificação para mostrar.
 */
export function withVerification(
  prompt: string,
  mission: Pick<Mission, 'acceptanceCriteria'>,
): string {
  return `${prompt}\n\n${verificationRequest(mission.acceptanceCriteria)}`;
}

/** A primeira mensagem da conversa levada para outra conta, quando o limite da anterior acabou. */
export const RESUME_PROMPT =
  'O limite da conta anterior acabou, e esta conversa continua em outra conta. Continue de onde parou.';

/**
 * O prompt da tentativa que continua, em outra conta, uma tarefa que já tinha começado: serve também quando a
 * conversa não pôde ser levada, porque os arquivos que a tentativa anterior mudou continuam no worktree.
 */
export function continuationPrompt(base: string): string {
  return `${base}\n\nEsta tarefa já tinha começado em outra conta, que ficou sem limite. Os arquivos que a tentativa anterior mudou estão nesta pasta: confira o que já foi feito e continue de onde parou, sem refazer o que está pronto.`;
}

/** Nome do papel como aparece no prompt do agente. */
const ROLE_LABELS: Record<MissionRole, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  database: 'Banco de dados',
  docs: 'Documentação',
  qa: 'QA',
  general: 'Geral',
};

/**
 * As tarefas do plano: etapas com papel. Sem nenhuma, a missão roda numa sessão só, e as etapas
 * acompanham essa sessão (`stepsOfExecution`).
 */
export function tasksOf(steps: readonly MissionStep[]): MissionStep[] {
  return steps.filter((step) => step.role !== undefined);
}

/**
 * As etapas que acompanham uma execução. Com tarefa, é ela. Sem tarefa e num plano sem tarefas (uma etapa
 * por critério, sem papel), são todas as etapas não ignoradas, porque a missão inteira roda nessa sessão.
 * Num plano com tarefas, a sessão sem tarefa é a dos ajustes da revisão, e nenhuma etapa a acompanha.
 */
export function stepsOfExecution(
  steps: readonly MissionStep[],
  stepId: string | undefined,
): MissionStep[] {
  if (stepId !== undefined) return steps.filter((step) => step.id === stepId);
  if (tasksOf(steps).length > 0) return [];
  return steps.filter((step) => step.status !== 'skipped');
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

/**
 * O prompt da tarefa: o objetivo da missão, o papel, o que fazer, o que as tarefas anteriores entregaram e o
 * pedido de verificação.
 */
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
  return withVerification(parts.join('\n\n'), mission);
}
