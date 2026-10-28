import type { MissionStepDto } from '@project-hub/contracts';
import { BOARD_TEXT, ROLE_DESCRIPTIONS, agentLabel, roleLabel, roleState } from '../mission-text';

/** Um papel do quadro: as tarefas dele, na ordem do plano, e a posição da primeira. */
type RoleGroup = {
  role: NonNullable<MissionStepDto['role']>;
  steps: MissionStepDto[];
};

/** Agrupa as tarefas com papel por papel, na ordem em que a primeira tarefa de cada papel aparece. */
function groupByRole(steps: readonly MissionStepDto[]): RoleGroup[] {
  const groups = new Map<RoleGroup['role'], RoleGroup>();
  for (const step of [...steps].sort((a, b) => a.position - b.position)) {
    if (step.role === undefined) continue;
    const group = groups.get(step.role);
    if (group === undefined) groups.set(step.role, { role: step.role, steps: [step] });
    else group.steps.push(step);
  }
  return [...groups.values()];
}

/**
 * Quadro do orquestrador, só leitura, acima da tabela de tarefas: o orquestrador principal, um cartão por
 * papel que tem tarefas, em duas colunas (nome do papel, programa à direita, uma linha sobre o papel e o
 * estado resumido), e a integração e entrega, com "aguardando tarefas" ou o estado. As setas entre as
 * camadas são decorativas. O programa e o estado são texto; a cor só os reforça. Sem tarefa com papel,
 * não mostra nada.
 */
export function OrchestratorBoard({ steps }: { steps: readonly MissionStepDto[] }) {
  const groups = groupByRole(steps);
  if (groups.length === 0) return null;
  const delivery = roleState(steps.map((step) => step.status));

  return (
    <section className="orchestrator-board" aria-label={BOARD_TEXT.label}>
      <div className="orchestrator-board__card orchestrator-board__lead">
        <h3>{BOARD_TEXT.orchestrator}</h3>
        <p>{BOARD_TEXT.orchestratorDescription}</p>
      </div>
      <span className="orchestrator-board__arrow" aria-hidden="true">
        ↓
      </span>
      <ul className="orchestrator-board__roles">
        {groups.map(({ role, steps: roleSteps }) => {
          const agents = [...new Set(roleSteps.map((step) => step.agent))];
          const state = roleState(roleSteps.map((step) => step.status));
          // O contorno na cor do programa só vale quando o papel usa um programa só.
          const single = agents.length === 1 ? agents[0] : undefined;
          return (
            <li key={role}>
              <div
                className={`orchestrator-board__card${
                  single === undefined ? '' : ` orchestrator-board__card--${single}`
                }`}
              >
                <div className="orchestrator-board__head">
                  <h3>{roleLabel(role)}</h3>
                  <span
                    className={`orchestrator-board__program${
                      single === undefined ? '' : ` orchestrator-board__program--${single}`
                    }`}
                  >
                    {agents.map((agent) => agentLabel(agent)).join(' · ')}
                  </span>
                </div>
                <p className="orchestrator-board__description">{ROLE_DESCRIPTIONS[role]}</p>
                <p className={`orchestrator-board__status orchestrator-board__status--${state}`}>
                  {BOARD_TEXT.state[state]}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <span className="orchestrator-board__arrow" aria-hidden="true">
        ↓
      </span>
      <div className="orchestrator-board__card orchestrator-board__delivery">
        <h3>{BOARD_TEXT.delivery}</h3>
        <p>{BOARD_TEXT.deliveryDescription}</p>
        <p className={`orchestrator-board__status orchestrator-board__status--${delivery}`}>
          {BOARD_TEXT.deliveryState[delivery]}
        </p>
      </div>
    </section>
  );
}
