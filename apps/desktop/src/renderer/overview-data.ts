import type { ApprovalDto, MissionDto, ProjectSummary } from '@project-hub/contracts';
import { needsAttention } from './mission-text';
import { PROJECTS_CHANGED_EVENT } from './projects-events';

/*
 * Carga compartilhada da visão geral (Tarefa 8a). A barra lateral e os contadores do cabeçalho leem a
 * mesma carga, e o Início vai ler quando for ligado (Tarefa 8b): `projects.list`, `missions.list` de cada
 * projeto e, só para as missões em `waiting_approval`, `missions.get` (de onde vêm as aprovações
 * pendentes). O módulo guarda o estado e
 * os ouvintes (usado por `useSyncExternalStore`). A carga, a assinatura de `missions.subscribe` e o
 * ouvinte de `PROJECTS_CHANGED_EVENT` existem uma vez por janela, enquanto houver algum consumidor;
 * quando o último sai, tudo é desfeito e o estado volta ao início.
 */

/** Atraso final (trailing debounce) que junta eventos seguidos numa recarga só. */
export const RELOAD_DELAY_MS = 250;

export type SidebarData = {
  status: 'loading' | 'ready' | 'error';
  projects: ProjectSummary[];
  missionsByProject: Record<string, MissionDto[]>;
  message?: string;
};

export type OverviewItem = { projectId: string; mission: MissionDto };

export type PendingApproval = {
  projectId: string;
  missionId: string;
  missionTitle: string;
  approval: ApprovalDto;
};

export type UnreadApproval = { projectId: string; missionId: string; missionTitle: string };

export type Overview = {
  /** Missões em `running`. */
  running: number;
  /** Missões que esperam a pessoa: `planned`, `waiting_approval` e `waiting_input`. */
  waiting: number;
  /** As missões que entram em `running` ou em `waiting`, na ordem dos projetos. */
  items: OverviewItem[];
  /** As missões em `failed`, na ordem dos projetos. */
  failed: OverviewItem[];
  /** Aprovações pendentes das missões em `waiting_approval` cuja leitura deu certo. */
  approvals: PendingApproval[];
  /** Missões em `waiting_approval` cuja leitura (`missions.get`) falhou: as aprovações delas faltam. */
  unreadApprovals: UnreadApproval[];
  /** Se as leituras de aprovação já terminaram (fase 2 da carga). Antes disso, `approvals` é parcial. */
  approvalsLoaded: boolean;
  /** Projetos cuja lista de missões falhou nesta leitura. Não zera a contagem dos outros. */
  failedProjects: string[];
  /** Se alguma leitura já chegou. Antes disso, a contagem é desconhecida, não zero. */
  loaded: boolean;
};

export type OverviewState = { sidebar: SidebarData; overview: Overview };

const LOAD_ERROR = 'Não foi possível carregar os projetos. Tente de novo.';

const SIDEBAR_LOADING: SidebarData = { status: 'loading', projects: [], missionsByProject: {} };
const SIDEBAR_FAILED: SidebarData = {
  status: 'error',
  projects: [],
  missionsByProject: {},
  message: LOAD_ERROR,
};
const OVERVIEW_EMPTY: Overview = {
  running: 0,
  waiting: 0,
  items: [],
  failed: [],
  approvals: [],
  unreadApprovals: [],
  approvalsLoaded: false,
  failedProjects: [],
  loaded: false,
};

const INITIAL: OverviewState = { sidebar: SIDEBAR_LOADING, overview: OVERVIEW_EMPTY };

/** As missões de um projeto, ou `null` se a chamada falhou (resposta com erro ou exceção). */
async function missionsOf(projectId: string): Promise<MissionDto[] | null> {
  try {
    const result = await window.projectHub.missions.list(projectId);
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

type ApprovalRead =
  { ok: true; approvals: PendingApproval[] } | { ok: false; unread: UnreadApproval };

/** As aprovações pendentes de uma missão; a falha de uma leitura não derruba a carga, mas fica marcada. */
async function approvalsOf(projectId: string, mission: MissionDto): Promise<ApprovalRead> {
  const unread: ApprovalRead = {
    ok: false,
    unread: { projectId, missionId: mission.id, missionTitle: mission.title },
  };
  try {
    const result = await window.projectHub.missions.get(mission.id);
    if (!result.ok) return unread;
    return {
      ok: true,
      approvals: result.data.pendingApprovals.map((approval) => ({
        projectId,
        missionId: mission.id,
        missionTitle: mission.title,
        approval,
      })),
    };
  } catch {
    return unread;
  }
}

/** As leituras de aprovação (fase 2): nunca rejeita. */
async function readApprovals(
  reads: Array<Promise<ApprovalRead>>,
): Promise<Pick<Overview, 'approvals' | 'unreadApprovals'>> {
  const approvals: PendingApproval[] = [];
  const unreadApprovals: UnreadApproval[] = [];
  for (const read of await Promise.all(reads)) {
    if (read.ok) approvals.push(...read.approvals);
    else unreadApprovals.push(read.unread);
  }
  return { approvals, unreadApprovals };
}

/**
 * Resultado de uma carga. `failed`: nem a lista de projetos veio; a barra mostra a mensagem geral e a
 * contagem fica como estava, em vez de zerar por engano. `ok`: a fase 1 (barra e contagem) já está
 * pronta e `approvals` é a fase 2, que ainda pode demorar.
 */
type LoadResult =
  | { kind: 'failed'; sidebar: SidebarData }
  | {
      kind: 'ok';
      sidebar: SidebarData;
      overview: Overview;
      approvals: Promise<Pick<Overview, 'approvals' | 'unreadApprovals'>>;
    };

async function load(): Promise<LoadResult> {
  let projects: ProjectSummary[];
  try {
    const result = await window.projectHub.projects.list();
    if (!result.ok) return { kind: 'failed', sidebar: SIDEBAR_FAILED };
    projects = result.data;
  } catch {
    return { kind: 'failed', sidebar: SIDEBAR_FAILED };
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
    failed: [],
    approvals: [],
    unreadApprovals: [],
    approvalsLoaded: false,
    failedProjects: [],
    loaded: true,
  };
  const missionsByProject: Record<string, MissionDto[]> = {};
  const approvalReads: Array<Promise<ApprovalRead>> = [];
  for (const { projectId, missions } of perProject) {
    if (missions === null) {
      overview.failedProjects.push(projectId);
      continue;
    }
    missionsByProject[projectId] = missions;
    for (const mission of missions) {
      if (mission.status === 'running') overview.running += 1;
      if (needsAttention(mission.status)) overview.waiting += 1;
      if (mission.status === 'running' || needsAttention(mission.status)) {
        overview.items.push({ projectId, mission });
      }
      if (mission.status === 'failed') overview.failed.push({ projectId, mission });
      if (mission.status === 'waiting_approval')
        approvalReads.push(approvalsOf(projectId, mission));
    }
  }

  // A barra segue com a regra antiga: qualquer projeto com erro falha a carga dela inteira.
  const sidebar: SidebarData =
    overview.failedProjects.length > 0
      ? SIDEBAR_FAILED
      : { status: 'ready', projects, missionsByProject };
  return { kind: 'ok', sidebar, overview, approvals: readApprovals(approvalReads) };
}

let state: OverviewState = INITIAL;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
// Cada carga leva um número; `epoch` muda quando o último consumidor sai e invalida as em voo.
// `shown` é a última carga exibida (com dados ou com falha); `shownOk` é a última que trouxe dados.
let started = 0;
let shown = 0;
let shownOk = 0;
let epoch = 0;

function publish(next: OverviewState) {
  state = next;
  for (const listener of [...listeners]) listener();
}

/**
 * Carrega agora. Não cancela a carga em curso: só uma carga mais nova que a exibida aplica o resultado.
 * Duas fases: a barra e a contagem saem assim que as listas chegam, com as aprovações da carga anterior
 * (`approvalsLoaded` falso); as aprovações novas entram depois, se a carga ainda for a última que trouxe
 * dados. Uma carga que falha não invalida a fase 2 de uma carga boa anterior.
 */
function reloadNow() {
  const run = ++started;
  const myEpoch = epoch;
  const apply = (result: LoadResult) => {
    if (myEpoch !== epoch || run < shown) return;
    shown = run;
    if (result.kind === 'failed') {
      publish({ sidebar: result.sidebar, overview: state.overview });
      return;
    }
    shownOk = run;
    publish({
      sidebar: result.sidebar,
      overview: {
        ...result.overview,
        approvals: state.overview.approvals,
        unreadApprovals: state.overview.unreadApprovals,
      },
    });
    void result.approvals.then((read) => {
      // Fase 2: só vale se a época é a mesma e nenhuma carga mais nova trouxe dados.
      if (myEpoch !== epoch || run !== shownOk) return;
      publish({
        sidebar: state.sidebar,
        overview: { ...state.overview, ...read, approvalsLoaded: true },
      });
    });
  };
  load().then(apply, () => apply({ kind: 'failed', sidebar: SIDEBAR_FAILED }));
}

/** Pede uma recarga: eventos seguidos viram uma só, depois de `RELOAD_DELAY_MS` sem novo evento. */
export function scheduleReload() {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    reloadNow();
  }, RELOAD_DELAY_MS);
}

function start(): () => void {
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = window.projectHub.missions.subscribe(scheduleReload);
  } catch {
    // Sem o preload (testes), não há eventos; a carga abaixo cai no estado de erro.
  }
  window.addEventListener(PROJECTS_CHANGED_EVENT, scheduleReload);
  reloadNow();
  return () => {
    unsubscribe?.();
    window.removeEventListener(PROJECTS_CHANGED_EVENT, scheduleReload);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    epoch += 1;
    shown = 0;
    shownOk = 0;
    state = INITIAL;
  };
}

/** Para `useSyncExternalStore`. O primeiro consumidor inicia a carga; o último a desfaz. */
export function subscribeOverview(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stop = start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
    }
  };
}

export function getOverviewState(): OverviewState {
  return state;
}
