import type { BrowserTabDto, PreviewStateDto } from '@project-hub/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useOverlayOpen } from '../../overlay-guard';
import {
  requestShowTerminal,
  TOGGLE_RIGHT_EXPANDED_EVENT,
  TOGGLE_RIGHT_PANEL_EVENT,
} from '../../right-panel-events';
import { useBrowser } from '../../use-browser';
import { usePreview } from '../../use-preview';
import { BrowserPageTabs } from './BrowserPageTabs';
import { BrowserToolbar } from './BrowserToolbar';
import { BrowserViewport } from './BrowserViewport';
import { PreviewCard, previewSituation } from './PreviewCard';

function toggleExpanded() {
  window.dispatchEvent(new Event(TOGGLE_RIGHT_EXPANDED_EVENT));
}

/** Se o endereço da aba é da mesma origem do endereço guardado do preview. */
function sameOrigin(url: string, previewUrl: string | null): boolean {
  if (previewUrl === null) return false;
  try {
    return new URL(url).origin === new URL(previewUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Se a aba dispara o preview sozinha. Só o que não precisa de pergunta: endereço fixo, comando aprovado que não
 * mudou, ou site estático. Uma aba com endereço nunca dispara, fora a aba restaurada do site estático que não
 * carregou (o servidor do app ainda não subiu nesta abertura). Depois de uma subida que não deu certo, quem tenta
 * de novo é a pessoa, pelo cartão: senão cada aba vazia abriria mais um terminal.
 */
function startsAlone(tab: BrowserTabDto, state: PreviewStateDto): boolean {
  const { approval, detection, status } = state;
  const site = approval.kind === 'none' && detection.kind === 'static';
  if (tab.error !== null) return site && sameOrigin(tab.url, state.url);
  if (tab.url !== '') return false;
  if (status !== 'idle' && status !== 'running' && status !== 'starting') return false;
  if (approval.kind === 'address') return true;
  if (approval.kind === 'script') return !approval.changed;
  return site;
}

/**
 * A aba Navegador do painel direito: o navegador interno do projeto. Cada projeto tem as suas abas e a sua sessão
 * (cookies e logins não passam de um projeto para outro). Este componente só mostra o que o processo principal
 * publica e manda pedidos: quem carrega as páginas e decide o que pode abrir é o processo principal.
 *
 * Com o foco dentro de uma página, as teclas não chegam ao app. Os atalhos que importam voltam por
 * `browser.onShortcut`: Ctrl+L foca o endereço, F6 foca a barra e Ctrl+Alt+B recolhe o painel.
 *
 * A página é desenhada por cima da janela, e nada do app fica na frente dela. Enquanto há um menu ou diálogo do app
 * aberto (o menu Mais ações daqui, a paleta de comandos, uma confirmação), a página vira imagem parada.
 *
 * Uma aba de página vazia abre o preview do projeto: sozinha, quando não há o que perguntar, ou com o cartão do
 * preview no lugar do aviso. Quem decide o que roda é o processo principal; daqui só sai "iniciar nesta aba".
 */
export function NavigatorTab({
  projectId,
  expanded = false,
}: {
  projectId: string;
  /** O painel direito ocupa toda a largura do corpo da janela. Quem guarda esse estado é o `App`. */
  expanded?: boolean;
}) {
  const browser = useBrowser(projectId);
  const preview = usePreview(projectId);
  const overlayOpen = useOverlayOpen();
  const [menuOpen, setMenuOpen] = useState(false);
  const addressRef = useRef<HTMLInputElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  /** As abas em que a pessoa dispensou o cartão ("Agora não", "Fechar"). */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  /** A aba que mostra o cartão de "Preview do projeto…". */
  const [manageTab, setManageTab] = useState<string | null>(null);
  /** "Preview do projeto…" pediu uma aba nova: a próxima aba vazia que não é `from` mostra o cartão. */
  const [manageNext, setManageNext] = useState<{ from: string } | null>(null);
  /** As abas que já dispararam o preview nesta montagem. */
  const fired = useRef(new Set<string>());

  useEffect(
    () =>
      window.projectHub.browser.onShortcut((event) => {
        if (event.projectId !== projectId) return;
        if (event.action === 'focus-address') addressRef.current?.focus();
        else if (event.action === 'focus-toolbar') firstButtonRef.current?.focus();
        else window.dispatchEvent(new Event(TOGGLE_RIGHT_PANEL_EVENT));
      }),
    [projectId],
  );

  // Sair da aba (outra aba do painel, outro projeto) com o painel expandido devolve o tamanho: o botão de restaurar
  // mora aqui, e sem ele a pessoa ficaria com as outras abas do painel na largura toda.
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  useEffect(
    () => () => {
      if (expandedRef.current) toggleExpanded();
    },
    [],
  );

  const { state, activeTab } = browser;
  const previewState = preview.state;
  const { start } = preview;

  // A aba nova pedida por "Preview do projeto…" chegou: é nela que o cartão aparece. Ajuste durante a renderização,
  // como a documentação do React recomenda para estado derivado de uma propriedade.
  if (
    manageNext !== null &&
    activeTab !== null &&
    activeTab.id !== manageNext.from &&
    activeTab.url === ''
  ) {
    setManageNext(null);
    setManageTab(activeTab.id);
  }
  const waitingManage = manageNext !== null;

  useEffect(() => {
    if (activeTab === null || previewState === null || waitingManage) return;
    const { id } = activeTab;
    if (manageTab === id || dismissed.has(id) || fired.current.has(id)) return;
    if (!startsAlone(activeTab, previewState)) return;
    fired.current.add(id);
    void start(id);
  }, [activeTab, previewState, waitingManage, manageTab, dismissed, start]);

  if (browser.failure !== null) {
    return (
      <div className="browser">
        <p className="browser__failure" role="alert">
          {browser.failure}
        </p>
      </div>
    );
  }
  if (state === null || activeTab === null) {
    return (
      <div className="browser">
        <p className="browser__loading">Carregando…</p>
      </div>
    );
  }

  const tabId = activeTab.id;
  const empty = activeTab.url === '' && activeTab.error === null;

  function startHere(options?: { restart?: boolean }) {
    fired.current.add(tabId);
    setManageTab(null);
    void start(tabId, options);
  }

  function dismiss() {
    setManageTab(null);
    setManageNext(null);
    setDismissed((current) => new Set(current).add(tabId));
  }

  function openPreviewCard() {
    if (empty) {
      setManageTab(tabId);
      return;
    }
    setManageNext({ from: tabId });
    browser.openTab();
  }

  let emptyContent: ReactNode;
  let onOpenAddress: (() => void) | undefined;
  if (empty && previewState !== null) {
    const managing = manageTab === tabId;
    // Um pedido recusado deixa o cartão no modo em que a pessoa age: "abrindo…" não seria verdade.
    const mode = managing || preview.error !== null ? 'manage' : 'auto';
    const situation = previewSituation(previewState, mode);
    if (managing || (situation !== null && !dismissed.has(tabId))) {
      emptyContent = (
        <PreviewCard
          // O que a pessoa escolheu no cartão (outro script, o campo de endereço) é desta aba e deste modo.
          key={`${tabId}:${mode}`}
          state={previewState}
          mode={mode}
          error={preview.error}
          onApprove={(script, shownBody) => {
            void preview.approve(script, shownBody).then((approved) => {
              if (approved) startHere();
            });
          }}
          onSetAddress={(text) => {
            void preview.setAddress(text).then((saved) => {
              if (saved) startHere();
            });
          }}
          onStart={startHere}
          onForget={() => void preview.forget()}
          onShowTerminal={(terminalId) => requestShowTerminal(projectId, terminalId)}
          onDismiss={dismiss}
        />
      );
    } else if (situation === null) {
      onOpenAddress = () => setManageTab(tabId);
    }
  }

  const canStartServer =
    previewState !== null &&
    activeTab.error !== null &&
    previewState.approval.kind === 'script' &&
    !previewState.approval.changed &&
    sameOrigin(activeTab.url, previewState.url);

  return (
    <div className="browser">
      <BrowserPageTabs
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={browser.selectTab}
        onClose={browser.closeTab}
        onNew={browser.openTab}
      />
      <BrowserToolbar
        tab={activeTab}
        notice={browser.notice}
        expanded={expanded}
        onNavigate={browser.navigate}
        onBack={browser.back}
        onForward={browser.forward}
        onReload={browser.reload}
        onStop={browser.stop}
        onToggleExpand={toggleExpanded}
        onOpenExternal={browser.openExternal}
        onOpenDevtools={browser.openDevtools}
        onClearData={browser.clearData}
        onOpenPreview={openPreviewCard}
        onMenuOpenChange={setMenuOpen}
        addressRef={addressRef}
        firstButtonRef={firstButtonRef}
      />
      <BrowserViewport
        projectId={projectId}
        tab={activeTab}
        hidden={false}
        frozen={overlayOpen || menuOpen}
        onRetry={browser.reload}
        emptyContent={emptyContent}
        onOpenAddress={onOpenAddress}
        onStartServer={canStartServer ? () => startHere() : undefined}
      />
    </div>
  );
}
