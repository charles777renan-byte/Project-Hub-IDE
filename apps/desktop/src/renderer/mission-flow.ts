import type {
  ExecutionDto,
  MissionConclusionDto,
  MissionDto,
  MissionEventDto,
  MissionStepDto,
} from '@project-hub/contracts';
import { verificationSummary } from './mission-text';

/** Onde a missão está em cada etapa do caminho: feita, em curso (ou esperando a pessoa), por vir ou com problema. */
export type FlowState = 'done' | 'current' | 'pending' | 'problem';

export type FlowNodeId = 'objective' | 'plan' | 'execution' | 'verification' | 'review';

export type FlowNode = { id: FlowNodeId; label: string; detail: string; state: FlowState };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "3 arquivos alterados"; com a lista cortada, "50+ arquivos alterados". */
function changedFilesText(count: number, truncated: boolean): string {
  return truncated
    ? `${count}+ arquivos alterados`
    : plural(count, 'arquivo alterado', 'arquivos alterados');
}

/** Situações em que a execução está viva (andando ou esperando algo). */
type ActiveStatus = 'queued' | 'running' | 'waiting_approval' | 'waiting_input' | 'paused';

const ACTIVE_TEXT: Record<ActiveStatus, string> = {
  queued: 'Na fila',
  running: 'Em andamento',
  waiting_approval: 'Aguardando aprovação',
  waiting_input: 'Aguardando sua resposta',
  paused: 'Pausada',
};

/** A tentativa mais recente, ou `undefined` se a missão ainda não rodou. */
function lastAttempt(executions: readonly ExecutionDto[]): ExecutionDto | undefined {
  let last: ExecutionDto | undefined;
  for (const execution of executions) {
    if (last === undefined || execution.attempt > last.attempt) last = execution;
  }
  return last;
}

/**
 * O caminho da missão em cinco etapas, na ordem: objetivo, plano, execução, verificação e revisão. Tudo sai de
 * dados que a missão já tem (situação, etapas, tentativas, testes, arquivos alterados): nada é inventado, e
 * não há papéis nem agentes em paralelo, porque a missão hoje tem um agente e etapas em sequência. O estado
 * de cada nó não depende só de cor: a tela mostra também a forma e o texto.
 */
export function missionFlow({
  mission,
  steps,
  executions,
  events,
  diff,
  conclusion,
}: {
  mission: MissionDto;
  steps: readonly MissionStepDto[];
  executions: readonly ExecutionDto[];
  events: readonly MissionEventDto[];
  diff: { count: number; truncated: boolean } | undefined;
  conclusion: MissionConclusionDto | undefined;
}): FlowNode[] {
  const status = mission.status;
  const beforeStart = status === 'draft' || status === 'planned';
  const stopped = status === 'failed' || status === 'cancelled';
  const concluded = status === 'review' || status === 'succeeded';
  const attempt = lastAttempt(executions);

  // Objetivo: sempre existe.
  const criteria = mission.acceptanceCriteria.length;
  const objective: FlowNode = {
    id: 'objective',
    label: 'Objetivo',
    detail: plural(criteria, 'critério de aceite', 'critérios de aceite'),
    state: 'done',
  };

  // Plano: gerado, esperando a aprovação ou aprovado.
  const finished = steps.filter((step) => step.status === 'succeeded' || step.status === 'skipped');
  const plan: FlowNode =
    status === 'draft'
      ? { id: 'plan', label: 'Plano', detail: 'Ainda não gerado', state: 'current' }
      : status === 'planned'
        ? { id: 'plan', label: 'Plano', detail: 'Aguardando sua aprovação', state: 'current' }
        : {
            id: 'plan',
            label: 'Plano',
            detail:
              steps.length === 0
                ? 'Sem etapas'
                : `${finished.length} de ${steps.length} ${steps.length === 1 ? 'etapa concluída' : 'etapas concluídas'}`,
            state: 'done',
          };

  // Execução: a tentativa mais recente e como ela está.
  const attemptText = attempt === undefined ? '' : `Tentativa ${attempt.attempt} · `;
  let execution: FlowNode;
  if (beforeStart) {
    execution = {
      id: 'execution',
      label: 'Execução',
      detail: 'Ainda não iniciada',
      state: 'pending',
    };
  } else if (stopped) {
    execution = {
      id: 'execution',
      label: 'Execução',
      detail: `${attemptText}${status === 'failed' ? 'Falhou' : 'Cancelada'}`,
      state: 'problem',
    };
  } else if (concluded) {
    execution = {
      id: 'execution',
      label: 'Execução',
      detail: `${attemptText}Concluída`,
      state: 'done',
    };
  } else {
    execution = {
      id: 'execution',
      label: 'Execução',
      detail: `${attemptText}${ACTIVE_TEXT[status as ActiveStatus]}`,
      state: 'current',
    };
  }

  // Verificação: só conta o que os eventos de teste de fato registraram.
  const checked = verificationSummary(events);
  let verification: FlowNode;
  if (checked.kind === 'ran') {
    const failed = checked.failed;
    verification = {
      id: 'verification',
      label: 'Verificação',
      detail: `${checked.passed} de ${checked.total} testes passaram`,
      state: failed ? 'problem' : concluded || stopped ? 'done' : 'current',
    };
  } else {
    verification = {
      id: 'verification',
      label: 'Verificação',
      detail: checked.kind === 'empty' ? 'Sem testes para contar' : 'Nenhum teste rodou',
      state: 'pending',
    };
  }

  // Revisão: a decisão da pessoa e a integração.
  const files =
    diff !== undefined && diff.count > 0
      ? ` · ${changedFilesText(diff.count, diff.truncated)}`
      : '';
  let review: FlowNode;
  if (status === 'review') {
    review = {
      id: 'review',
      label: 'Revisão',
      detail: `Aguardando sua aprovação${files}`,
      state: 'current',
    };
  } else if (status === 'succeeded') {
    const changed =
      conclusion === undefined ? files : ` · ${changedFilesText(conclusion.changedFiles, false)}`;
    review = { id: 'review', label: 'Revisão', detail: `Aprovada${changed}`, state: 'done' };
  } else if (stopped) {
    review = { id: 'review', label: 'Revisão', detail: 'Não chegou à revisão', state: 'pending' };
  } else {
    review = { id: 'review', label: 'Revisão', detail: 'Depois da execução', state: 'pending' };
  }

  return [objective, plan, execution, verification, review];
}
