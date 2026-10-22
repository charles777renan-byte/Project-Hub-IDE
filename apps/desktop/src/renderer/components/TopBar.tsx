import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import type { ProjectSummary, WorkspaceDto } from '@project-hub/contracts';
import { ROUTE_PATHS, workspacePath } from '../routes';
import { useSidebarData } from '../use-sidebar-data';
import { useOpenWorkspaces } from '../workspaces-data';
import { WORKSPACES_CHANGED_EVENT } from '../workspaces-events';

/** Nome mostrado na aba quando o projeto dela ainda não chegou na lista (ou saiu dela). */
const UNKNOWN_PROJECT = 'Projeto';

/**
 * Barra superior de 36px, que é também a barra de título da janela (TITLE_BAR_OVERLAY em window.ts):
 * a marca, as abas dos workspaces abertos, o botão que abre outro workspace e, à direita, o que vier
 * em `status` (os contadores da visão geral). Arrastar pelo fundo move a janela; abas, botão, menu e
 * contadores ficam fora da área de arrastar (workspace.css). Os nomes dos projetos entram sempre como
 * texto.
 */
export function TopBar({ status }: { status?: ReactNode } = {}) {
  const navigate = useNavigate();
  const workspaceMatch = useMatch(ROUTE_PATHS.workspace);
  const { projects } = useSidebarData();
  const { workspaces } = useOpenWorkspaces();
  const [problem, setProblem] = useState<string | null>(null);

  const names = new Map(projects.map((project) => [project.id, project.name]));
  const nameOf = (workspace: WorkspaceDto) => names.get(workspace.projectId) ?? UNKNOWN_PROJECT;
  const currentProjectId = workspaceMatch?.params.projectId;

  async function closeWorkspace(workspace: WorkspaceDto) {
    setProblem(null);
    try {
      const result = await window.projectHub.workspaces.close(workspace.id);
      if (!result.ok) throw new Error(result.error.message);
    } catch {
      setProblem('Não foi possível fechar o workspace.');
      return;
    }
    window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
    if (workspace.projectId !== currentProjectId) return;
    // Era a aba da rota: segue para a vizinha (a da direita; na última, a da esquerda) ou volta ao Início.
    const index = workspaces.findIndex((item) => item.id === workspace.id);
    const neighbour = workspaces[index + 1] ?? workspaces[index - 1];
    void navigate(neighbour === undefined ? ROUTE_PATHS.home : workspacePath(neighbour.projectId));
  }

  async function openProject(projectId: string) {
    setProblem(null);
    try {
      const result = await window.projectHub.workspaces.open(projectId);
      if (!result.ok) throw new Error(result.error.message);
    } catch {
      setProblem('Não foi possível abrir o workspace.');
      return;
    }
    window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
    void navigate(workspacePath(projectId));
  }

  const openIds = new Set(workspaces.map((workspace) => workspace.projectId));

  return (
    <header className="topbar">
      <p className="topbar__brand">
        <span aria-hidden="true" className="topbar__mark" />
        Project Hub
      </p>
      {workspaces.length === 0 ? null : (
        <nav aria-label="Workspaces abertos" className="topbar__tabs">
          <ul className="topbar__tab-list">
            {workspaces.map((workspace) => {
              const name = nameOf(workspace);
              return (
                <li key={workspace.id} className="topbar__tab">
                  {/* O NavLink marca a aba da rota atual com aria-current="page". */}
                  <NavLink
                    to={workspacePath(workspace.projectId)}
                    className="topbar__tab-link"
                    title={name}
                  >
                    {name}
                  </NavLink>
                  <button
                    type="button"
                    className="topbar__close"
                    aria-label={`Fechar workspace ${name}`}
                    onClick={() => void closeWorkspace(workspace)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <OpenWorkspaceMenu
        projects={projects.filter((project) => !openIds.has(project.id))}
        onOpen={(projectId) => void openProject(projectId)}
        onAddProject={() => void navigate(ROUTE_PATHS.projects)}
      />
      {problem === null ? null : (
        <p role="alert" className="topbar__error">
          {problem}
        </p>
      )}
      {status === undefined || status === null ? null : (
        <div className="topbar__status">{status}</div>
      )}
    </header>
  );
}

/**
 * Botão "+" e o menu dos projetos que ainda não têm workspace aberto, mais "Adicionar projeto…". Setas
 * percorrem os itens, Esc fecha e devolve o foco ao botão; clicar fora ou sair com Tab também fecha.
 */
function OpenWorkspaceMenu({
  projects,
  onOpen,
  onAddProject,
}: {
  projects: ProjectSummary[];
  onOpen: (projectId: string) => void;
  onAddProject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const items = () =>
    Array.from(wrapper.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const target = (index: number) => all[(index + all.length) % all.length];
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      target(at + 1)?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      target(at < 0 ? -1 : at - 1)?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      all[all.length - 1]?.focus();
    }
  }

  return (
    <div
      ref={wrapper}
      className="topbar__menu"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="topbar__add"
        aria-label="Abrir workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">+</span>
      </button>
      {open ? (
        <ul role="menu" aria-label="Abrir workspace" className="topbar__menu-list">
          {projects.map((project) => (
            <li key={project.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="topbar__menu-item"
                title={project.name}
                onClick={() => {
                  setOpen(false);
                  onOpen(project.id);
                }}
              >
                {project.name}
              </button>
            </li>
          ))}
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="topbar__menu-item"
              onClick={() => {
                setOpen(false);
                onAddProject();
              }}
            >
              Adicionar projeto…
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/** Se a restauração desta janela já foi decidida. Uma vez por carga da janela, não por montagem. */
let restoreDecided = false;

/** Para os testes: cada um começa com a restauração ainda por decidir. */
export function resetRestoreForTests() {
  restoreDecided = false;
}

/**
 * Sem saída. Quando a janela abre no Início e há workspace aberto, leva para o de atividade mais
 * recente (`replace`, para o Início não ficar atrás no histórico). A decisão sai uma vez só, assim que
 * a lista chega: quem foi para outra página enquanto ela carregava, ou voltar ao Início depois, não é
 * levado de novo.
 */
export function RestoreWorkspace() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { status, workspaces } = useOpenWorkspaces();

  useEffect(() => {
    if (restoreDecided || status === 'loading') return;
    restoreDecided = true;
    if (pathname !== ROUTE_PATHS.home) return;
    let latest: WorkspaceDto | undefined;
    for (const workspace of workspaces) {
      if (latest === undefined || timeOf(workspace) > timeOf(latest)) latest = workspace;
    }
    if (latest !== undefined) void navigate(workspacePath(latest.projectId), { replace: true });
  }, [status, workspaces, pathname, navigate]);

  return null;
}

function timeOf(workspace: WorkspaceDto): number {
  const time = Date.parse(workspace.lastActiveAt);
  return Number.isNaN(time) ? 0 : time;
}
