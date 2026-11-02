import { useEffect, useMemo, useState } from 'react';
import type { MissionDto, MissionStepDto, MissionViewDto } from '@project-hub/contracts';
import { isEnded, type AgentId } from './mission-text';
import { RELOAD_DELAY_MS } from './overview-data';
import { useSidebarData } from './use-sidebar-data';

/**
 * Quantas missões têm a visão lida para o progresso, os tokens e o agente: as abertas mais recentes e, depois,
 * as encerradas mais recentes. As outras mostram só o estado.
 */
export const MAX_PROGRESS_READS = 20;

/**
 * Uma missão do quadro: o projeto dela, as tarefas feitas e totais (0/0 quando a visão não foi lida), os tokens
 * gastos (entrada nova mais saída, somados das tentativas; ausente sem leitura ou sem número) e os agentes das
 * tarefas (ausente sem leitura).
 */
export type MissionBoardItem = {
  mission: MissionDto;
  projectId: string;
  projectName: string;
  done: number;
  total: number;
  tokens?: number;
  agents?: AgentId[];
};

type Progress = { done: number; total: number; tokens?: number; agents: AgentId[] };

/**
 * O que o quadro lê da visão: só as etapas com papel são tarefas (as outras são apresentação), e feita é a que
 * terminou; os tokens somam as tentativas que informaram uso; os agentes são os de todas as etapas (missão antiga
 * não tem tarefa com papel, mas tem o agente), sem repetir.
 */
function progressOf(view: Pick<MissionViewDto, 'steps' | 'executions'>): Progress {
  const tasks = view.steps.filter((step: MissionStepDto) => step.role !== undefined);
  const used = view.executions.flatMap((execution) =>
    execution.usage === undefined ? [] : [execution.usage],
  );
  const progress: Progress = {
    done: tasks.filter((step) => step.status === 'succeeded').length,
    total: tasks.length,
    agents: [...new Set(view.steps.map((step) => step.agent))],
  };
  if (used.length > 0)
    progress.tokens = used.reduce((sum, usage) => sum + usage.inputTokens + usage.outputTokens, 0);
  return progress;
}

type Entry = Omit<MissionBoardItem, 'done' | 'total' | 'tokens' | 'agents'>;

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

  // As missões cuja visão se lê: a lista já vem com as abertas antes das encerradas. A chave não muda quando
  // só a identidade da lista muda (troca de rota, por exemplo), para não repetir até 20 leituras sem motivo.
  const targets = useMemo(() => entries.slice(0, MAX_PROGRESS_READS), [entries]);
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
            return result.ok ? [mission.id, progressOf(result.data)] : undefined;
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
