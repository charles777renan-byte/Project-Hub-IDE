import { Link } from 'react-router';
import type { MissionDto } from '@project-hub/contracts';
import { missionPath } from '../routes';
import {
  needsAttention,
  requiredActionOf,
  situationOf,
  statusLabel,
  statusTone,
} from '../mission-text';
import { StatusChip } from './StatusChip';

/**
 * Cartão de missão na aba Missões (seção 10.5): nome, situação em uma frase e a ação necessária.
 * Missão que espera a pessoa fica destacada com borda violeta. Missão em execução mostra a barra
 * âmbar. Selecionar o cartão abre o workspace da missão.
 */
export function MissionCard({ mission, projectId }: { mission: MissionDto; projectId: string }) {
  const attention = needsAttention(mission.status);
  const action = requiredActionOf(mission.status);
  const classes = attention ? 'mission-card mission-card--attention' : 'mission-card';
  return (
    <article className={classes}>
      <StatusChip label={statusLabel(mission.status)} tone={statusTone(mission.status)} />
      <h2>
        <Link to={missionPath(projectId, mission.id)}>{mission.title}</Link>
      </h2>
      <p>{situationOf(mission.status)}</p>
      {action === undefined ? null : <p className="mission-card-action">{action}</p>}
      {mission.status === 'running' ? (
        <div className="progress progress--running" aria-hidden="true" />
      ) : null}
    </article>
  );
}
