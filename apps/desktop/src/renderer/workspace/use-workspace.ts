import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutNode, WorkspaceDto } from '@project-hub/contracts';
import { WORKSPACES_CHANGED_EVENT } from '../workspaces-events';
import {
  firstFreeLeaf,
  findLeaf,
  leafHolding,
  leavesOf,
  withRatio,
  withTerminal,
} from './layout-model';

export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workspace: WorkspaceDto };

/** Quanto esperar, sem nova mudança de layout, antes de gravar. */
export const SAVE_DELAY_MS = 400;

const OPEN_ERROR = 'Não foi possível abrir o workspace. Tente de novo.';
const ACTION_ERROR = 'Não foi possível concluir o pedido. Tente de novo.';

export type UseWorkspace = {
  state: WorkspaceState;
  /** Otimista: muda o layout na hora e grava depois de `SAVE_DELAY_MS`. */
  setRatio(splitId: string, ratio: number): void;
  /** Folha que já tem a sessão: só a ativa e devolve o id dela. Senão, põe na folha ativa (ou na primeira livre). */
  showTerminal(terminalId: string): string | null;
  detach(leafId: string): void;
  /** `null` = ok; texto = mensagem de erro. */
  startSession(leafId: string): Promise<string | null>;
  endSession(leafId: string): Promise<string | null>;
  activeLeafId: string | null;
  activate(leafId: string): void;
  /** Grava já o que estiver pendente. */
  flush(): Promise<void>;
};

function firstLeafId(layout: LayoutNode): string | null {
  return leavesOf(layout)[0]?.id ?? null;
}

/**
 * O workspace de um projeto: abre ao montar (ou ao trocar de projeto), edita o layout na hora e grava
 * em lote. Uma gravação pendente sai ao desmontar, ao trocar de projeto e antes de iniciar ou encerrar
 * uma sessão, para o processo principal ver o mesmo layout que a tela.
 */
export function useWorkspace(projectId: string): UseWorkspace {
  const [state, setState] = useState<WorkspaceState>({ status: 'loading' });
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);

  // O layout mais recente, para os callbacks não dependerem do estado renderizado.
  const current = useRef<WorkspaceDto | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRef = useRef<string | null>(null);

  const setActive = useCallback((leafId: string | null) => {
    activeRef.current = leafId;
    setActiveLeafId(leafId);
  }, []);

  const adopt = useCallback((workspace: WorkspaceDto) => {
    current.current = workspace;
    setState({ status: 'ready', workspace });
  }, []);

  const saveNow = useCallback(async (): Promise<void> => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    const workspace = current.current;
    if (!dirty.current || workspace === null) return;
    dirty.current = false;
    try {
      await window.projectHub.workspaces.saveLayout(workspace.id, workspace.layout);
    } catch {
      // A próxima edição grava de novo; o layout na tela segue como o usuário o deixou.
    }
  }, []);

  const edit = useCallback(
    (change: (layout: LayoutNode) => LayoutNode) => {
      const workspace = current.current;
      if (workspace === null) return;
      const layout = change(workspace.layout);
      if (layout === workspace.layout) return;
      adopt({ ...workspace, layout });
      dirty.current = true;
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        void saveNow();
      }, SAVE_DELAY_MS);
    },
    [adopt, saveNow],
  );

  useEffect(() => {
    let cancelled = false;
    current.current = null;
    dirty.current = false;
    setState({ status: 'loading' });
    setActive(null);

    void (async () => {
      try {
        const result = await window.projectHub.workspaces.open(projectId);
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: 'error', message: result.error.message || OPEN_ERROR });
          return;
        }
        adopt(result.data);
        setActive(firstLeafId(result.data.layout));
        window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
      } catch {
        if (!cancelled) setState({ status: 'error', message: OPEN_ERROR });
      }
    })();

    return () => {
      cancelled = true;
      // Grava o que ficou pendente do projeto que sai (a gravação lê `current` antes de ele mudar).
      void saveNow();
    };
  }, [projectId, adopt, saveNow, setActive]);

  const setRatio = useCallback(
    (splitId: string, ratio: number) => edit((layout) => withRatio(layout, splitId, ratio)),
    [edit],
  );

  const detach = useCallback(
    (leafId: string) => edit((layout) => withTerminal(layout, leafId, null)),
    [edit],
  );

  const showTerminal = useCallback(
    (terminalId: string): string | null => {
      const workspace = current.current;
      if (workspace === null) return null;
      const holder = leafHolding(workspace.layout, terminalId);
      if (holder !== undefined) {
        setActive(holder.id);
        return holder.id;
      }
      const active = activeRef.current;
      const target =
        (active !== null ? findLeaf(workspace.layout, active) : undefined) ??
        firstFreeLeaf(workspace.layout) ??
        leavesOf(workspace.layout)[0];
      if (target === undefined) return null;
      edit((layout) => withTerminal(layout, target.id, terminalId));
      setActive(target.id);
      return target.id;
    },
    [edit, setActive],
  );

  const act = useCallback(
    async (
      leafId: string,
      call: (
        workspaceId: string,
        leafId: string,
      ) => ReturnType<typeof window.projectHub.workspaces.startSession>,
    ): Promise<string | null> => {
      const workspace = current.current;
      if (workspace === null) return ACTION_ERROR;
      await saveNow();
      try {
        const result = await call(workspace.id, leafId);
        if (!result.ok) return result.error.message || ACTION_ERROR;
        adopt(result.data);
        return null;
      } catch {
        return ACTION_ERROR;
      }
    },
    [adopt, saveNow],
  );

  const startSession = useCallback(
    (leafId: string) =>
      act(leafId, (id, leaf) => window.projectHub.workspaces.startSession(id, leaf)),
    [act],
  );

  const endSession = useCallback(
    (leafId: string) =>
      act(leafId, (id, leaf) => window.projectHub.workspaces.endSession(id, leaf)),
    [act],
  );

  return {
    state,
    setRatio,
    showTerminal,
    detach,
    startSession,
    endSession,
    activeLeafId,
    activate: setActive,
    flush: saveNow,
  };
}
