import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppResult, LayoutNode, ProviderId, WorkspaceDto } from '@project-hub/contracts';
import { notify } from '../notify';
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
  /** Abre um painel novo do provedor. `null` = ok; texto = erro. O servidor decide a organização: o layout devolvido vale inteiro. */
  addPane(provider: ProviderId): Promise<string | null>;
  /** Fecha o painel. `null` = ok; texto = erro. Se a folha ativa saiu, ativa a primeira restante. */
  removePane(leafId: string): Promise<string | null>;
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

function firstLeafId(layout: LayoutNode | null): string | null {
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
  const [saveError, setSaveErrorState] = useState<string | null>(null);
  // O aviso da recusa do layout: sai da tela quando o erro se desfaz (próxima edição ou troca de projeto).
  const refusalToast = useRef<number | null>(null);
  const setSaveError = useCallback((message: string | null) => {
    setSaveErrorState(message);
    if (message === null && refusalToast.current !== null) {
      notify.dismiss(refusalToast.current);
      refusalToast.current = null;
    }
  }, []);

  // O layout mais recente, para os callbacks não dependerem do estado renderizado.
  const current = useRef<WorkspaceDto | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRef = useRef<string | null>(null);
  // Muda a cada abertura ou troca de projeto: respostas de pedidos antigos são ignoradas.
  const generation = useRef(0);
  // Mudanças de estrutura (abrir/fechar painel) em voo: enquanto houver, o layout local está velho e
  // gravá-lo atropelaria a mudança, então a gravação espera (o pendente continua marcado).
  // Só vale para a geração atual: a de um projeto que já saiu não bloqueia nem reagenda nada no novo.
  // Limitação aceita: uma edição pendente do projeto antigo, com mudança estrutural dele em voo na troca,
  // é descartada.
  const structural = useRef(0);

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
    if (structural.current > 0) return;
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
      // O aviso é direto (o store é de módulo): vale também se o hook já saiu da tela, como na gravação
      // que a desmontagem dispara. O estado só muda se o workspace ainda é o da tela.
      refusalToast.current = notify.error(SAVE_REFUSED);
      if (current.current?.id === workspace.id) setSaveErrorState(SAVE_REFUSED);
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
    (change: (layout: LayoutNode | null) => LayoutNode | null) => {
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
    structural.current = 0;
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
        // Outro projeto abriu enquanto o pedido estava em voo: a resposta (inclusive o erro) não é dele.
        if (generation.current !== mine) return null;
        if (!result.ok) return result.error.message || ACTION_ERROR;
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
        return generation.current !== mine ? null : ACTION_ERROR;
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

  /**
   * Muda a estrutura de painéis no servidor e adota o DTO devolvido inteiro (a organização automática
   * vale). Uma edição local pendente é gravada antes e, se surgir outra durante o pedido, o servidor
   * ganha: o layout dele é a verdade.
   */
  const changePanes = useCallback(
    async (
      call: (workspaceId: string) => Promise<AppResult<WorkspaceDto>>,
      afterAdopt: (previous: LayoutNode | null, next: WorkspaceDto) => void,
    ): Promise<string | null> => {
      const workspace = current.current;
      if (workspace === null) return ACTION_ERROR;
      const mine = generation.current;
      await saveNow();
      structural.current += 1;
      let adopted = false;
      try {
        const result = await call(workspace.id);
        // Outro projeto abriu enquanto o pedido estava em voo: a resposta (inclusive o erro) não é dele.
        if (generation.current !== mine) return null;
        if (!result.ok) return result.error.message || ACTION_ERROR;
        const previous = current.current?.layout ?? null;
        if (timer.current !== undefined) {
          clearTimeout(timer.current);
          timer.current = undefined;
        }
        // O servidor é a verdade: o pendente (feito sobre o layout velho) deixa de valer.
        dirty.current = false;
        adopted = true;
        adopt(result.data);
        setSaveError(null);
        afterAdopt(previous, result.data);
        window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
        return null;
      } catch {
        return generation.current !== mine ? null : ACTION_ERROR;
      } finally {
        if (generation.current === mine) structural.current -= 1;
        // Sem sucesso, o que ficou pendente durante o pedido ainda precisa ser gravado.
        if (!adopted && generation.current === mine && dirty.current) scheduleSave();
      }
    },
    [adopt, saveNow, scheduleSave, setSaveError],
  );

  const addPane = useCallback(
    (provider: ProviderId) =>
      changePanes(
        (id) => window.projectHub.workspaces.addPane(id, provider),
        (previous, next) => {
          const known = new Set(leavesOf(previous).map((leaf) => leaf.id));
          const created = leavesOf(next.layout).find((leaf) => !known.has(leaf.id));
          if (created !== undefined) setActive(created.id, true);
        },
      ),
    [changePanes, setActive],
  );

  const removePane = useCallback(
    (leafId: string) =>
      changePanes(
        (id) => window.projectHub.workspaces.removePane(id, leafId),
        (_previous, next) => {
          const active = activeRef.current;
          if (active !== null && findLeaf(next.layout, active) !== undefined) return;
          setActive(firstLeafId(next.layout));
        },
      ),
    [changePanes, setActive],
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
    addPane,
    removePane,
    activeLeafId,
    focusLeafId,
    activate,
    activateWithFocus,
    saveError,
    flush: saveNow,
  };
}
