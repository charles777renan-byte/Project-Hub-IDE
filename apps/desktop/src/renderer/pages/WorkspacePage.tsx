import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { LAYOUT_LIMITS } from '@project-hub/contracts/layout-limits';
import {
  LAYOUT_PRESETS,
  PRESET_SLOTS,
  presetLayout,
  neighbourAt,
  removeLeaf,
  splitLeaf,
  type LayoutPreset,
} from '@project-hub/contracts/layout-ops';
import type { LayoutLeaf, ProviderId, ProviderInfo } from '@project-hub/contracts';
import { ConfirmInline } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { TopographicBackground } from '../components/TopographicBackground';
import { ICON_PROPS, SquareTerminal, Undo2 } from '../components/Icon';
import { ProviderIcon } from '../components/ProviderIcon';
import { ProjectProgress } from '../components/progress/ProjectProgress';
import { PathText } from '../components/PathText';
import { PROJECT_UNAVAILABLE_NOTICE_ID, ProjectHeader } from '../components/project/ProjectHeader';
import { ProjectMissions } from '../components/project/ProjectMissions';
import { ProjectSettings } from '../components/project/ProjectSettings';
import { WorktreesTab } from '../components/WorktreesTab';
import { PROJECT_TEXT } from '../mission-text';
import { notify } from '../notify';
import { MissionPage } from './MissionPage';
import { projectPanelId, projectViewFromParams, type ProjectView } from '../project-views';
import { projectViewPath, ROUTE_PATHS } from '../routes';
import { useSidebarData } from '../use-sidebar-data';
import { hideTerminal, unhideTerminal, useTerminals } from '../terminals-data';
import {
  clearCloseAllRequest,
  closeAllQuestion,
  setPaneCount,
  useCloseAllRequest,
} from '../workspace/close-all';
import { PaneTabs, paneTabId } from '../workspace/PaneTabs';
import { PaneTree } from '../workspace/PaneTree';
import { dockedLayout } from '../workspace/pane-drag';
import { PaneView, type SplitSide } from '../workspace/PaneView';
import { layoutFits, PANE_MIN_HEIGHT, PANE_MIN_WIDTH, pickVisible } from '../workspace/layout-fit';
import { useLeafHosts } from '../workspace/leaf-hosts';
import { leavesOf } from '../workspace/layout-model';
import { layoutShortcut } from '../workspace/layout-shortcuts';
import {
  LEAVE_FALLBACK_MS,
  paneMotionOff,
  useEnteringLeaves,
  type PaneMotion,
} from '../workspace/pane-motion';
import { providerShortcutIndex } from '../workspace/provider-shortcuts';
import { isIdle, useActivity } from '../sidebar-activity';
import { neighbourOf, stepSolo } from '../workspace/solo';
import { useAreaSize } from '../workspace/use-area-size';
import { usePaneDrag } from '../workspace/use-pane-drag';
import { useWorkspace } from '../workspace/use-workspace';
import {
  LIMIT_HINT,
  WorkspaceToolbar,
  type PaneLayoutMode,
  type PresetOption,
} from '../workspace/WorkspaceToolbar';

const NO_ROOM_HINT = 'Sem espaço para dividir este painel';
const PRESET_NO_ROOM_HINT = 'Não cabe nesta janela com o mínimo de cada terminal';
/** Quanto tempo o aviso "Layout alterado · Desfazer" fica na tela. */
export const UNDO_NOTICE_MS = 6000;

/** O nome de cada layout pronto, para `count` painéis depois de aplicado. */
function presetLabel(preset: LayoutPreset, count: number): string {
  switch (preset) {
    case 'side-by-side':
      return 'Lado a lado';
    case 'main-stack':
      return `1 grande + ${count - 1}`;
    case 'grid':
      return count <= 4 ? 'Grade 2 × 2' : 'Grade';
    case 'three-columns':
      return '3 colunas';
  }
}

/**
 * O aviso de que os painéis mudaram de lugar, com o botão que desfaz. `token` muda a cada movimento: o aviso some
 * sozinho depois de `UNDO_NOTICE_MS` (o mouse em cima o segura) e volta no movimento seguinte. Desfazer pelo teclado
 * (Ctrl+Z fora do terminal) continua valendo depois que ele some.
 */
function UndoNotice({ token, onUndo }: { token: number; onUndo(): void }) {
  const [hiddenToken, setHiddenToken] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => setHiddenToken(token), UNDO_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [token, held]);
  if (hiddenToken === token) return null;
  return (
    <div
      className="workspace__undo"
      role="status"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      <span>Layout alterado</span>
      <button type="button" onClick={onUndo}>
        <Undo2 {...ICON_PROPS} />
        Desfazer
      </button>
    </div>
  );
}

const PROVIDERS_ERROR = 'Não foi possível carregar os programas disponíveis.';
const UNAVAILABLE_NOTICE =
  'A pasta deste projeto não está disponível. Ela pode ter sido movida ou apagada.';
const UNAVAILABLE_REASON = 'A pasta do projeto não está disponível.';
/**
 * Quantos painéis o modo foco guarda montados quando a grade ainda não foi vista (a janela já abriu pequena). Com a
 * grade vista, vale o que ela mostrava: os mesmos terminais, nem mais nem menos contextos WebGL.
 */
const TABS_KEEP_DEFAULT = 4;

/** Lê o id da sessão que a barra lateral pediu para mostrar, se o estado da rota traz um. */
function requestedTerminal(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const id = (state as { showTerminal?: unknown }).showTerminal;
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * A aba do projeto (`/workspaces/:projectId?visao=...`): o cabeçalho de uma linha com as visões e, abaixo, a
 * visão escolhida. Terminais (a padrão) é o workspace de painéis; Missões é a lista de missões do projeto e o
 * formulário Nova missão; Progresso mostra o resumo, as missões agrupadas com a linha do tempo das tarefas e a
 * atividade recente; Worktrees e Configurações mostram a lista e os formulários do projeto. Os terminais
 * ficam sempre montados (só escondidos nas outras visões): trocar de visão não recarrega o workspace nem refaz
 * os terminais. As outras visões só são montadas enquanto ativas. Projeto arquivado ou removido com a aba aberta
 * mostra a mensagem e o link para o Início.
 *
 * Uma missão aberta (`/workspaces/:projectId/missoes/:missionId`) ocupa o painel das Missões, no lugar da
 * lista, e o cabeçalho segue na tela com Missões como visão ativa. É a mesma rota (a do `/*`), então a
 * página não é remontada e os terminais continuam montados, escondidos. O "← Missões" da missão volta à lista.
 */
export function WorkspacePage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const missionId = useMatch(ROUTE_PATHS.missionDetail)?.params.missionId;
  const view = missionId === undefined ? projectViewFromParams(params) : 'missoes';
  const sidebar = useSidebarData();
  const project = sidebar.projects.find((item) => item.id === projectId);
  // As ferramentas dos terminais vão para o cabeçalho (uma faixa a menos), por portal num nó fixo que só muda de pai:
  // o cabeçalho de verdade ou, enquanto ele não existe, o de reserva. Assim a barra nunca é recriada (nem fecha o menu).
  const [toolsHost] = useState(() => {
    const host = document.createElement('div');
    host.className = 'project-header__tools-host';
    return host;
  });
  const attachTools = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot !== null && toolsHost.parentElement !== slot) slot.append(toolsHost);
    },
    [toolsHost],
  );
  // Pasta que sumiu: o aviso sai acima de todas as visões e os terminais não abrem. Sem o campo, vale disponível.
  const unavailable = project?.available === false;
  // Só some a tela quando a lista chegou inteira e o projeto não está nela; carregando ou com falha
  // de leitura, o workspace abre e o processo principal recusa o que não existe.
  if (sidebar.status === 'ready' && project === undefined) {
    return (
      <div className="workspace-missing">
        <p>{PROJECT_TEXT.notFound}</p>
        <Link to={ROUTE_PATHS.home}>{PROJECT_TEXT.backHome}</Link>
      </div>
    );
  }
  return (
    <div className="project-tab">
      {project === undefined ? (
        // Reserva enquanto a lista de projetos não chegou (ou falhou): as ferramentas dos terminais seguem à mão.
        <header className="project-header">
          <div className="project-header__row">
            <div className="project-header__tools" ref={attachTools} />
          </div>
        </header>
      ) : (
        <ProjectHeader
          project={project}
          missionOpen={missionId !== undefined}
          toolsRef={attachTools}
          onNewMission={() =>
            navigate(projectViewPath(projectId, 'missoes'), { state: { newMission: true } })
          }
        />
      )}
      {project !== undefined && unavailable ? (
        <p role="alert" className="page-alert" id={PROJECT_UNAVAILABLE_NOTICE_ID}>
          {UNAVAILABLE_NOTICE} Caminho esperado: <PathText path={project.path} />
        </p>
      ) : null}
      <ProjectPanel view="terminais" active={view} labelled={project !== undefined}>
        <div className="project-tab__terminals">
          <WorkspaceBody
            key={projectId}
            projectId={projectId}
            visible={view === 'terminais'}
            toolsHost={toolsHost}
            {...(unavailable ? { unavailableReason: UNAVAILABLE_REASON } : {})}
          />
        </div>
      </ProjectPanel>
      <ProjectPanel
        view="missoes"
        active={view}
        labelled={project !== undefined}
        mission={missionId !== undefined}
      >
        {missionId !== undefined ? (
          <MissionPage missionId={missionId} />
        ) : view === 'missoes' ? (
          <ProjectMissions projectId={projectId} project={project} />
        ) : null}
      </ProjectPanel>
      <ProjectPanel view="progresso" active={view} labelled={project !== undefined}>
        {view === 'progresso' ? <ProjectProgress projectId={projectId} project={project} /> : null}
      </ProjectPanel>
      <ProjectPanel view="worktrees" active={view} labelled={project !== undefined}>
        {view === 'worktrees' ? <WorktreesTab projectId={projectId} /> : null}
      </ProjectPanel>
      <ProjectPanel view="configuracoes" active={view} labelled={project !== undefined}>
        {view === 'configuracoes' && project !== undefined ? (
          <ProjectSettings project={project} />
        ) : null}
      </ProjectPanel>
    </div>
  );
}

/**
 * O painel de uma visão (`role="tabpanel"`, o `aria-controls` da aba dela). Os cinco existem sempre; só o da
 * visão ativa aparece (`hidden` nos outros). O conteúdo de cada um é montado só quando a visão está ativa,
 * menos os terminais: o dono dele os mantém montados, para que uma espiada em Configurações não derrube os
 * painéis, o xterm e o estado do workspace.
 */
function ProjectPanel({
  view,
  active,
  labelled,
  mission = false,
  children,
}: {
  view: ProjectView;
  active: ProjectView;
  /** Com o cabeçalho na tela, a aba da visão existe e nomeia o painel. */
  labelled: boolean;
  /** Com uma missão aberta no painel das Missões, ele não tem respiro e quem rola é a missão. */
  mission?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={projectPanelId(view)}
      {...(labelled ? { 'aria-labelledby': `tab-${view}` } : {})}
      hidden={view !== active}
      className={`project-tab__panel project-tab__panel--${view}${mission ? ' project-tab__panel--mission' : ''}`}
    >
      {children}
    </div>
  );
}

function WorkspaceBody({
  projectId,
  visible,
  toolsHost,
  unavailableReason,
}: {
  projectId: string;
  /** O nó das ferramentas no cabeçalho do projeto: a barra vai para lá por portal, só com a visão Terminais à vista. */
  toolsHost: HTMLElement;
  /** Os terminais ficam montados, mas escondidos nas outras visões; escondido, o estado vazio não anima o fundo. */
  visible: boolean;
  /** A pasta do projeto sumiu: a barra não abre terminal e a dica mostra este motivo. */
  unavailableReason?: string;
}) {
  const workspace = useWorkspace(projectId);
  // A pasta sumida desabilita também iniciar e reiniciar nos painéis (o motivo vem com `unavailableReason`).
  const unavailable = unavailableReason !== undefined;

  const { terminals, loaded, reload } = useTerminals();
  // Sessão viva e parada há algumas leituras: a marca dela vira o ponto vazado "Ocioso" (painel, aba e ficha).
  const activity = useActivity(terminals);
  const idleIds = new Set(
    terminals.filter((item) => isIdle(activity.get(item.id))).map((item) => item.id),
  );
  const location = useLocation();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  // Depois de fechar o último painel o foco vai para a barra (senão cairia no body).
  const [toolbarFocus, setToolbarFocus] = useState(0);
  const hadPanes = useRef(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  // Painéis que estão fechando: somem da tela já, antes da resposta do processo principal.
  const [closing, setClosing] = useState<ReadonlySet<string>>(new Set());
  // Painéis encolhendo antes de fechar (pane-motion.ts): a ref barra o segundo clique antes de o estado chegar.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const leavingRef = useRef(new Set<string>());
  // O prazo da saída chama a versão da última pintura, não a do clique.
  const finishLeavingRef = useRef<(leafId: string) => void>(() => {});
  const consumed = useRef<string | null>(null);
  // Abrir um painel é um pedido por vez: a ref barra o segundo clique antes de o estado chegar.
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  // Modo foco ("um painel por vez", com os outros em abas): só na tela, não muda o layout guardado.
  const [soloOn, setSoloOn] = useState(false);
  // Os nós do conteúdo de cada painel (leaf-hosts.ts): a grade e o modo Abas mostram os mesmos, sem recriar o terminal.
  const hosts = useLeafHosts();
  // Onde ficam, escondidos e montados, os painéis que o modo Abas guarda sem mostrar.
  const parkingRef = useRef<HTMLDivElement>(null);
  // Os painéis montados na última pintura e quantos o modo Abas guarda (o que cabia na grade da última vez).
  const mountedIds = useRef<readonly string[]>([]);
  const keptInTabs = useRef(TABS_KEEP_DEFAULT);
  // Depois de cada pintura: quem saiu da lista de montados perde o nó; quem está montado sem lugar na tela (no modo
  // Abas, os que não são a aba à vista) vai para o estacionamento escondido.
  useLayoutEffect(() => {
    const keep = new Set(mountedIds.current);
    hosts.prune(keep);
    const parking = parkingRef.current;
    if (parking === null) return;
    for (const id of keep) {
      const host = hosts.hostOf(id);
      if (!host.isConnected) parking.append(host);
    }
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.projectHub.providers.list();
        if (cancelled) return;
        if (result.ok) setProviders(result.data);
        else notify.error(PROVIDERS_ERROR);
      } catch {
        // Sem a lista, os painéis mostram o rótulo do provedor e deixam o botão habilitado.
        if (!cancelled) notify.error(PROVIDERS_ERROR);
      }
      if (!cancelled) setProvidersLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pedido da barra lateral: vale uma vez por navegação. O estado da rota é limpo logo depois.
  const wanted = requestedTerminal(location.state);
  const ready = workspace.state.status === 'ready';
  const currentLayout =
    workspace.state.status === 'ready' ? workspace.state.workspace.layout : undefined;
  const { entering, settle } = useEnteringLeaves(currentLayout);

  // A área da grade, medida por `ResizeObserver`. O `ref` é um objeto novo a cada elemento: a área só existe depois do
  // carregamento (antes dele a página mostra só o aviso), e o efeito do `useAreaSize` precisa rodar de novo quando ela
  // chega. Medida zerada (a visão do projeto escondida, `display: none`) não vale: a grade fica como estava.
  const [areaElement, setAreaElement] = useState<HTMLDivElement | null>(null);
  const areaRef = useMemo(() => ({ current: areaElement }), [areaElement]);
  const measured = useAreaSize(areaRef);
  const lastSize = useRef<{ width: number; height: number } | null>(null);
  if (measured !== null && measured.width > 0 && measured.height > 0) lastSize.current = measured;
  const size = lastSize.current;
  const { setArea } = workspace;
  useEffect(() => {
    setArea(size);
  }, [setArea, size]);

  // O layout da pessoa, sem os painéis que estão fechando: o mesmo que o servidor vai devolver (o vizinho de quem sai
  // fica com o espaço).
  const shown = useMemo(() => {
    let tree = currentLayout ?? null;
    for (const leafId of closing) tree = removeLeaf(tree, leafId);
    return tree;
  }, [currentLayout, closing]);
  const shownLeaves = useMemo(() => leavesOf(shown), [shown]);
  // A janela ficou pequena demais para o layout (algum painel ficaria abaixo do mínimo): modo foco, com um painel
  // grande e os outros em abas. O layout guardado não muda, e volta sozinho quando couber. Sem medida, nada é decidido.
  const soloAuto = size !== null && shown !== null && !layoutFits(shown, size);

  // Arrastar um painel pela alça: no meio de outro, os dois trocam de lugar (cada um fica com o tamanho do lugar);
  // junto de uma borda, o arrastado encaixa ali e o destino cede metade. O encaixe que deixaria algum painel abaixo
  // do mínimo, ou que não mudaria nada, não é destino.
  const paneDrag = usePaneDrag({
    area: areaElement,
    accepts: (sourceId, zone) => {
      if (zone.spot === 'center') return true;
      if (shown === null) return false;
      const next = dockedLayout(shown, sourceId, zone.targetId, zone.spot, () => '\u0000dock');
      return next !== null && (size === null || layoutFits(next, size));
    },
    onDrop: (sourceId, zone) => {
      if (zone.spot === 'center') workspace.swap(sourceId, zone.targetId);
      else workspace.dock(sourceId, zone.targetId, zone.spot);
      workspace.activateWithFocus(sourceId);
    },
  });
  const drag = paneDrag.drag;
  const dragged = drag === null ? undefined : shownLeaves.find((leaf) => leaf.id === drag.sourceId);

  // O modo foco da tela: o que a pessoa ligou (maximizar, "Abas") ou o que o tamanho da janela pede. O `soloOn` dela
  // não é tocado pelo automático, então alargar a janela devolve o que ela tinha.
  const soloEffective = soloOn || soloAuto;
  const gridTree = shown;

  // Fechar todos: o cabeçalho publica o pedido num store (workspace/close-all.ts) e este workspace pergunta. Quantos
  // painéis há, quantas sessões avulsas vivas o fechamento encerra e quantos painéis são de missão (que só saem do
  // painel). Os painéis que já estão fechando não contam: já saíram da tela.
  const closeAllCounts = useMemo(() => {
    let sessions = 0;
    let missions = 0;
    for (const leaf of shownLeaves) {
      const session =
        leaf.terminalId === null
          ? undefined
          : terminals.find((item) => item.id === leaf.terminalId);
      if (session === undefined) continue;
      if (session.missionId !== undefined) missions += 1;
      else if (session.state !== 'exited') sessions += 1;
    }
    return { panes: shownLeaves.length, sessions, missions };
  }, [shownLeaves, terminals]);
  const paneCount = closeAllCounts.panes;
  // O cabeçalho só habilita "Fechar todos os terminais…" com painel na tela; ao desmontar, o registro some.
  useEffect(() => {
    setPaneCount(projectId, paneCount);
  }, [projectId, paneCount]);
  // Ao desmontar (sair do projeto, ir ao Início, fechar a aba), o registro some e o pedido pendente também: sem isso a
  // pergunta reapareceria sozinha na volta.
  useEffect(
    () => () => {
      setPaneCount(projectId, 0);
      clearCloseAllRequest(projectId);
    },
    [projectId],
  );
  // O pedido espera a visão Terminais aparecer (o workspace fica montado, escondido, nas outras): a pergunta nasce
  // à vista, com o foco no "Voltar". Sair da visão com a pergunta aberta a descarta, para ela não reaparecer depois.
  // Só com a lista de terminais carregada: antes dela a contagem de sessões a encerrar sairia subestimada.
  const closeAllRequested = useCloseAllRequest(projectId);
  const askingCloseAll = closeAllRequested && visible && paneCount > 0 && loaded;
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (wasVisible.current && !visible) clearCloseAllRequest(projectId);
    wasVisible.current = visible;
  }, [projectId, visible]);
  // Um pedido sem painel nenhum (a pessoa fechou tudo antes) não tem o que perguntar.
  const loadedPanes = workspace.state.status === 'ready';
  useEffect(() => {
    if (closeAllRequested && loadedPanes && paneCount === 0) clearCloseAllRequest(projectId);
  }, [closeAllRequested, loadedPanes, paneCount, projectId]);

  // Ao ficar sem painéis (o último foi fechado), o foco não pode cair no body: vai para a barra.
  useEffect(() => {
    if (currentLayout === undefined) return;
    if (currentLayout !== null) hadPanes.current = true;
    else if (hadPanes.current) {
      hadPanes.current = false;
      setToolbarFocus((previous) => previous + 1);
    }
  }, [currentLayout]);
  const { showTerminal } = workspace;
  useEffect(() => {
    if (wanted === null || !ready || consumed.current === location.key) return;
    consumed.current = location.key;
    showTerminal(wanted, terminals.find((item) => item.id === wanted)?.provider);
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
  }, [
    wanted,
    ready,
    location.key,
    location.pathname,
    location.search,
    showTerminal,
    navigate,
    terminals,
  ]);

  if (workspace.state.status === 'loading') {
    return <p className="workspace-status">Abrindo o workspace…</p>;
  }
  if (workspace.state.status === 'error') {
    return (
      <div className="workspace-missing">
        <p role="alert">{workspace.state.message}</p>
        <Link to={ROUTE_PATHS.home}>{PROJECT_TEXT.backHome}</Link>
      </div>
    );
  }

  const layout = workspace.state.workspace.layout;

  // O painel mostrado sozinho é sempre o ativo (assim um painel novo, o pedido da barra lateral e o fechamento
  // seguem o que o hook já decide); sem o ativo na lista, vale o primeiro. `undefined` na grade.
  const soloLeaf = soloEffective
    ? (shownLeaves.find((leaf) => leaf.id === workspace.activeLeafId) ?? shownLeaves[0])
    : undefined;

  // Os painéis montados. Na grade, os da árvore da tela. No modo Abas, a aba à vista e os que já estavam montados (até
  // o que cabia na grade), escondidos: trocar de aba, maximizar e voltar à grade só mudam o nó de lugar, e o terminal
  // não é recriado nem repete a saída guardada.
  let mountedLeaves: LayoutLeaf[];
  if (soloLeaf === undefined) {
    mountedLeaves = shownLeaves;
    if (shownLeaves.length > 0) keptInTabs.current = shownLeaves.length;
  } else {
    const kept = pickVisible(
      shownLeaves.map((leaf) => leaf.id),
      mountedIds.current,
      soloLeaf.id,
      keptInTabs.current,
    ).shown;
    mountedLeaves = shownLeaves.filter((leaf) => kept.includes(leaf.id));
  }
  mountedIds.current = mountedLeaves.map((leaf) => leaf.id);

  /**
   * Mostra o painel `leafId`, que vira o ativo, com o foco no terminal dele. Fora do modo automático, liga o modo
   * Abas (é o que o "maximizar" do painel pede); no automático o `soloOn` da pessoa não muda.
   */
  const showSolo = (leafId: string) => {
    if (!soloAuto) setSoloOn(true);
    workspace.activateWithFocus(leafId);
  };
  // A escolha no seletor é da pessoa: "Abas" com a janela estreita vale quando a janela alargar.
  const chooseLayout = (mode: PaneLayoutMode) => setSoloOn(mode === 'abas');

  const run = async (leafId: string, action: (id: string) => Promise<string | null>) => {
    setBusy((previous) => new Set(previous).add(leafId));
    setErrors((previous) => {
      const { [leafId]: _dropped, ...rest } = previous;
      return rest;
    });
    try {
      const message = await action(leafId);
      if (message !== null) setErrors((previous) => ({ ...previous, [leafId]: message }));
      await reload();
    } finally {
      setBusy((previous) => {
        const next = new Set(previous);
        next.delete(leafId);
        return next;
      });
    }
  };

  const openPane = async (provider: ProviderId) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    try {
      const message = await workspace.addPane(provider);
      if (message !== null) notify.error(message);
      // A lista de terminais só se atualiza a cada 2 s: sem ler agora, o painel novo diria que a sessão terminou.
      else await reload();
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };

  // Dividir pelo cabeçalho do painel: o novo entra no lado pedido, com metade do espaço daquele painel.
  const splitPane = async (leafId: string, side: SplitSide, provider: ProviderId) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    try {
      const message = await workspace.splitPane(leafId, side, provider);
      if (message !== null) notify.error(message);
      else await reload();
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  // Por que o painel não pode ser dividido daquele lado; indefinido quando pode. A falta de espaço é medida com o
  // layout que resultaria: dividir nunca joga a tela no modo de um painel por vez.
  const splitBlocked = (leafId: string, side: SplitSide): string | undefined => {
    if (unavailableReason !== undefined) return unavailableReason;
    if (shownLeaves.length >= LAYOUT_LIMITS.maxLeaves) return LIMIT_HINT;
    if (shown === null || size === null) return undefined;
    const probe = splitLeaf(
      shown,
      leafId,
      side,
      { type: 'leaf', id: '\u0000probe', provider: 'shell', terminalId: null },
      () => '\u0000split',
    );
    return layoutFits(probe, size) ? undefined : NO_ROOM_HINT;
  };

  // Fechar o painel encerra a sessão dele (o processo principal cuida disso); a de missão só sai do painel.
  // O painel some na hora, sem esperar o processo principal. Se o pedido falhar, ele volta e o erro aparece nele.
  // `closingAll`: o painel sai junto com todos os outros, então nenhum vizinho precisa virar o ativo.
  const removeNow = (leafId: string, closingAll = false) => {
    // No modo de um painel, o vizinho vira o ativo antes de fechar: é ele que passa a aparecer.
    if (!closingAll && soloLeaf?.id === leafId) {
      const next = neighbourOf(shownLeaves, leafId);
      if (next !== null) workspace.activate(next);
    }
    setClosing((previous) => new Set(previous).add(leafId));
    // O terminal avulso é encerrado ao fechar o painel, então some da lista (e da barra lateral) na hora. O de
    // missão só sai do painel e segue na lista.
    const terminalId = leavesOf(layout).find((leaf) => leaf.id === leafId)?.terminalId ?? null;
    const session = terminals.find((item) => item.id === terminalId);
    const hiding = session !== undefined && session.missionId === undefined ? session.id : null;
    if (hiding !== null) hideTerminal(hiding);
    void run(leafId, workspace.removePane).finally(() => {
      if (hiding !== null) unhideTerminal(hiding);
      setClosing((previous) => {
        const next = new Set(previous);
        next.delete(leafId);
        return next;
      });
    });
  };

  // A saída terminou (ou o prazo venceu): agora o painel sai do layout. Chamar de novo não faz nada.
  const finishLeaving = (leafId: string) => {
    if (!leavingRef.current.delete(leafId)) return;
    setLeaving((previous) => {
      const next = new Set(previous);
      next.delete(leafId);
      return next;
    });
    removeNow(leafId);
  };
  finishLeavingRef.current = finishLeaving;

  // Na grade, o painel encolhe e some antes de sair; sozinho na tela (o vizinho aparece no lugar) ou com
  // "reduzir movimento", sai na hora.
  const closePane = (leafId: string) => {
    if (leavingRef.current.has(leafId)) return;
    if (soloLeaf !== undefined || paneMotionOff()) {
      removeNow(leafId);
      return;
    }
    leavingRef.current.add(leafId);
    setLeaving((previous) => new Set(previous).add(leafId));
    window.setTimeout(() => finishLeavingRef.current(leafId), LEAVE_FALLBACK_MS);
  };

  // "Fechar todos" confirmado: todos os painéis saem da tela na hora, sem a animação de saída de cada um, e os pedidos
  // vão um a um ao processo principal (que os enfileira). Um que falhe volta com o erro, como no fechar de um painel.
  const closeAll = () => {
    clearCloseAllRequest(projectId);
    // Quem estava encolhendo sai agora, junto com os outros: o fim da animação não pede o fechamento de novo.
    leavingRef.current.clear();
    setLeaving(new Set());
    for (const leaf of shownLeaves) removeNow(leaf.id, true);
    setToolbarFocus((previous) => previous + 1);
  };
  const cancelCloseAll = () => {
    clearCloseAllRequest(projectId);
    setToolbarFocus((previous) => previous + 1);
  };
  const onCloseAllKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelCloseAll();
  };
  // As ferramentas dos terminais, no cabeçalho do projeto (ver `toolsHost`). Os eventos seguem a árvore do React, então
  // os atalhos capturados no `.workspace` continuam valendo com o foco nelas.
  // O programa de um painel: o da sessão dele, se há uma; senão, o que o painel abre.
  const providerOf = (leaf: LayoutLeaf): ProviderId =>
    (leaf.terminalId === null
      ? undefined
      : terminals.find((item) => item.id === leaf.terminalId)?.provider) ?? leaf.provider;
  const labelOfProvider = (id: ProviderId) => providers.find((item) => item.id === id)?.label ?? id;

  // Os layouts prontos rearrumam os painéis abertos; os lugares que sobram viram painéis vazios do programa do painel
  // ativo, cada um com o botão de iniciar. O que não cabe na área com o mínimo de cada terminal fica desabilitado.
  const activeLeaf = shownLeaves.find((leaf) => leaf.id === workspace.activeLeafId);
  const presets: PresetOption[] =
    shownLeaves.length === 0
      ? []
      : LAYOUT_PRESETS.map((id) => {
          const count = Math.min(
            Math.max(shownLeaves.length, PRESET_SLOTS[id]),
            LAYOUT_LIMITS.maxLeaves,
          );
          const leaves: LayoutLeaf[] = Array.from(
            { length: count },
            (_, i) =>
              shownLeaves[i] ?? {
                type: 'leaf',
                id: `\u0000${i}`,
                provider: 'shell',
                terminalId: null,
              },
          );
          const next = presetLayout(id, leaves, () => '\u0000preset');
          const fits = size === null || next === null || layoutFits(next, size);
          return {
            id,
            label: presetLabel(id, count),
            ...(fits ? {} : { blocked: PRESET_NO_ROOM_HINT }),
          };
        });
  const choosePreset = (preset: LayoutPreset) => {
    setSoloOn(false);
    workspace.applyPreset(preset, activeLeaf === undefined ? 'shell' : providerOf(activeLeaf));
  };

  const toolbar = (
    <WorkspaceToolbar
      providers={providers}
      busy={opening}
      limitReached={leavesOf(layout).length >= LAYOUT_LIMITS.maxLeaves}
      {...(unavailableReason === undefined ? {} : { unavailableReason })}
      focusToken={toolbarFocus}
      soloMode={soloLeaf !== undefined}
      soloAuto={soloAuto}
      canSolo={shownLeaves.length > 0}
      presets={presets}
      onPreset={choosePreset}
      onLayout={chooseLayout}
      onOpen={(provider) => void openPane(provider)}
    />
  );
  const motion: PaneMotion = { entering, leaving, onEntered: settle, onLeft: finishLeaving };

  // Ctrl+Alt+número abre o programa dessa posição no menu "Abrir terminal", e vale como o clique no menu: com o limite
  // de painéis, a pasta sumida ou uma abertura em andamento, a tecla é engolida e nada abre. Ctrl+Alt com as setas
  // troca de aba. As duas valem na captura, antes do xterm: dentro do terminal o xterm tomaria a tecla.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const shortcut = providerShortcutIndex(event.nativeEvent);
    const target = shortcut === null ? undefined : providers[shortcut];
    if (target !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      const blocked =
        opening ||
        unavailableReason !== undefined ||
        leavesOf(layout).length >= LAYOUT_LIMITS.maxLeaves;
      if (!blocked && target.available !== false) void openPane(target.id);
      return;
    }
    // Ctrl+Z desfaz o último movimento de painéis, só com o foco fora do terminal e de campos de texto (lá o Ctrl+Z é
    // do programa ou do campo).
    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      event.nativeEvent.code === 'KeyZ' &&
      workspace.undoToken !== null &&
      !(event.target as Element).closest(
        '.terminal-view, input, textarea, [contenteditable="true"]',
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      workspace.undo();
      return;
    }
    // Os atalhos do layout (layout-shortcuts.ts). A tecla é sempre engolida, mesmo quando não há o que fazer (sem
    // vizinho daquele lado, sem espaço para dividir): ela nunca chega ao terminal pela metade.
    const action = layoutShortcut(event.nativeEvent);
    if (action === null) return;
    const activeId = soloLeaf?.id ?? workspace.activeLeafId;
    const active = shownLeaves.find((leaf) => leaf.id === activeId);
    if (active === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.type === 'close') {
      // O mesmo caminho do X do painel: o agente avulso vivo pergunta antes, o resto fecha direto.
      const close = hosts.hostOf(active.id).querySelector<HTMLButtonElement>('.pane__close');
      if (close !== null && !close.disabled) close.click();
      return;
    }
    if (soloLeaf !== undefined) {
      // Com um painel por vez na tela só há a troca de aba: não há vizinho para trocar nem onde ver uma divisão.
      if (action.type !== 'focus' || (action.side !== 'left' && action.side !== 'right')) return;
      const next = stepSolo(shownLeaves, soloLeaf.id, action.side === 'left' ? -1 : 1);
      if (next !== null) showSolo(next);
      return;
    }
    if (action.type === 'focus' || action.type === 'swap') {
      const neighbour = neighbourAt(shown, active.id, action.side);
      if (neighbour === null) return;
      if (action.type === 'focus') workspace.activateWithFocus(neighbour);
      else workspace.swap(active.id, neighbour);
      return;
    }
    const side =
      action.type === 'split'
        ? action.side
        : splitBlocked(active.id, 'right') === undefined
          ? 'right'
          : 'bottom';
    if (splitBlocked(active.id, side) !== undefined) return;
    void splitPane(active.id, side, providerOf(active));
  };

  const renderLeaf = (leaf: LayoutLeaf) => {
    const terminal =
      leaf.terminalId === null ? undefined : terminals.find((item) => item.id === leaf.terminalId);
    const providerId = terminal?.provider ?? leaf.provider;
    // Sem a sessão na lista ainda (primeira leitura ou leitura depois de iniciar), não dá para dizer que
    // ela terminou.
    if (
      leaf.terminalId !== null &&
      terminal === undefined &&
      (busy.has(leaf.id) || opening || !loaded)
    ) {
      return (
        <section
          className="pane"
          aria-label={`Painel ${providers.find((item) => item.id === providerId)?.label ?? providerId}`}
          data-active={workspace.activeLeafId === leaf.id ? 'true' : 'false'}
          onPointerDown={() => workspace.activateWithFocus(leaf.id)}
        >
          <p className="pane__launcher" role="status">
            Abrindo a sessão…
          </p>
        </section>
      );
    }
    return (
      <PaneView
        leaf={leaf}
        terminal={terminal}
        provider={providers.find((item) => item.id === providerId)}
        idle={terminal !== undefined && idleIds.has(terminal.id)}
        active={workspace.activeLeafId === leaf.id}
        focusTerminal={workspace.focusLeafId === leaf.id}
        busy={busy.has(leaf.id)}
        unavailable={unavailable}
        {...(errors[leaf.id] !== undefined ? { error: errors[leaf.id] } : {})}
        onActivate={() => workspace.activate(leaf.id)}
        onPointerActivate={() => workspace.activateWithFocus(leaf.id)}
        onStart={() => void run(leaf.id, workspace.startSession)}
        onDetach={() => workspace.detach(leaf.id)}
        onClose={() => void closePane(leaf.id)}
        maximized={soloLeaf?.id === leaf.id}
        // Mover só faz sentido com outro painel na grade.
        onGripPointerDown={
          soloLeaf !== undefined || shownLeaves.length < 2
            ? undefined
            : (event) => paneDrag.onGripPointerDown(leaf.id, event)
        }
        // Com um painel só na tela (maximizado ou em abas) não há onde ver a divisão: os botões somem.
        split={
          soloLeaf !== undefined
            ? undefined
            : {
                blocked: {
                  ...(splitBlocked(leaf.id, 'right') !== undefined
                    ? { right: splitBlocked(leaf.id, 'right') as string }
                    : {}),
                  ...(splitBlocked(leaf.id, 'bottom') !== undefined
                    ? { bottom: splitBlocked(leaf.id, 'bottom') as string }
                    : {}),
                },
                others: providers
                  .filter((item) => item.id !== providerId && item.available !== false)
                  .map((item) => ({ id: item.id, label: item.label })),
                onSplit: (side, other) => void splitPane(leaf.id, side, other ?? providerId),
              }
        }
        // Com a janela estreita o modo Abas não é escolha da pessoa: não há "maximizar" nem "voltar à grade".
        {...(soloAuto
          ? {}
          : {
              onMaximize: () => (soloLeaf?.id === leaf.id ? setSoloOn(false) : showSolo(leaf.id)),
            })}
      />
    );
  };

  return (
    <div className="workspace" onKeyDownCapture={onKeyDownCapture}>
      {visible ? createPortal(toolbar, toolsHost) : null}
      <div
        className="workspace__area"
        ref={setAreaElement}
        data-dragging={drag !== null ? 'true' : undefined}
      >
        {drag?.preview != null ? (
          <div
            className="pane-drop"
            data-spot={drag.zone?.spot}
            style={{
              left: drag.preview.left,
              top: drag.preview.top,
              width: drag.preview.width,
              height: drag.preview.height,
            }}
          />
        ) : null}
        {drag !== null && dragged !== undefined
          ? createPortal(
              <div
                className="pane-ghost"
                style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 14}px)` }}
              >
                <ProviderIcon provider={providerOf(dragged)} size={14} />
                <span className="pane-ghost__number">{shownLeaves.indexOf(dragged) + 1}</span>
                <span>{labelOfProvider(providerOf(dragged))}</span>
              </div>,
              document.body,
            )
          : null}
        {/* Flutua sobre o topo da área (position: absolute): não tira altura da área medida, e a grade não reflui. */}
        {askingCloseAll ? (
          <div className="workspace__confirm" onKeyDown={onCloseAllKeyDown}>
            <ConfirmInline
              focusBack
              question={closeAllQuestion(closeAllCounts)}
              confirmLabel="Fechar todos"
              onConfirm={closeAll}
              onCancel={cancelCloseAll}
            />
          </div>
        ) : null}
        {workspace.undoToken !== null && soloLeaf === undefined ? (
          <UndoNotice token={workspace.undoToken} onUndo={workspace.undo} />
        ) : null}
        {soloLeaf !== undefined ? (
          <div className="workspace__solo">
            <PaneTabs
              leaves={shownLeaves}
              activeId={soloLeaf.id}
              terminals={terminals}
              idleIds={idleIds}
              providers={providers}
              onSelect={showSolo}
              onClose={(leafId) => void closePane(leafId)}
              auto={soloAuto}
            />
            <div
              role="tabpanel"
              aria-labelledby={paneTabId(soloLeaf.id)}
              className="workspace__solo-pane"
              onFocus={hosts.rememberFocus}
            >
              {/* Um lugar por aba (a chave): o nó da aba anterior sai junto com o lugar dela e vai para o estacionamento. */}
              <div
                key={soloLeaf.id}
                ref={(slot) => hosts.attach(soloLeaf.id, slot)}
                className="workspace__solo-slot"
              />
            </div>
          </div>
        ) : gridTree === null ? (
          <div className="workspace__empty">
            {visible ? <TopographicBackground /> : null}
            <EmptyState
              icon={SquareTerminal}
              title="Nenhum terminal aberto"
              hint={
                providersLoaded && providers.length === 0
                  ? 'Nenhum programa disponível para abrir um terminal.'
                  : 'Escolha um programa na barra acima para abrir um terminal.'
              }
            />
          </div>
        ) : (
          <PaneTree
            layout={gridTree}
            onSizes={workspace.setSizes}
            onEqualize={workspace.equalize}
            minWidth={PANE_MIN_WIDTH}
            minHeight={PANE_MIN_HEIGHT}
            renderLeaf={renderLeaf}
            motion={motion}
            hosts={hosts}
          />
        )}
        <div ref={parkingRef} className="workspace__parking" hidden />
        {mountedLeaves.map((leaf) =>
          createPortal(renderLeaf(leaf), hosts.hostOf(leaf.id), leaf.id),
        )}
      </div>
    </div>
  );
}
