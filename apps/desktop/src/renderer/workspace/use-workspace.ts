import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dockLeaf,
  equalizeDivider,
  presetLayout,
  PRESET_SLOTS,
  splitLeaf,
  swapLeaves,
  withSizes,
  type LayoutPreset,
  type Side,
} from '@project-hub/contracts/layout-ops';
import { LAYOUT_LIMITS } from '@project-hub/contracts/layout-limits';
import type {
  AppResult,
  LayoutLeaf,
  LayoutNode,
  ProviderId,
  WorkspaceDto,
} from '@project-hub/contracts';
import { notify } from '../notify';
import {
  RESUME_SESSION_REQUEST_EVENT,
  WORKSPACES_CHANGED_EVENT,
  type ResumeSessionRequest,
} from '../workspaces-events';
import {
  firstFreeLeaf,
  findLeaf,
  leafHolding,
  leavesOf,
  restoreArrangement,
  withTerminal,
} from './layout-model';
import { bestPlacement, type AreaSize } from './layout-fit';

export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; workspace: WorkspaceDto };

/** Quanto esperar, sem nova mudança de layout, antes de gravar. */
export const SAVE_DELAY_MS = 400;

const OPEN_ERROR = 'Não foi possível abrir o workspace. Tente de novo.';
const ACTION_ERROR = 'Não foi possível concluir o pedido. Tente de novo.';
/** Também usada pela barra, que desabilita os botões no limite. */
export const MAX_PANES_MESSAGE = 'O workspace já tem o máximo de 12 painéis.';
const SAVE_REFUSED = 'O layout não pôde ser gravado e não será tentado de novo.';

export type UseWorkspace = {
  state: WorkspaceState;
  /** Os tamanhos novos dos filhos de uma divisão. Otimista: muda o layout na hora e grava depois de `SAVE_DELAY_MS`. */
  setSizes(splitId: string, sizes: number[]): void;
  /** Iguala os dois lados da divisória entre os filhos `index` e `index + 1` da divisão. */
  equalize(splitId: string, index: number): void;
  /** Troca dois painéis de lugar; os tamanhos ficam com os lugares. Pode ser desfeito. */
  swap(firstLeafId: string, secondLeafId: string): void;
  /** Tira o painel de onde está e o encaixa no lado `side` do alvo, que cede metade do espaço. Pode ser desfeito. */
  dock(leafId: string, targetLeafId: string, side: Side): void;
  /**
   * Arruma os painéis num layout pronto, na ordem em que estão. Faltando painéis para os lugares do layout, entram
   * painéis vazios do programa `fill`, cada um com o botão de iniciar. Pode ser desfeito.
   */
  applyPreset(preset: LayoutPreset, fill: ProviderId): void;
  /** Se há um movimento (trocar, encaixar, layout pronto) para desfazer. Muda a cada movimento. */
  undoToken: number | null;
  /** Volta ao layout de antes do último movimento. As sessões não mudam. */
  undo(): void;
  /** Esquece o movimento guardado (o aviso de desfazer saiu da tela). */
  forgetUndo(): void;
  /** A área dos terminais, em px, para escolher onde um painel novo entra. A página informa a cada medida. */
  setArea(area: AreaSize | null): void;
  /**
   * Mostra a sessão: folha que já a tem → ativa; senão a folha ativa sem sessão, a primeira livre ou um
   * painel novo (até o limite). Nunca substitui uma sessão viva. `provider` é o do terminal, para o painel novo.
   */
  showTerminal(terminalId: string, provider?: ProviderId): string | null;
  detach(leafId: string): void;
  /** `null` = ok; texto = mensagem de erro. */
  startSession(leafId: string): Promise<string | null>;
  /**
   * Abre um painel novo do provedor, ao lado do painel em que ele fica maior sem tirar nenhum do tamanho mínimo.
   * `null` = ok; texto = erro. O layout devolvido pelo servidor vale inteiro.
   */
  addPane(provider: ProviderId): Promise<string | null>;
  /** Abre um painel novo do provedor no lado `side` do painel `leafId`. `null` = ok; texto = erro. */
  splitPane(leafId: string, side: Side, provider: ProviderId): Promise<string | null>;
  /** Retoma uma sessão do histórico como painel novo deste workspace. `null` = ok; texto = erro. */
  resumeSession(sessionId: string): Promise<string | null>;
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
  // Conta só as da geração atual (zera a cada troca de projeto): uma mudança de projeto que já saiu não
  // bloqueia nem reagenda nada no novo, e só quem incrementou na geração atual decrementa.
  // Limitação aceita: uma edição pendente do projeto antigo, com mudança estrutural dele em voo na troca,
  // é descartada.
  const structural = useRef(0);
  // O layout de antes do último movimento (trocar, encaixar, layout pronto), para o "Desfazer".
  const undoLayout = useRef<LayoutNode | null>(null);
  const [undoToken, setUndoToken] = useState<number | null>(null);
  const undoCount = useRef(0);
  const area = useRef<AreaSize | null>(null);
  const setArea = useCallback((next: AreaSize | null) => {
    area.current = next;
  }, []);
  const forgetUndo = useCallback(() => {
    undoLayout.current = null;
    setUndoToken(null);
  }, []);

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
    forgetUndo();

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
  }, [projectId, adopt, saveNow, setActive, forgetUndo]);

  const setSizes = useCallback(
    (splitId: string, sizes: number[]) =>
      edit((layout) => (layout === null ? null : withSizes(layout, splitId, sizes))),
    [edit],
  );

  const equalize = useCallback(
    (splitId: string, index: number) =>
      edit((layout) => (layout === null ? null : equalizeDivider(layout, splitId, index))),
    [edit],
  );

  /** Um movimento de painéis: guarda o layout de antes para o "Desfazer" e aplica a mudança. Nada muda, nada guarda. */
  const move = useCallback(
    (change: (layout: LayoutNode) => LayoutNode | null) => {
      const before = current.current?.layout ?? null;
      if (before === null) return;
      edit(() => change(before));
      if (current.current?.layout === before) return;
      undoLayout.current = before;
      undoCount.current += 1;
      setUndoToken(undoCount.current);
    },
    [edit],
  );

  const swap = useCallback(
    (firstLeafId: string, secondLeafId: string) =>
      move((layout) => swapLeaves(layout, firstLeafId, secondLeafId)),
    [move],
  );

  const dock = useCallback(
    (leafId: string, targetLeafId: string, side: Side) =>
      move((layout) => dockLeaf(layout, leafId, targetLeafId, side, () => crypto.randomUUID())),
    [move],
  );

  const applyPreset = useCallback(
    (preset: LayoutPreset, fill: ProviderId) =>
      move((layout) => {
        const leaves = leavesOf(layout);
        const missing = Math.min(
          PRESET_SLOTS[preset] - leaves.length,
          LAYOUT_LIMITS.maxLeaves - leaves.length,
        );
        for (let i = 0; i < missing; i += 1) {
          leaves.push({ type: 'leaf', id: crypto.randomUUID(), provider: fill, terminalId: null });
        }
        return presetLayout(preset, leaves, () => crypto.randomUUID());
      }),
    [move],
  );

  const undo = useCallback(() => {
    const before = undoLayout.current;
    forgetUndo();
    if (before === null) return;
    // Um painel que abriu ou fechou depois do movimento torna o layout guardado inválido: aí não há o que desfazer.
    edit((layout) => (layout === null ? null : (restoreArrangement(before, layout) ?? layout)));
  }, [edit, forgetUndo]);

  const detach = useCallback(
    (leafId: string) => edit((layout) => withTerminal(layout, leafId, null)),
    [edit],
  );

  const showTerminal = useCallback(
    (terminalId: string, provider: ProviderId = 'shell'): string | null => {
      const workspace = current.current;
      if (workspace === null) return null;
      const holder = leafHolding(workspace.layout, terminalId);
      if (holder !== undefined) {
        setActive(holder.id, true);
        return holder.id;
      }
      const active = activeRef.current;
      const activeLeaf = active !== null ? findLeaf(workspace.layout, active) : undefined;
      const free =
        activeLeaf !== undefined && activeLeaf.terminalId === null
          ? activeLeaf
          : firstFreeLeaf(workspace.layout);
      if (free !== undefined) {
        edit((layout) => withTerminal(layout, free.id, terminalId));
        setActive(free.id, true);
        return free.id;
      }
      // Todos ocupados (ou sem painel): abre um novo, sem tirar a sessão de ninguém.
      const leaves = leavesOf(workspace.layout);
      if (leaves.length >= LAYOUT_LIMITS.maxLeaves) {
        notify.error(MAX_PANES_MESSAGE);
        return null;
      }
      const pane: LayoutLeaf = { type: 'leaf', id: crypto.randomUUID(), provider, terminalId };
      const layout = workspace.layout;
      const where = bestPlacement(layout, area.current);
      edit(() =>
        layout === null || where === null
          ? pane
          : splitLeaf(layout, where.leafId, where.side, pane, () => crypto.randomUUID()),
      );
      setActive(pane.id, true);
      return pane.id;
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
      // O projeto pode ter trocado durante a gravação: o pedido não é mais dele.
      if (generation.current !== mine) return null;
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
      // O projeto pode ter trocado durante a gravação: o pedido não é mais dele.
      if (generation.current !== mine) return null;
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
        // O layout guardado para desfazer não tem o painel novo (ou ainda tem o fechado): deixa de valer.
        forgetUndo();
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
    [adopt, saveNow, scheduleSave, setSaveError, forgetUndo],
  );

  /** Depois de um painel novo: a folha que não existia antes fica ativa, com foco. */
  const focusCreatedLeaf = useCallback(
    (previous: LayoutNode | null, next: WorkspaceDto) => {
      const known = new Set(leavesOf(previous).map((leaf) => leaf.id));
      const created = leavesOf(next.layout).find((leaf) => !known.has(leaf.id));
      if (created !== undefined) setActive(created.id, true);
    },
    [setActive],
  );

  const splitPane = useCallback(
    (leafId: string, side: Side, provider: ProviderId) =>
      changePanes(
        (id) => window.projectHub.workspaces.splitPane(id, leafId, side, provider),
        focusCreatedLeaf,
      ),
    [changePanes, focusCreatedLeaf],
  );

  const addPane = useCallback(
    (provider: ProviderId) => {
      // O lugar é escolhido aqui, que conhece o tamanho da área em px; com o workspace vazio, o servidor só cria o painel.
      const where = bestPlacement(current.current?.layout ?? null, area.current);
      return where === null
        ? changePanes((id) => window.projectHub.workspaces.addPane(id, provider), focusCreatedLeaf)
        : splitPane(where.leafId, where.side, provider);
    },
    [changePanes, focusCreatedLeaf, splitPane],
  );

  /** O servidor confere a sessão e a pasta; aqui só entra o painel novo que ele devolve. */
  const resumeSession = useCallback(
    (sessionId: string) =>
      changePanes(
        (id) => window.projectHub.sessions.resume({ workspaceId: id, sessionId }),
        focusCreatedLeaf,
      ),
    [changePanes, focusCreatedLeaf],
  );

  // A ponte da retomada: só o workspace do projeto desta tela responde ao pedido da aba Sessões.
  useEffect(() => {
    function onResumeRequest(event: Event) {
      const request = (event as CustomEvent<ResumeSessionRequest>).detail;
      if (request.projectId !== projectId) return;
      request.answer = resumeSession(request.sessionId);
    }
    window.addEventListener(RESUME_SESSION_REQUEST_EVENT, onResumeRequest);
    return () => window.removeEventListener(RESUME_SESSION_REQUEST_EVENT, onResumeRequest);
  }, [projectId, resumeSession]);

  const removePane = useCallback(
    (leafId: string) =>
      changePanes(
        (id) => window.projectHub.workspaces.removePane(id, leafId),
        (_previous, next) => {
          // O painel fechado levava o foco: devolve-o à folha ativa que restou, ou à primeira.
          const active = activeRef.current;
          const keep =
            active !== null && findLeaf(next.layout, active) !== undefined
              ? active
              : firstLeafId(next.layout);
          setActive(keep, keep !== null);
        },
      ),
    [changePanes, setActive],
  );

  const activate = useCallback((leafId: string) => setActive(leafId), [setActive]);
  const activateWithFocus = useCallback((leafId: string) => setActive(leafId, true), [setActive]);

  return {
    state,
    setSizes,
    equalize,
    swap,
    dock,
    applyPreset,
    undoToken,
    undo,
    forgetUndo,
    setArea,
    splitPane,
    showTerminal,
    detach,
    startSession,
    addPane,
    resumeSession,
    removePane,
    activeLeafId,
    focusLeafId,
    activate,
    activateWithFocus,
    saveError,
    flush: saveNow,
  };
}
