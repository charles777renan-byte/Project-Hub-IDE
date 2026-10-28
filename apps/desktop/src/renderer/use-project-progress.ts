import { useEffect, useMemo, useState } from 'react';
import type { MissionDto, MissionViewDto } from '@project-hub/contracts';
import { RELOAD_DELAY_MS } from './overview-data';
import {
  activityFeed,
  groupOf,
  PROGRESS_GROUPS,
  toProgressMission,
  type FeedItem,
  type ProgressGroup,
  type ProgressMission,
} from './progress-data';
import { MAX_PROGRESS_READS } from './use-missions-board';
import { useSidebarData } from './use-sidebar-data';

/** Quantas missões concluídas hoje (as mais recentes) têm a visão lida. As outras mostram só o estado. */
export const MAX_DONE_READS = 10;

/** Quantos itens a atividade recente mostra. */
export const FEED_LIMIT = 12;

/** Intervalo em que `now` avança enquanto há tarefa em execução. */
const NOW_INTERVAL_MS = 30_000;

type Candidate = { mission: MissionDto; group: ProgressGroup };

const byRecent = (a: Candidate, b: Candidate) =>
  b.mission.updatedAt.localeCompare(a.mission.updatedAt);

/**
 * Progresso das missões de um projeto para a aba Progresso. A lista vem da carga compartilhada
 * (`overview-data.ts`), sem chamar `missions.list` de novo. A visão inteira (`missions.get`) é lida das
 * `MAX_PROGRESS_READS` missões em execução, esperando a pessoa ou falhas mais recentes e das
 * `MAX_DONE_READS` concluídas hoje mais recentes; a leitura se repete quando a lista muda e, com um evento
 * de missão, depois de `RELOAD_DELAY_MS` sem novo evento. Uma leitura que falha deixa a missão só com o
 * estado (sem tarefas) e não afeta as outras. `now` avança a cada 30 s enquanto houver tarefa em execução.
 */
export function useProjectProgress(projectId: string): {
  status: 'loading' | 'ready' | 'error';
  items: ProgressMission[];
  feed: FeedItem[];
  now: Date;
} {
  const sidebar = useSidebarData();
  const [views, setViews] = useState<Record<string, MissionViewDto>>({});
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => new Date());

  const candidates = useMemo<Candidate[]>(() => {
    if (sidebar.status !== 'ready') return [];
    return (sidebar.missionsByProject[projectId] ?? []).flatMap((mission) => {
      const group = groupOf(mission, now);
      return group === undefined ? [] : [{ mission, group }];
    });
  }, [sidebar, projectId, now]);

  // As missões cujas visões se leem. A chave não muda quando só a identidade da lista muda (troca de
  // rota, por exemplo), para não repetir até 30 leituras sem motivo.
  const targets = useMemo(() => {
    const open = candidates
      .filter((entry) => entry.group !== 'done')
      .sort(byRecent)
      .slice(0, MAX_PROGRESS_READS);
    const done = candidates
      .filter((entry) => entry.group === 'done')
      .sort(byRecent)
      .slice(0, MAX_DONE_READS);
    return [...open, ...done];
  }, [candidates]);
  const targetsKey = targets
    .map(({ mission }) => `${mission.id}:${mission.status}:${mission.updatedAt}`)
    .join('|');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.projectHub.missions.subscribe(() => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          setNow(new Date());
          setTick((value) => value + 1);
        }, RELOAD_DELAY_MS);
      });
    } catch {
      // Sem o preload (testes), não há eventos: a visão só se lê quando a lista muda.
    }
    return () => {
      unsubscribe?.();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const reads = await Promise.all(
        targets.map(async ({ mission }): Promise<[string, MissionViewDto] | undefined> => {
          try {
            const result = await window.projectHub.missions.get(mission.id);
            return result.ok ? [mission.id, result.data] : undefined;
          } catch {
            return undefined;
          }
        }),
      );
      if (cancelled) return;
      const read = reads.filter((entry): entry is [string, MissionViewDto] => entry !== undefined);
      if (read.length > 0) setViews((previous) => ({ ...previous, ...Object.fromEntries(read) }));
    })();
    return () => {
      cancelled = true;
    };
    // `targets` é derivado de `targetsKey`; depender só da chave evita repetir a leitura sem motivo.
  }, [targetsKey, tick]);

  const items = useMemo<ProgressMission[]>(() => {
    const rank = (group: ProgressGroup) => PROGRESS_GROUPS.indexOf(group);
    return candidates
      .flatMap(({ mission }) => toProgressMission(mission, views[mission.id], now) ?? [])
      .sort(
        (a, b) =>
          rank(a.group) - rank(b.group) || b.mission.updatedAt.localeCompare(a.mission.updatedAt),
      );
  }, [candidates, views, now]);

  const feed = useMemo<FeedItem[]>(
    () =>
      activityFeed(
        items.flatMap((item) => {
          const view = views[item.mission.id];
          return view === undefined ? [] : [view];
        }),
        FEED_LIMIT,
      ),
    [items, views],
  );

  const hasRunningTask = items.some((item) => item.tasks.some((task) => task.status === 'running'));
  useEffect(() => {
    if (!hasRunningTask) return;
    const interval = setInterval(() => setNow(new Date()), NOW_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasRunningTask]);

  return { status: sidebar.status, items, feed, now };
}
