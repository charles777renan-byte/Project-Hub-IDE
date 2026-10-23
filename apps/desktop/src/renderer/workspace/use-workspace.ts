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
const SAVE_REFUSED = 'O layout não pôde ser gravado e não será tentado de novo.';

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
  /** Folha cujo terminal deve receber o foco: só muda por gesto do usuário, nunca pela ativação inicial. */
  focusLeafId: string | null;
  /** Marca a folha como ativa, sem levar o foco ao terminal (foco do teclado, abertura). */
  activate(leafId: string): void;
  /** Ativa a folha e pede o foco do terminal (clique no painel). */
  activateWithFocus(leafId: string): void;
  /** Mensagem quando o servidor recusou o layout (recusa permanente, não é repetida); `null` se não há. */
  saveError: string | null;
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
  const [focusLeafId, setFocusLeafId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // O layout mais recente, para os callbacks não dependerem do estado renderizado.
  const current = useRef<WorkspaceDto | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRef = useRef<string | null>(null);
  // Muda a cada abertura ou troca de projeto: respostas de pedidos antigos são ignoradas.
  const generation = useRef(0);

  const setActive = useCallback((leafId: string | null, withFocus = false) => {
    activeRef.current = leafId;
    setActiveLeafId(leafId);
    setFocusLeafId(withFocus ? leafId : null);
  }, []);

  const adopt = useCallback((workspace: WorkspaceDto) => {
    current.current = workspace;
    setState({ status: 'ready', workspace });
  }, []);

  const saveNow = useCallback(async function saveNow(): Promise<void> {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    const workspace = current.current;
    if (!dirty.current || workspace === null) return;
    dirty.current = false;
    let saved: boolean;
    let refused = false;
    try {
      const result = await window.projectHub.workspaces.saveLayout(workspace.id, workspace.layout);
      saved = result.ok;
      // VALIDATION_FAILED é permanente: repetir o mesmo layout só repetiria a recusa.
      refused = !result.ok && result.error.code === 'VALIDATION_FAILED';
    } catch {
      saved = false;
    }
    if (refused) {
      if (current.current?.id === workspace.id) setSaveError(SAVE_REFUSED);
      return;
    }
    // Falhou: volta a ficar pendente e é tentado de novo, se o workspace na tela ainda é o mesmo.
    if (!saved && current.current?.id === workspace.id) {
      dirty.current = true;
      if (timer.current === undefined) {
        timer.current = setTimeout(() => {
          timer.current = undefined;
          void saveNow();
        }, SAVE_DELAY_MS);
      }
    }
  }, []);

  /** Marca o layout como pendente e agenda a gravação. */
  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveError(null);
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void saveNow();
    }, SAVE_DELAY_MS);
  }, [saveNow]);

  const edit = useCallback(
    (change: (layout: LayoutNode) => LayoutNode) => {
      const workspace = current.current;
      if (workspace === null) return;
      const layout = change(workspace.layout);
      if (layout === workspace.layout) return;
      adopt({ ...workspace, layout });
      scheduleSave();
    },
    [adopt, scheduleSave],
  );

  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    current.current = null;
    dirty.current = false;
    setSaveError(null);
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
        setActive(holder.id, true);
        return holder.id;
      }
      const active = activeRef.current;
      const target =
        (active !== null ? findLeaf(workspace.layout, active) : undefined) ??
        firstFreeLeaf(workspace.layout) ??
        leavesOf(workspace.layout)[0];
      if (target === undefined) return null;
      edit((layout) => withTerminal(layout, target.id, terminalId));
      setActive(target.id, true);
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
      const mine = generation.current;
      await saveNow();
      try {
        const result = await call(workspace.id, leafId);
        if (!result.ok) return result.error.message || ACTION_ERROR;
        // Outro projeto abriu enquanto o pedido estava em voo: a resposta não é dele.
        if (generation.current !== mine) return null;
        // Só o terminal da folha entra: um ajuste de divisória feito durante o pedido não se perde.
        const terminalId = findLeaf(result.data.layout, leafId)?.terminalId;
        const latest = current.current;
        if (terminalId !== undefined && latest !== null) {
          const layout = withTerminal(latest.layout, leafId, terminalId);
          if (layout !== latest.layout) adopt({ ...latest, layout });
          // O layout local pode diferir do devolvido (divisória movida durante o pedido): o servidor
          // ainda tem o antigo, então a diferença precisa ser gravada.
          if (JSON.stringify(layout) !== JSON.stringify(result.data.layout)) scheduleSave();
        }
        return null;
      } catch {
        return ACTION_ERROR;
      }
    },
    [adopt, saveNow, scheduleSave],
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

  const activate = useCallback((leafId: string) => setActive(leafId), [setActive]);
  const activateWithFocus = useCallback((leafId: string) => setActive(leafId, true), [setActive]);

  return {
    state,
    setRatio,
    showTerminal,
    detach,
    startSession,
    endSession,
    activeLeafId,
    focusLeafId,
    activate,
    activateWithFocus,
    saveError,
    flush: saveNow,
  };
}
