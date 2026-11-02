import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import type { ProjectSummary, WorkspaceDto } from '@project-hub/contracts';
import markUrl from '../assets/simbolo.png';
import { attentionEntries, attentionProjectIds } from '../attention';
import { ADD_PROJECT_REQUEST_EVENT } from '../projects-events';
import { ROUTE_PATHS, workspacePath } from '../routes';
import { MARKS } from '../state-mark';
import { useTerminals } from '../terminals-data';
import { useSidebarData } from '../use-sidebar-data';
import { previewDrop, stepId, type DropPreview, type TabSlot } from '../workspace-order';
import { showWorkspaceOrder, useOpenWorkspaces } from '../workspaces-data';
import { WORKSPACES_CHANGED_EVENT } from '../workspaces-events';
import { Hint } from './Hint';
import {
  ICON_PROPS,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  X,
} from './Icon';

/** Nome mostrado na aba quando o projeto dela ainda não chegou na lista (ou saiu dela). */
const UNKNOWN_PROJECT = 'Projeto';

/** O arrasto de uma aba: quanto ela andou, a prévia que vale agora e se já foi solta (`settling`: desliza ao lugar). */
type TabDrag = { id: string; x: number; preview: DropPreview; settling: boolean };

/** Quanto o ponteiro anda antes de o gesto virar arrasto: abaixo disso é um clique. */
const DRAG_THRESHOLD = 4;

/** Duração do deslize de uma aba, igual a `--dur` em tokens.css. */
const SETTLE_MS = 180;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Barra superior de 36px, que é também a barra de título da janela (TITLE_BAR_OVERLAY em window.ts):
 * o botão que esconde a barra lateral, a marca, a aba fixa Início (link para `/`, sempre a primeira, sem
 * botão de fechar e fora da reordenação), as abas dos workspaces abertos e o botão que abre outro workspace. O botão
 * que esconde o painel direito é o último: fica no canto, logo antes dos botões do Windows. Arrastar pelo fundo
 * move a janela; abas, botão e menu ficam fora da área de arrastar (workspace.css). Os nomes dos projetos entram sempre como
 * texto. A aba de um projeto que espera a pessoa (terminal em `waiting` ou missão que pede decisão) ganha
 * a marca de atenção, escondida dos leitores de tela, com a descrição "Precisa de você" no link.
 */
export function TopBar({
  sidebarCollapsed = false,
  onToggleSidebar,
  rightCollapsed = false,
  onToggleRight,
}: {
  /** A barra lateral está recolhida: o botão passa a mostrá-la. */
  sidebarCollapsed?: boolean;
  /** Esconde ou mostra a barra lateral. Sem ela, a barra não tem o botão. */
  onToggleSidebar?: () => void;
  /** O painel direito está recolhido: o botão passa a mostrá-lo. */
  rightCollapsed?: boolean;
  /** Esconde ou mostra o painel direito. Sem ela, a barra não tem o botão. */
  onToggleRight?: () => void;
} = {}) {
  const navigate = useNavigate();
  const workspaceMatch = useMatch(ROUTE_PATHS.workspace);
  const { projects, missionsByProject } = useSidebarData();
  const { terminals } = useTerminals();
  const { workspaces, status: loadStatus, message } = useOpenWorkspaces();
  const [problem, setProblem] = useState<string | null>(null);
  // Ordenar as abas com o ponteiro (sem o arrasto nativo do navegador, que traz o ícone e a imagem do sistema).
  // `press` é o gesto em curso, lido pela lógica sem esperar a tela; `drag` só desenha a aba que acompanha o
  // ponteiro e as que abrem espaço. `measured` guarda os lugares de antes do arrasto (`origin` leva o ponteiro
  // para a mesma medida): o destino sai deles, não das abas em movimento. `settling` tira a transição no
  // quadro em que a ordem nova entra, para as abas não saltarem. `focusAfterMove` guarda a aba que volta a ter
  // o foco depois de mover pelo teclado.
  const [drag, setDrag] = useState<TabDrag | null>(null);
  const [settling, setSettling] = useState(false);
  const press = useRef<{
    id: string;
    startX: number;
    moving: boolean;
    cancelled: boolean;
    current: TabDrag | null;
  } | null>(null);
  const measured = useRef<{ origin: number; slots: TabSlot[] } | null>(null);
  // Soltar um arrasto gera um clique no link: ele não pode navegar.
  const suppressClick = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);
  const [announce, setAnnounce] = useState('');
  const tabs = useRef<HTMLElement>(null);
  const focusAfterMove = useRef<string | null>(null);
  // A esquerda de cada aba antes da troca de ordem, para elas deslizarem até o lugar novo.
  const slideFrom = useRef<Map<string, number> | null>(null);

  const names = new Map(projects.map((project) => [project.id, project.name]));
  const nameOf = (workspace: WorkspaceDto) => names.get(workspace.projectId) ?? UNKNOWN_PROJECT;
  const currentProjectId = workspaceMatch?.params.projectId;
  const ids = workspaces.map((workspace) => workspace.id);

  /** Avisa o leitor de tela da posição nova da aba movida. */
  function announceMove(id: string, order: string[]) {
    const workspace = workspaces.find((item) => item.id === id);
    const name = workspace === undefined ? UNKNOWN_PROJECT : nameOf(workspace);
    setAnnounce(`${name}: posição ${order.indexOf(id) + 1} de ${order.length}.`);
  }

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

  /** Cada aba com o seu `li`, lida do DOM na ordem em que aparecem. */
  function tabItems(): { id: string; item: HTMLElement }[] {
    const found: { id: string; item: HTMLElement }[] = [];
    for (const link of tabs.current?.querySelectorAll('[data-workspace-id]') ?? []) {
      const id = link.getAttribute('data-workspace-id');
      const item = link.closest('li');
      if (id !== null && item !== null) found.push({ id, item });
    }
    return found;
  }

  function rememberTabPositions() {
    slideFrom.current = new Map(
      tabItems().map(({ id, item }) => [id, item.getBoundingClientRect().left]),
    );
  }

  /** O ponteiro desceu na aba `id`: o gesto começa, e só vira arrasto depois de andar o limiar. */
  function pressTab(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0 || drag !== null) return;
    press.current = { id, startX: event.clientX, moving: false, cancelled: false, current: null };
    // Com o ponteiro capturado, os movimentos chegam ao link mesmo fora dele, e o cursor é o dele.
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTab(event: ReactPointerEvent<HTMLElement>) {
    const gesture = press.current;
    if (gesture === null || gesture.cancelled) return;
    const dx = event.clientX - gesture.startX;
    if (!gesture.moving) {
      const nav = tabs.current;
      if (Math.abs(dx) < DRAG_THRESHOLD || nav === null) return;
      gesture.moving = true;
      const origin = nav.getBoundingClientRect().left - nav.scrollLeft;
      measured.current = {
        origin,
        slots: tabItems().map(({ id, item }) => {
          const box = item.getBoundingClientRect();
          return { id, left: box.left - origin, width: box.width };
        }),
      };
    }
    const slots = measured.current?.slots ?? [];
    const own = slots.find((slot) => slot.id === gesture.id);
    const first = slots[0];
    const last = slots[slots.length - 1];
    if (own === undefined || first === undefined || last === undefined) return;
    // A aba acompanha o ponteiro sem sair do espaço das abas. O destino sai das bordas dela.
    const x = Math.min(
      Math.max(dx, first.left - own.left),
      last.left + last.width - (own.left + own.width),
    );
    const preview = previewDrop(slots, gesture.id, own.left + x);
    gesture.current = { id: gesture.id, x, preview, settling: false };
    setDrag(gesture.current);
  }

  /** O ponteiro subiu (ou o sistema cancelou o gesto). Um gesto que não passou do limiar é só um clique. */
  function releaseTab(cancel: boolean) {
    const gesture = press.current;
    press.current = null;
    if (gesture === null || !gesture.moving) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (!gesture.cancelled && gesture.current !== null) settleDrag(gesture.current, cancel);
  }

  /** Esc durante o arrasto: a aba volta ao lugar e nada é gravado. */
  function cancelTab() {
    const gesture = press.current;
    if (gesture === null || !gesture.moving || gesture.cancelled || gesture.current === null)
      return;
    gesture.cancelled = true;
    settleDrag(gesture.current, true);
  }

  /**
   * A aba solta desliza até o espaço que abriu e, ao chegar, a ordem é gravada. `cancel` desliza de volta ao lugar
   * de antes e não grava. Sem movimento (pedido do sistema), grava na hora.
   */
  function settleDrag(from: TabDrag, cancel: boolean) {
    const order = cancel ? ids : from.preview.order;
    setDrag({
      id: from.id,
      x: cancel ? 0 : (from.preview.shifts.get(from.id) ?? 0),
      preview: cancel ? { order: ids, shifts: new Map() } : from.preview,
      settling: true,
    });
    const finish = () => {
      measured.current = null;
      setDrag(null);
      if (order.some((id, index) => id !== ids[index])) {
        setSettling(true);
        requestAnimationFrame(() => setSettling(false));
        announceMove(from.id, order);
        void moveTabs(order, false);
      }
    };
    if (prefersReducedMotion()) finish();
    else settleTimer.current = window.setTimeout(finish, SETTLE_MS);
  }

  /**
   * Põe as abas na ordem dada: a tela muda na hora e o processo principal grava. Se ele recusa, a lista volta
   * com a mensagem. Em qualquer caso, a lista é lida de novo, para trazer a posição gravada.
   */
  async function moveTabs(order: string[], slide = true) {
    setProblem(null);
    // Soltar com o mouse não desliza: as abas já estão nos lugares novos pela prévia do arrasto.
    if (slide) rememberTabPositions();
    showWorkspaceOrder(order);
    try {
      const result = await window.projectHub.workspaces.reorder(order);
      if (!result.ok) throw new Error(result.error.message);
    } catch {
      setProblem('Não foi possível mudar a ordem das abas.');
    }
    window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
  }

  // Depois da troca de ordem, cada aba desliza do lugar antigo até o novo (a animação sai se a pessoa pede menos movimento).
  useLayoutEffect(() => {
    const before = slideFrom.current;
    if (before === null) return;
    slideFrom.current = null;
    for (const { id, item } of tabItems()) {
      const from = before.get(id);
      if (from === undefined) continue;
      const shift = from - item.getBoundingClientRect().left;
      if (shift === 0 || prefersReducedMotion()) continue;
      item.animate([{ transform: `translateX(${shift}px)` }, { transform: 'translateX(0)' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      });
    }
  }, [workspaces]);

  // Um deslize em andamento não grava depois de a barra sair da tela.
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // Mover pelo teclado tira o foco da aba (o nó muda de lugar): ela recebe o foco de volta depois da troca.
  useEffect(() => {
    const id = focusAfterMove.current;
    if (id === null) return;
    focusAfterMove.current = null;
    const link = Array.from(tabs.current?.querySelectorAll('[data-workspace-id]') ?? []).find(
      (element) => element.getAttribute('data-workspace-id') === id,
    );
    if (link instanceof HTMLElement) link.focus();
  }, [workspaces]);

  // Um erro de abrir ou fechar vale mais que o da carga; o da carga some na próxima carga que der certo.
  const notice = problem ?? (loadStatus === 'error' ? (message ?? null) : null);
  const openIds = new Set(workspaces.map((workspace) => workspace.projectId));
  // Os projetos que esperam a pessoa: a regra única de `attention.ts`, a mesma da barra lateral e do contador.
  const waitingProjects = attentionProjectIds(
    attentionEntries(
      terminals,
      Object.entries(missionsByProject).flatMap(([projectId, missions]) =>
        missions.map((mission) => ({ projectId, mission })),
      ),
    ),
  );

  return (
    <header className="topbar">
      {onToggleSidebar === undefined ? null : (
        <Hint
          label={
            sidebarCollapsed ? 'Mostrar barra lateral (Ctrl+B)' : 'Ocultar barra lateral (Ctrl+B)'
          }
        >
          <button
            type="button"
            className="topbar__sidebar-toggle"
            aria-label={sidebarCollapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral'}
            aria-expanded={!sidebarCollapsed}
            onClick={onToggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen {...ICON_PROPS} />
            ) : (
              <PanelLeftClose {...ICON_PROPS} />
            )}
          </button>
        </Hint>
      )}
      <p className="topbar__brand">
        <img src={markUrl} alt="" aria-hidden="true" className="topbar__mark" />
        Project Hub
      </p>
      {/* A aba fixa: o NavLink marca a rota `/` com aria-current="page" (`end`, para não valer em todas). */}
      <div className="topbar__tab topbar__home">
        <NavLink to={ROUTE_PATHS.home} end className="topbar__tab-link">
          Início
        </NavLink>
      </div>
      {workspaces.length === 0 ? null : (
        <nav aria-label="Workspaces abertos" className="topbar__tabs" ref={tabs}>
          <ul
            className={
              settling ? 'topbar__tab-list topbar__tab-list--settling' : 'topbar__tab-list'
            }
          >
            {workspaces.map((workspace) => {
              const name = nameOf(workspace);
              const dragged = drag?.id === workspace.id ? drag : null;
              const shift = dragged?.x ?? drag?.preview.shifts.get(workspace.id) ?? 0;
              const attention = waitingProjects.has(workspace.projectId);
              const attentionId = `topbar-attention-${workspace.id}`;
              const classes = ['topbar__tab'];
              if (dragged !== null) classes.push('topbar__tab--dragging');
              if (dragged?.settling === true) classes.push('topbar__tab--dropping');
              return (
                <li
                  key={workspace.id}
                  className={classes.join(' ')}
                  style={shift === 0 ? undefined : { transform: `translateX(${shift}px)` }}
                >
                  {/* O NavLink marca a aba da rota atual com aria-current="page". Arrasta-se pelo link (eventos de ponteiro, não o arrasto nativo); Alt com as setas move pelo teclado. */}
                  <NavLink
                    to={workspacePath(workspace.projectId)}
                    className="topbar__tab-link"
                    title={name}
                    aria-describedby={attention ? attentionId : undefined}
                    data-workspace-id={workspace.id}
                    draggable={false}
                    onPointerDown={(event) => pressTab(event, workspace.id)}
                    onPointerMove={moveTab}
                    onPointerUp={() => releaseTab(false)}
                    onPointerCancel={() => releaseTab(true)}
                    onClick={(event) => {
                      if (suppressClick.current) event.preventDefault();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        cancelTab();
                        return;
                      }
                      if (
                        !event.altKey ||
                        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                      ) {
                        return;
                      }
                      event.preventDefault();
                      const order = stepId(ids, workspace.id, event.key === 'ArrowLeft' ? -1 : 1);
                      if (order === null) return;
                      focusAfterMove.current = workspace.id;
                      announceMove(workspace.id, order);
                      void moveTabs(order);
                    }}
                  >
                    {name}
                    {attention ? (
                      <span className="state-mark state-mark--waiting" aria-hidden="true">
                        {MARKS.waiting.glyph}
                      </span>
                    ) : null}
                  </NavLink>
                  {attention ? (
                    <span id={attentionId} className="visually-hidden">
                      Precisa de você
                    </span>
                  ) : null}
                  <Hint label={`Fechar workspace ${name}`}>
                    <button
                      type="button"
                      className="topbar__close"
                      aria-label={`Fechar workspace ${name}`}
                      onClick={() => void closeWorkspace(workspace)}
                    >
                      <X {...ICON_PROPS} />
                    </button>
                  </Hint>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <OpenWorkspaceMenu
        projects={projects.filter((project) => !openIds.has(project.id))}
        onOpen={(projectId) => void openProject(projectId)}
        onAddProject={() => window.dispatchEvent(new Event(ADD_PROJECT_REQUEST_EVENT))}
      />
      <p role="status" className="visually-hidden">
        {announce}
      </p>
      {notice === null ? null : (
        <p role="alert" className="topbar__error" title={notice}>
          {notice}
        </p>
      )}
      {onToggleRight === undefined ? null : (
        <Hint
          label={
            rightCollapsed
              ? 'Mostrar painel direito (Ctrl+Alt+B)'
              : 'Ocultar painel direito (Ctrl+Alt+B)'
          }
        >
          <button
            type="button"
            className="topbar__right-toggle"
            aria-label={rightCollapsed ? 'Mostrar painel direito' : 'Ocultar painel direito'}
            aria-expanded={!rightCollapsed}
            onClick={onToggleRight}
          >
            {rightCollapsed ? (
              <PanelRightOpen {...ICON_PROPS} />
            ) : (
              <PanelRightClose {...ICON_PROPS} />
            )}
          </button>
        </Hint>
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
      <Hint label="Abrir workspace">
        <button
          ref={button}
          type="button"
          className="topbar__add"
          aria-label="Abrir workspace"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Plus {...ICON_PROPS} />
        </button>
      </Hint>
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
 * a lista chega (uma falha de carga não decide): quem foi para outra página enquanto ela carregava, ou voltar ao Início depois, não é
 * levado de novo.
 */
export function RestoreWorkspace() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { status, workspaces } = useOpenWorkspaces();

  useEffect(() => {
    // Só uma lista carregada decide: depois de uma falha, a próxima carga boa ainda pode restaurar.
    if (restoreDecided || status !== 'ready') return;
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
