import { useId } from 'react';
import { formatTime } from '../../mission-text';
import type { FeedItem } from '../../progress-data';
import { PROGRESS_TEXT } from '../../progress-text';

/**
 * Atividade recente do projeto (o `aside` da aba Progresso): uma lista com a hora e a frase de cada evento,
 * do mais novo para o mais antigo (a ordem vem pronta de `activityFeed`). Os títulos entram como texto.
 */

function phrase(entry: FeedItem): string {
  const task = entry.taskTitle ?? '';
  switch (entry.kind) {
    case 'started':
      return PROGRESS_TEXT.feedStarted(task);
    case 'succeeded':
      return PROGRESS_TEXT.feedSucceeded(task);
    case 'failed':
      return PROGRESS_TEXT.feedFailed(task);
    case 'plan':
      return PROGRESS_TEXT.feedPlan;
  }
}

export function ActivityFeed({ feed }: { feed: readonly FeedItem[] }) {
  const titleId = useId();
  return (
    <aside className="progress__aside" aria-labelledby={titleId}>
      <div className="progress-feed">
        <p id={titleId} className="progress-feed__title">
          {PROGRESS_TEXT.feedTitle}
        </p>
        {feed.length === 0 ? (
          <p className="progress-empty">{PROGRESS_TEXT.feedEmpty}</p>
        ) : (
          <ol className="progress-feed__list">
            {feed.map((entry) => (
              <li
                key={entry.id}
                className={
                  entry.kind === 'failed'
                    ? 'progress-feed__item progress-feed__item--failed'
                    : 'progress-feed__item'
                }
              >
                <time className="progress-feed__time" dateTime={entry.at}>
                  {formatTime(entry.at)}
                </time>
                <span>
                  <span className="progress-feed__what">{phrase(entry)}</span>{' '}
                  <span className="progress-feed__mission">
                    {PROGRESS_TEXT.feedInMission(entry.missionTitle)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
