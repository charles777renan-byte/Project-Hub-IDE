import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { LayoutLeaf, ProviderInfo } from '@project-hub/contracts';
import { ROUTE_PATHS } from '../routes';
import { useSidebarData } from '../use-sidebar-data';
import { useTerminals } from '../terminals-data';
import { PaneTree } from '../workspace/PaneTree';
import { PaneView } from '../workspace/PaneView';
import { useWorkspace } from '../workspace/use-workspace';

/** Lê o id da sessão que a barra lateral pediu para mostrar, se o estado da rota traz um. */
function requestedTerminal(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const id = (state as { showTerminal?: unknown }).showTerminal;
  return typeof id === 'string' && id !== '' ? id : null;
}

export function WorkspacePage() {
  const { projectId = '' } = useParams();
  const sidebar = useSidebarData();
  const project = sidebar.projects.find((item) => item.id === projectId);
  // Só some a tela quando a lista chegou inteira e o projeto não está nela; carregando ou com falha
  // de leitura, o workspace abre e o processo principal recusa o que não existe.
  if (sidebar.status === 'ready' && project === undefined) {
    return (
      <div className="workspace-missing">
        <p>O projeto não foi encontrado.</p>
        <Link to={ROUTE_PATHS.projects}>Voltar para Projetos</Link>
      </div>
    );
  }
  return <WorkspaceBody key={projectId} projectId={projectId} projectName={project?.name ?? ''} />;
}

function WorkspaceBody({ projectId, projectName }: { projectId: string; projectName: string }) {
  const workspace = useWorkspace(projectId);

  const { terminals, loaded, reload } = useTerminals();
  const location = useLocation();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const consumed = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.projectHub.providers.list();
        if (!cancelled && result.ok) setProviders(result.data);
      } catch {
        // Sem a lista, os painéis mostram o rótulo do provedor e deixam o botão habilitado.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pedido da barra lateral: vale uma vez por navegação. O estado da rota é limpo logo depois.
  const wanted = requestedTerminal(location.state);
  const ready = workspace.state.status === 'ready';
  const { showTerminal } = workspace;
  useEffect(() => {
    if (wanted === null || !ready || consumed.current === location.key) return;
    consumed.current = location.key;
    showTerminal(wanted);
    navigate(location.pathname, { replace: true, state: null });
  }, [wanted, ready, location.key, location.pathname, showTerminal, navigate]);

  if (workspace.state.status === 'loading') {
    return <p className="workspace-status">Abrindo o workspace…</p>;
  }
  if (workspace.state.status === 'error') {
    return (
      <div className="workspace-missing">
        <p role="alert">{workspace.state.message}</p>
        <Link to={ROUTE_PATHS.projects}>Voltar para Projetos</Link>
      </div>
    );
  }

  const layout = workspace.state.workspace.layout;

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

  const renderLeaf = (leaf: LayoutLeaf) => {
    const terminal =
      leaf.terminalId === null ? undefined : terminals.find((item) => item.id === leaf.terminalId);
    const providerId = terminal?.provider ?? leaf.provider;
    // Sem a sessão na lista ainda (primeira leitura ou leitura depois de iniciar), não dá para dizer que
    // ela terminou.
    if (leaf.terminalId !== null && terminal === undefined && (busy.has(leaf.id) || !loaded)) {
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
        {...(errors[leaf.id] !== undefined ? { error: errors[leaf.id] } : {})}
        onActivate={() => workspace.activate(leaf.id)}
        onPointerActivate={() => workspace.activateWithFocus(leaf.id)}
        onStart={() => void run(leaf.id, workspace.startSession)}
        onEnd={() => void run(leaf.id, workspace.endSession)}
        onDetach={() => workspace.detach(leaf.id)}
        // Sessão de missão não fecha por aqui (só cancelando a missão): o painel só solta o terminal.
        onClear={() =>
          terminal?.missionId === undefined
            ? void run(leaf.id, workspace.endSession)
            : workspace.detach(leaf.id)
        }
      />
    );
  };

  return (
    <>
      <PaneTree layout={layout} onRatio={workspace.setRatio} renderLeaf={renderLeaf} />
    </>
  );
}
