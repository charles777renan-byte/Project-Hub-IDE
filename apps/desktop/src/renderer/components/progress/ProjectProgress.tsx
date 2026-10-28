import { useState } from 'react';
import { Link } from 'react-router';
import type { ProjectSummary } from '@project-hub/contracts';
import { HOME_TEXT } from '../../mission-text';
import { PROGRESS_GROUPS, type ProgressGroup } from '../../progress-data';
import { PROGRESS_TEXT } from '../../progress-text';
import { projectViewPath } from '../../routes';
import { useProjectProgress } from '../../use-project-progress';
import { ActivityFeed } from './ActivityFeed';
import { MissionProgressRow } from './MissionProgressRow';
import { ProgressSummary } from './ProgressSummary';

/**
 * A aba Progresso do projeto, montada: o resumo que filtra, as missões agrupadas (uma linha recolhível por
 * missão) e, ao lado, a atividade recente. Ordem no DOM: resumo, grupos, atividade. A primeira missão em
 * andamento abre expandida; o que a pessoa abre ou recolhe fica em `override`, que vale sobre esse padrão.
 * `project` é `undefined` enquanto a lista da barra lateral não chegou: a frase de vazio e o link para as
 * missões nunca aparecem antes disso, para não dizer que não há nada sem saber.
 */
export function ProjectProgress({
  projectId,
  project,
}: {
  projectId: string;
  project: ProjectSummary | undefined;
}) {
  const { status, items, feed, now } = useProjectProgress(projectId);
  const [active, setActive] = useState<ProgressGroup | undefined>(undefined);
  const [override, setOverride] = useState<Record<string, boolean>>({});

  if (status === 'loading') return <p className="progress-empty">{HOME_TEXT.loading}</p>;
  if (status === 'error') {
    return (
      <p role="alert" className="progress-empty">
        {HOME_TEXT.missionsError}
      </p>
    );
  }

  const firstRunning = items.find((item) => item.group === 'running')?.mission.id;
  const groups = PROGRESS_GROUPS.filter((group) => active === undefined || group === active).map(
    (group) => ({ group, entries: items.filter((item) => item.group === group) }),
  );
  const shown = groups.filter(({ entries }) => entries.length > 0);

  return (
    <div className="progress">
      <div className="progress__main">
        <ProgressSummary items={items} active={active} onChange={setActive} />
        {items.length === 0 ? (
          project === undefined ? null : (
            <div className="progress-empty">
              <p>{PROGRESS_TEXT.empty}</p>
              <Link to={projectViewPath(projectId, 'missoes')} className="progress-empty__action">
                {PROGRESS_TEXT.seeAll}
              </Link>
            </div>
          )
        ) : shown.length === 0 ? (
          <p className="progress-empty">{HOME_TEXT.missionsEmptyFiltered}</p>
        ) : (
          shown.map(({ group, entries }) => (
            <section key={group} className="progress-group">
              <h2 className="progress-group__title">
                {PROGRESS_TEXT.groups[group]}
                <span className="progress-group__count" aria-hidden="true">
                  {entries.length}
                </span>
              </h2>
              <ul className="progress-group__list">
                {entries.map((item) => {
                  const id = item.mission.id;
                  const expanded = override[id] ?? id === firstRunning;
                  return (
                    <li key={id}>
                      <MissionProgressRow
                        item={item}
                        projectId={projectId}
                        expanded={expanded}
                        onToggle={() =>
                          setOverride((previous) => ({ ...previous, [id]: !expanded }))
                        }
                        now={now}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
      <ActivityFeed feed={feed} />
    </div>
  );
}
