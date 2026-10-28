import type {
  ExecutionDto,
  MissionConclusionDto,
  MissionDto,
  MissionEventDto,
  MissionStepDto,
} from '@project-hub/contracts';
import { missionFlow, type FlowState } from '../../mission-flow';

/** A forma de cada estado: a cor sozinha não diz nada, então o desenho e o texto dizem também. */
const MARK: Record<FlowState, string> = { done: '✓', current: '◐', pending: '○', problem: '✕' };

const STATE_TEXT: Record<FlowState, string> = {
  done: 'Concluída',
  current: 'Em curso',
  pending: 'Pendente',
  problem: 'Com problema',
};

/**
 * O caminho da missão, sempre visível acima das abas: Objetivo, Plano, Execução, Verificação e Revisão, cada uma
 * com o estado e uma linha do que está acontecendo (`missionFlow`). A etapa em curso leva `aria-current="step"`.
 * Mostra só o que a missão tem: um agente e etapas em sequência.
 */
export function MissionFlow({
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
}) {
  const nodes = missionFlow({ mission, steps, executions, events, diff, conclusion });
  return (
    <ol className="mission-flow" aria-label="Fluxo da missão">
      {nodes.map((node) => (
        <li
          key={node.id}
          className={`mission-flow__node mission-flow__node--${node.state}`}
          aria-current={node.state === 'current' ? 'step' : undefined}
        >
          <span className="mission-flow__mark" aria-hidden="true">
            {MARK[node.state]}
          </span>
          <span className="mission-flow__text">
            <strong>{node.label}</strong>
            <span className="visually-hidden">{`: ${STATE_TEXT[node.state]}.`}</span>
            <span className="mission-flow__detail">{node.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
