import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { LAYOUT_LIMITS } from '@project-hub/contracts/layout-limits';
import { arrangeLeaves } from '@project-hub/contracts/layout-arrange';
import type { LayoutLeaf, ProviderId, ProviderInfo } from '@project-hub/contracts';
import { EmptyState } from '../components/EmptyState';
import { TopographicBackground } from '../components/TopographicBackground';
import { SquareTerminal } from '../components/Icon';
import { ProjectProgress } from '../components/progress/ProjectProgress';
import { PathText } from '../components/PathText';
import {
  PROJECT_NO_GIT_NOTICE_ID,
  PROJECT_UNAVAILABLE_NOTICE_ID,
  ProjectHeader,
} from '../components/project/ProjectHeader';
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
import { PaneTabs, paneTabId } from '../workspace/PaneTabs';
import { PaneTree } from '../workspace/PaneTree';
import { PaneView } from '../workspace/PaneView';
import { leavesOf } from '../workspace/layout-model';
import {
  LEAVE_FALLBACK_MS,
  paneMotionOff,
  useEnteringLeaves,
  type PaneMotion,
} from '../workspace/pane-motion';
import { neighbourOf, stepSolo } from '../workspace/solo';
import { useWorkspace } from '../workspace/use-workspace';
import { WorkspaceToolbar } from '../workspace/WorkspaceToolbar';

const PROVIDERS_ERROR = 'Não foi possível carregar os programas disponíveis.';
const UNAVAILABLE_NOTICE =
  'A pasta deste projeto não está disponível. Ela pode ter sido movida ou apagada.';
const UNAVAILABLE_REASON = 'A pasta do projeto não está disponível.';

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
 * os terminais. As outras visões só são montadas enquanto ativas. Projeto arquivado ou removido com a aba
 * aberta mostra a mensagem e o link para o Início.
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
      {project === undefined ? null : (
        <ProjectHeader
          project={project}
          missionOpen={missionId !== undefined}
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
      {project !== undefined && project.repositoryKind !== 'git' ? (
        <p className="page-alert" id={PROJECT_NO_GIT_NOTICE_ID}>
          {PROJECT_TEXT.noGitNotice}
        </p>
      ) : null}
      <ProjectPanel view="terminais" active={view} labelled={project !== undefined}>
        <WorkspaceBody
          key={projectId}
          projectId={projectId}
          projectName={project?.name ?? ''}
          visible={view === 'terminais'}
          {...(unavailable ? { unavailableReason: UNAVAILABLE_REASON } : {})}
        />
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
  projectName,
  visible,
  unavailableReason,
}: {
  projectId: string;
  projectName: string;
  /** Os terminais ficam montados, mas escondidos nas outras visões; escondido, o estado vazio não anima o fundo. */
  visible: boolean;
  /** A pasta do projeto sumiu: a barra não abre terminal e a dica mostra este motivo. */
  unavailableReason?: string;
}) {
  const workspace = useWorkspace(projectId);
  // A pasta sumida desabilita também iniciar e reiniciar nos painéis (o motivo vem com `unavailableReason`).
  const unavailable = unavailableReason !== undefined;

  const { terminals, loaded, reload } = useTerminals();
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
  // Modo "um painel por vez": só na tela, não muda o layout guardado (a arrumação automática segue valendo na grade).
  const [soloOn, setSoloOn] = useState(false);

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
  // O arranjo sem os painéis que estão fechando: o mesmo que o servidor vai devolver (arrangeLeaves).
  const shown =
    closing.size === 0 || layout === null
      ? layout
      : arrangeLeaves(
          leavesOf(layout).filter((leaf) => !closing.has(leaf.id)),
          () => crypto.randomUUID(),
        );

  // O painel mostrado sozinho é sempre o ativo (assim um painel novo, o pedido da barra lateral e o fechamento
  // seguem o que o hook já decide); sem o ativo na lista, vale o primeiro. `undefined` na grade.
  const shownLeaves = leavesOf(shown);
  const soloLeaf = soloOn
    ? (shownLeaves.find((leaf) => leaf.id === workspace.activeLeafId) ?? shownLeaves[0])
    : undefined;

  /** Liga o modo mostrando o painel `leafId`, que vira o ativo, com o foco no terminal dele. */
  const showSolo = (leafId: string) => {
    setSoloOn(true);
    workspace.activateWithFocus(leafId);
  };
  const toggleSolo = () => setSoloOn(soloLeaf === undefined);

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

  // Fechar o painel encerra a sessão dele (o processo principal cuida disso); a de missão só sai do painel.
  // O painel some na hora, sem esperar o processo principal. Se o pedido falhar, ele volta e o erro aparece nele.
  const removeNow = (leafId: string) => {
    // No modo de um painel, o vizinho vira o ativo antes de fechar: é ele que passa a aparecer.
    if (soloLeaf?.id === leafId) {
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
  const motion: PaneMotion = { entering, leaving, onEntered: settle, onLeft: finishLeaving };

  // Ctrl+Alt com as setas troca de aba. Vale na captura, antes do xterm: dentro do terminal o xterm tomaria a tecla.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (soloLeaf === undefined || !event.ctrlKey || !event.altKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const next = stepSolo(shownLeaves, soloLeaf.id, event.key === 'ArrowLeft' ? -1 : 1);
    if (next !== null) showSolo(next);
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
        projectName={projectName}
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
        onMaximize={() => (soloLeaf?.id === leaf.id ? setSoloOn(false) : showSolo(leaf.id))}
      />
    );
  };

  return (
    <div className="workspace" onKeyDownCapture={onKeyDownCapture}>
      <WorkspaceToolbar
        providers={providers}
        busy={opening}
        limitReached={leavesOf(layout).length >= LAYOUT_LIMITS.maxLeaves}
        {...(unavailableReason === undefined ? {} : { unavailableReason })}
        focusToken={toolbarFocus}
        soloMode={soloLeaf !== undefined}
        canSolo={shownLeaves.length > 0}
        onToggleSolo={toggleSolo}
        onOpen={(provider) => void openPane(provider)}
      />
      <div className="workspace__area">
        {soloLeaf !== undefined ? (
          <div className="workspace__solo">
            <PaneTabs
              leaves={shownLeaves}
              activeId={soloLeaf.id}
              terminals={terminals}
              providers={providers}
              onSelect={showSolo}
              onGrid={() => setSoloOn(false)}
            />
            <div
              role="tabpanel"
              aria-labelledby={paneTabId(soloLeaf.id)}
              className="workspace__solo-pane"
            >
              {renderLeaf(soloLeaf)}
            </div>
          </div>
        ) : shown === null ? (
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
            layout={shown}
            onRatio={workspace.setRatio}
            renderLeaf={renderLeaf}
            motion={motion}
          />
        )}
      </div>
    </div>
  );
}
