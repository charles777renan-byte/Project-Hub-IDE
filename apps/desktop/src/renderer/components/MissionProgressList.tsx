import { Link } from 'react-router';
import {
  boardStatusLabel,
  HOME_TEXT,
  matchesStatusFilter,
  statusTone,
  type MissionStatusFilter,
} from '../mission-text';
import { useListMotion } from '../list-motion';
import { missionPath } from '../routes';
import type { MissionBoardItem } from '../use-missions-board';

export type { MissionStatusFilter } from '../mission-text';

/**
 * Lista de missões com progresso, um cartão por missão: o título (link para a missão), "{estado} · 4/5
 * tarefas" (sem tarefas, só o estado), o total de tarefas à direita e a barra de progresso, tingida pelo tom
 * do estado (`mission-progress__bar--<tom>`). Com `filter`, só as missões daquele estado. Lista vazia
 * (ou sem nada no filtro) não desenha nada: quem chama escolhe a frase. Usada no Início e na visão Missões do projeto.
 * Missão que entra, sai (o filtro) ou muda de lugar se move (`useListMotion`).
 */
export function MissionProgressList({
  items,
  filter,
  showProject = false,
}: {
  items: readonly MissionBoardItem[];
  filter?: MissionStatusFilter;
  /** No Início, de vários projetos: o nome do projeto vai antes do estado. Na visão do projeto, não repete. */
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
      {shown.map(({ mission, projectId, projectName, done, total }) => {
        const state = showProject
          ? `${projectName} · ${boardStatusLabel(mission.status)}`
          : boardStatusLabel(mission.status);
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
              {total > 0 ? (
                <span className="mission-progress__count" aria-hidden="true">
                  {total}
                </span>
              ) : null}
            </div>
            <p className="mission-progress__state">
              {total > 0 ? `${state} · ${HOME_TEXT.tasks(done, total)}` : state}
            </p>
            {total > 0 ? (
              <progress
                className={`mission-progress__bar mission-progress__bar--${statusTone(mission.status)}`}
                value={done}
                max={total}
                aria-label={HOME_TEXT.progressLabel(mission.title, done, total)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
