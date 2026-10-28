import { useEffect, useMemo, useState } from 'react';
import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { isEnded } from './mission-text';
import { RELOAD_DELAY_MS } from './overview-data';
import { useSidebarData } from './use-sidebar-data';

/** Quantas missões abertas (as mais recentes) têm as etapas lidas para o progresso. As outras mostram só o estado. */
export const MAX_PROGRESS_READS = 20;

/** Uma missão do quadro: o projeto dela e as tarefas feitas e totais (0/0 quando as etapas não foram lidas). */
export type MissionBoardItem = {
  mission: MissionDto;
  projectId: string;
  projectName: string;
  done: number;
  total: number;
};

type Progress = { done: number; total: number };

/** Só as etapas com papel são tarefas (as outras são apresentação); feita é a que terminou. */
function progressOf(steps: readonly MissionStepDto[]): Progress {
  const tasks = steps.filter((step) => step.role !== undefined);
  return { done: tasks.filter((step) => step.status === 'succeeded').length, total: tasks.length };
}

type Entry = Omit<MissionBoardItem, 'done' | 'total'>;

/**
 * Quadro de missões com progresso: as de todos os projetos ativos (ou só as de `filter.projectId`), as
 * abertas primeiro e, em cada grupo, a mais recente antes. A lista vem da carga compartilhada
 * (`overview-data.ts`), sem chamar `missions.list` de novo. As etapas (`missions.get`) são lidas só das
 * `MAX_PROGRESS_READS` missões abertas mais recentes; a leitura se repete quando a lista muda e, com
 * um evento de missão, depois de `RELOAD_DELAY_MS` sem novo evento. Uma leitura que falha deixa a missão só
 * com o estado. Usado pelo Início e pela visão Missões do projeto.
 */
export function useMissionsBoard(filter?: { projectId?: string }): {
  status: 'loading' | 'ready' | 'error';
  items: MissionBoardItem[];
} {
  const sidebar = useSidebarData();
  const projectId = filter?.projectId;
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [tick, setTick] = useState(0);

  const entries = useMemo<Entry[]>(() => {
    if (sidebar.status !== 'ready') return [];
    const all = sidebar.projects
      .filter((project) => projectId === undefined || project.id === projectId)
      .flatMap((project) =>
        (sidebar.missionsByProject[project.id] ?? []).map((mission) => ({
          mission,
          projectId: project.id,
          projectName: project.name,
        })),
      );
    const byRecent = (a: Entry, b: Entry) => b.mission.updatedAt.localeCompare(a.mission.updatedAt);
    return [
      ...all.filter((entry) => !isEnded(entry.mission.status)).sort(byRecent),
      ...all.filter((entry) => isEnded(entry.mission.status)).sort(byRecent),
    ];
  }, [sidebar, projectId]);

  // As missões cujas etapas se leem. A chave não muda quando só a identidade da lista muda (troca de
  // rota, por exemplo), para não repetir até 20 leituras sem motivo.
  const targets = useMemo(
    () => entries.filter(({ mission }) => !isEnded(mission.status)).slice(0, MAX_PROGRESS_READS),
    [entries],
  );
  const targetsKey = targets
    .map(({ mission }) => `${mission.id}:${mission.status}:${mission.updatedAt}`)
    .join('|');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.projectHub.missions.subscribe(() => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => setTick((value) => value + 1), RELOAD_DELAY_MS);
      });
    } catch {
      // Sem o preload (testes), não há eventos: o progresso só se lê quando a lista muda.
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
        targets.map(async ({ mission }): Promise<[string, Progress] | undefined> => {
          try {
            const result = await window.projectHub.missions.get(mission.id);
            return result.ok ? [mission.id, progressOf(result.data.steps)] : undefined;
          } catch {
            return undefined;
          }
        }),
      );
      if (cancelled) return;
      const read = reads.filter((entry): entry is [string, Progress] => entry !== undefined);
      if (read.length > 0)
        setProgress((previous) => ({ ...previous, ...Object.fromEntries(read) }));
    })();
    return () => {
      cancelled = true;
    };
    // `targets` é derivado de `targetsKey`; depender só da chave evita repetir a leitura sem motivo.
  }, [targetsKey, tick]);

  const items = useMemo<MissionBoardItem[]>(
    () =>
      entries.map((entry) => ({
        ...entry,
        ...(progress[entry.mission.id] ?? { done: 0, total: 0 }),
      })),
    [entries, progress],
  );

  return { status: sidebar.status, items };
}
