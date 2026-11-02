import { Link } from 'react-router';
import { compactNumber } from '../agent-overview';
import {
  agentLabel,
  boardStatusLabel,
  formatTime,
  HOME_TEXT,
  matchesStatusFilter,
  statusTone,
  type MissionStatusFilter,
} from '../mission-text';
import { useListMotion } from '../list-motion';
import { missionPath } from '../routes';
import type { MissionBoardItem } from '../use-missions-board';
import { StatusChip } from './StatusChip';

export type { MissionStatusFilter } from '../mission-text';

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR');

/**
 * Lista de missões com progresso, um cartão por missão: o título (link para a missão) e o selo do estado na cor
 * dele; a linha "projeto · agente · quando mudou"; a barra das tarefas, tingida pelo tom do estado
 * (`mission-progress__bar--<tom>`); e "4/5 tarefas · 12,4k tokens". Sem tarefas lidas, nem barra nem contagem;
 * sem tokens, só as tarefas. Com `filter`, só as missões daquele estado. Lista vazia (ou sem nada no filtro) não
 * desenha nada: quem chama escolhe a frase. Usada no Início e na visão Missões do projeto. Missão que entra,
 * sai (o filtro) ou muda de lugar se move (`useListMotion`).
 */
export function MissionProgressList({
  items,
  filter,
  showProject = false,
}: {
  items: readonly MissionBoardItem[];
  filter?: MissionStatusFilter;
  /** No Início, de vários projetos: o nome do projeto abre a linha de detalhes. Na visão do projeto, não repete. */
  showProject?: boolean;
}) {
  const motion = useListMotion<HTMLUListElement>();
  const shown =
    filter === undefined
      ? items
      : items.filter((item) => matchesStatusFilter(item.mission.status, filter));
  if (shown.length === 0) return null;
  return (
    <ul ref={motion} className="mission-progress">
      {shown.map(({ mission, projectId, projectName, done, total, tokens, agents }) => {
        const tone = statusTone(mission.status);
        const meta = [
          showProject ? projectName : undefined,
          agents === undefined || agents.length === 0
            ? undefined
            : agents.map((agent) => agentLabel(agent)).join(', '),
          formatTime(mission.updatedAt),
        ].filter((part) => part !== undefined);
        const tasks = total > 0 ? HOME_TEXT.tasks(done, total) : undefined;
        const spent = tokens === undefined || tokens === 0 ? undefined : tokens;
        return (
          <li key={mission.id} className="mission-progress__item">
            <div className="mission-progress__head">
              <Link
                to={missionPath(projectId, mission.id)}
                className="mission-progress__title"
                title={mission.title}
              >
                {mission.title}
              </Link>
              <StatusChip label={boardStatusLabel(mission.status)} tone={tone} />
            </div>
            <p className="mission-progress__meta">{meta.join(' · ')}</p>
            {total > 0 ? (
              <progress
                className={`mission-progress__bar mission-progress__bar--${tone}`}
                value={done}
                max={total}
                aria-label={HOME_TEXT.progressLabel(mission.title, done, total)}
              />
            ) : null}
            {tasks !== undefined || spent !== undefined ? (
              <p className="mission-progress__foot">
                {tasks}
                {tasks !== undefined && spent !== undefined ? ' · ' : null}
                {spent === undefined ? null : (
                  <span title={NUMBER_FORMAT.format(spent)}>
                    <span aria-hidden="true">{HOME_TEXT.tokensShort(compactNumber(spent))}</span>
                    <span className="visually-hidden">
                      {HOME_TEXT.tokensShort(NUMBER_FORMAT.format(spent))}
                    </span>
                  </span>
                )}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
