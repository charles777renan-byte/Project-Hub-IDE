import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import type { MissionDto, ProjectSummary } from '@project-hub/contracts';
import { PROJECTS_CHANGED_EVENT } from './projects-events';

/** Dados da barra lateral: os projetos, e as missões de cada um, na ordem que a API devolve. */
export type SidebarData = {
  status: 'loading' | 'ready' | 'error';
  projects: ProjectSummary[];
  missionsByProject: Record<string, MissionDto[]>;
  message?: string;
};

const LOAD_ERROR = 'Não foi possível carregar os projetos. Tente de novo.';

const LOADING: SidebarData = { status: 'loading', projects: [], missionsByProject: {} };
const FAILED: SidebarData = {
  status: 'error',
  projects: [],
  missionsByProject: {},
  message: LOAD_ERROR,
};

/**
 * Carrega os projetos e, para cada um, as missões. Qualquer resposta com erro falha a carga inteira:
 * a barra mostra a mensagem geral, e a página segue.
 */
async function loadSidebar(): Promise<SidebarData> {
  const projects = await window.projectHub.projects.list();
  if (!projects.ok) return FAILED;

  const lists = await Promise.all(
    projects.data.map((project) => window.projectHub.missions.list(project.id)),
  );
  const missionsByProject: Record<string, MissionDto[]> = {};
  for (const [index, project] of projects.data.entries()) {
    const list = lists[index];
    if (list === undefined || !list.ok) return FAILED;
    missionsByProject[project.id] = list.data;
  }
  return { status: 'ready', projects: projects.data, missionsByProject };
}

/**
 * Dados da barra lateral. Carrega ao montar, de novo a cada evento de missão e a cada troca de rota
 * (um projeto cadastrado na página de Projetos aparece na barra quando a pessoa sai dela). Nenhuma
 * carga é cancelada por um evento seguinte: com eventos seguidos, a barra segue atualizando. Cada
 * carga tem um número, e só mostra o resultado se for mais nova que o que já está na tela. Sem o
 * preload (testes), a barra mostra a mensagem e segue.
 */
export function useSidebarData(): SidebarData {
  const { key } = useLocation();
  const [data, setData] = useState<SidebarData>(LOADING);
  const [reloads, setReloads] = useState(0);
  const started = useRef(0);
  const shown = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const reload = () => setReloads((count) => count + 1);
    window.addEventListener(PROJECTS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.projectHub.missions.subscribe(() => setReloads((count) => count + 1));
    } catch {
      // Sem o preload, a barra não recebe eventos; a carga abaixo mostra o erro.
    }
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    started.current += 1;
    const run = started.current;
    const show = (next: SidebarData) => {
      if (!mounted.current || run < shown.current) return;
      shown.current = run;
      setData(next);
    };
    loadSidebar().then(show, () => show(FAILED));
  }, [key, reloads]);

  return data;
}
