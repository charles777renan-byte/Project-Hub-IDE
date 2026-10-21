import { useEffect, useState } from 'react';
import type { MissionDto, ProjectSummary } from '@project-hub/contracts';

/*
 * Visão geral global (Tarefa 7): conta as missões de todos os projetos para os contadores do
 * cabeçalho. Não há canal novo: o renderer lê `projects.list` e `missions.list` de cada projeto, e
 * refaz a leitura a cada evento de missão (`missions.subscribe`).
 */

export type OverviewItem = { projectId: string; mission: MissionDto };

export type Overview = {
  /** Missões em `running`. */
  running: number;
  /** Missões que esperam a pessoa: `planned`, `waiting_approval` e `waiting_input`. */
  waiting: number;
  /** As missões que entram em `running` ou em `waiting`, na ordem dos projetos. */
  items: OverviewItem[];
  /** Projetos cuja lista de missões falhou nesta leitura. Não zera a contagem dos outros. */
  failedProjects: string[];
  /** Se alguma leitura já chegou. Antes disso, a contagem é desconhecida, não zero. */
  loaded: boolean;
};

const WAITING_STATUSES: ReadonlySet<MissionDto['status']> = new Set([
  'planned',
  'waiting_approval',
  'waiting_input',
]);

const EMPTY: Overview = { running: 0, waiting: 0, items: [], failedProjects: [], loaded: false };

/** Em qual contador a missão cai, ou `null` se nenhum (rascunho, fila, pausa, falha, sucesso, cancelada). */
function countedAs(status: MissionDto['status']): 'running' | 'waiting' | null {
  if (status === 'running') return 'running';
  if (WAITING_STATUSES.has(status)) return 'waiting';
  return null;
}

/** As missões de um projeto, ou `null` se a chamada falhou (resposta com erro ou exceção). */
async function missionsOf(projectId: string): Promise<MissionDto[] | null> {
  try {
    const result = await window.projectHub.missions.list(projectId);
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Lê os projetos e as missões de cada um. Devolve `null` quando nem a lista de projetos vem, para que
 * a tela mantenha a última contagem em vez de mostrar zero por engano.
 */
async function loadOverview(): Promise<Overview | null> {
  let projects: ProjectSummary[];
  try {
    const result = await window.projectHub.projects.list();
    if (!result.ok) return null;
    projects = result.data;
  } catch {
    return null;
  }

  const perProject = await Promise.all(
    projects.map(async (project) => ({
      projectId: project.id,
      missions: await missionsOf(project.id),
    })),
  );

  const overview: Overview = {
    running: 0,
    waiting: 0,
    items: [],
    failedProjects: [],
    loaded: true,
  };
  for (const { projectId, missions } of perProject) {
    if (missions === null) {
      overview.failedProjects.push(projectId);
      continue;
    }
    for (const mission of missions) {
      const kind = countedAs(mission.status);
      if (kind === 'running') overview.running += 1;
      if (kind === 'waiting') overview.waiting += 1;
      if (kind !== null) overview.items.push({ projectId, mission });
    }
  }
  return overview;
}

/**
 * Contagem global das missões. Lê ao montar e refaz a leitura a cada evento de missão. Uma leitura
 * antiga, que chega depois de uma mais nova, não substitui a tela, e a assinatura é cancelada ao
 * desmontar. Sem a API do preload (testes), a contagem fica em zero e nada quebra.
 */
export function useOverview(): Overview {
  const [overview, setOverview] = useState<Overview>(EMPTY);

  useEffect(() => {
    let active = true;
    let latest = 0;

    async function reload() {
      const request = ++latest;
      const next = await loadOverview();
      if (active && request === latest && next !== null) setOverview(next);
    }

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.projectHub.missions.subscribe(() => {
        void reload();
      });
    } catch {
      // Sem a API do preload, a visão fica na leitura que já falhou (contagem zero).
    }
    void reload();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return overview;
}
