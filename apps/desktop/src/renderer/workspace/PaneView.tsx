import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { LayoutLeaf, ProviderId, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { ConfirmInline } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { Hint } from '../components/Hint';
import {
  Columns2,
  Ellipsis,
  GripVertical,
  ICON_PROPS,
  Maximize2,
  Minimize2,
  Rows2,
  SquareTerminal,
  X,
} from '../components/Icon';
import { MenuAcoes, type AcaoMenu } from '../components/MenuAcoes';
import { PROJECT_UNAVAILABLE_NOTICE_ID } from '../components/project/ProjectHeader';
import { ProviderIcon } from '../components/ProviderIcon';
import { TerminalView } from '../components/terminals/TerminalView';
import { setAskBeforeClosing, useAskBeforeClosing } from '../close-confirm';
import { MARKS, markOfTerminal } from '../state-mark';
import { contextDetailText, modelLabel } from '../terminal-context';
import { clearTerminalFocus, setTerminalFocus } from '../terminal-focus';
import { PaneContext } from './PaneContext';
import { PaneUsage } from './PaneUsage';

/** O lado em que o painel novo entra ao dividir. */
export type SplitSide = 'right' | 'bottom';

/** Dividir o painel em dois: o novo entra no lado pedido, com metade do espaço. */
export type PaneSplit = {
  /** Por que não dá para dividir daquele lado (limite de painéis, falta de espaço); sem o lado, dá. */
  blocked: Partial<Record<SplitSide, string>>;
  /** Os outros programas que podem abrir no painel novo; vão para o menu ⋯. */
  others: readonly { id: ProviderId; label: string }[];
  /** Sem `provider`, o painel novo abre com o mesmo programa deste. */
  onSplit(side: SplitSide, provider?: ProviderId): void;
};

export type PaneViewProps = {
  leaf: LayoutLeaf;
  /** O item de `terminals.list` com o id da folha; indefinido se a sessão sumiu da lista. */
  terminal: TerminalSummary | undefined;
  provider: ProviderInfo | undefined;
  /** A sessão está viva, mas parada há algumas leituras: a marca vira o ponto vazado "Ocioso". */
  idle?: boolean;
  active: boolean;
  /** Pede o foco do terminal: só depois de um gesto do usuário neste painel ou na barra lateral. */
  focusTerminal?: boolean;
  /** Pedido de iniciar ou encerrar em curso. */
  busy: boolean;
  /** A pasta do projeto sumiu: iniciar e reiniciar ficam desabilitados, com o aviso da página como descrição. */
  unavailable?: boolean;
  error?: string;
  /** O painel recebeu o foco do teclado: marca como ativo, sem levar o foco ao terminal. */
  onActivate(): void;
  /** Clique no painel: ativa e leva o foco ao terminal. Sem ele, vale `onActivate`. */
  onPointerActivate?(): void;
  /** Iniciar, ou iniciar de novo quando a sessão terminou. */
  onStart(): void;
  /** Tirar o terminal do painel sem encerrar o processo. */
  onDetach(): void;
  /** Fechar o painel: tira a folha do layout e encerra a sessão dela (a sessão de missão só sai do painel). */
  onClose(): void;
  /** Mostrar só este painel (modo "um painel por vez"), ou, se `maximized`, voltar à grade. Duplo clique no cabeçalho faz o mesmo. */
  onMaximize?(): void;
  maximized?: boolean;
  /**
   * O ponteiro desceu na alça do cabeçalho: começa o arrasto do painel para outro lugar da grade. Sem ele (um painel
   * só, ou um por vez na tela), a alça não aparece.
   */
  onGripPointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  /** Dividir este painel. Sem ele (um painel por vez na tela), os botões de dividir não aparecem. */
  split?: PaneSplit | undefined;
};

/**
 * Fechar o painel mata um processo de verdade só no terminal avulso de um agente (Claude, Codex...) que está
 * vivo, rodando ou aguardando um pedido: o shell comum e a sessão que terminou fecham sem perguntar, e o terminal de
 * missão só sai do painel (a missão continua).
 */
export function needsCloseConfirmation(terminal: TerminalSummary): boolean {
  return terminal.kind === 'shell' && terminal.provider !== 'shell' && terminal.state !== 'exited';
}

/** Botão só de ícone que maximiza o painel ou o devolve à grade; o nome acessível diz o efeito. */
function MaximizeButton({ maximized, onClick }: { maximized: boolean; onClick(): void }) {
  const label = maximized ? 'Voltar à grade' : 'Maximizar painel';
  const Glyph = maximized ? Minimize2 : Maximize2;
  return (
    <Hint label={label}>
      <button
        type="button"
        className="pane__maximize"
        aria-label={label}
        aria-pressed={maximized}
        onClick={onClick}
      >
        <Glyph {...ICON_PROPS} />
      </button>
    </Hint>
  );
}

const SPLIT_LABEL: Record<SplitSide, string> = {
  right: 'Dividir à direita',
  bottom: 'Dividir abaixo',
};

/** O atalho de cada lado (layout-shortcuts.ts), para a dica do botão. */
const SPLIT_KEYS: Record<SplitSide, string> = {
  right: 'Alt+Shift++',
  bottom: 'Alt+Shift+−',
};

/**
 * Os dois botões de dividir. Bloqueado, o botão continua focável e a dica diz o motivo (um botão `disabled` não
 * mostra dica), então o bloqueio vai em `aria-disabled` e o clique não faz nada.
 */
function SplitButtons({ split, busy }: { split: PaneSplit; busy: boolean }) {
  return (['right', 'bottom'] as const).map((side) => {
    const reason = split.blocked[side];
    const Glyph = side === 'right' ? Columns2 : Rows2;
    return (
      <Hint
        key={side}
        label={reason ?? `${SPLIT_LABEL[side]} (mesmo programa · ${SPLIT_KEYS[side]})`}
      >
        <button
          type="button"
          className="pane__split"
          aria-label={SPLIT_LABEL[side]}
          aria-disabled={reason !== undefined || busy}
          onClick={() => {
            if (reason === undefined && !busy) split.onSplit(side);
          }}
        >
          <Glyph {...ICON_PROPS} />
        </button>
      </Hint>
    );
  });
}

/** Botão só de ícone que fecha o painel; o nome acessível é o texto, a dica descreve o efeito. */
function CloseButton({
  disabled,
  onClick,
  hint,
}: {
  disabled: boolean;
  onClick(): void;
  hint: string;
}) {
  return (
    <Hint label={hint}>
      <button
        type="button"
        className="pane__close"
        aria-label="Fechar painel"
        disabled={disabled}
        onClick={onClick}
      >
        <X {...ICON_PROPS} />
      </button>
    </Hint>
  );
}

/** Um painel do workspace: lançador, sessão em andamento ou sessão que terminou. */
export function PaneView(props: PaneViewProps) {
  const { leaf, terminal, provider, active, busy, error } = props;
  const focusTerminal = props.focusTerminal === true;
  const unavailable = props.unavailable === true;
  // Com a pasta indisponível, o botão de iniciar ou reiniciar aponta para o aviso da página (aria-describedby).
  const unavailableLink: { 'aria-describedby'?: string } = unavailable
    ? { 'aria-describedby': PROJECT_UNAVAILABLE_NOTICE_ID }
    : {};
  const label = provider?.label ?? terminal?.provider ?? leaf.provider;
  const split = props.split;
  // A alça não é botão (não faz nada ao clicar nem entra na ordem do Tab): quem usa o teclado move o painel pelos
  // atalhos. O nome fica na dica.
  const grip =
    props.onGripPointerDown === undefined ? null : (
      <span
        className="pane__grip"
        title="Arraste para mover o painel (Alt+Shift+setas troca com o vizinho)"
        onPointerDown={props.onGripPointerDown}
      >
        <GripVertical {...ICON_PROPS} />
      </span>
    );
  // Maximizar fica ao lado do contador de uso, como sempre; os de dividir vêm logo depois.
  const maximize = (
    <>
      {props.onMaximize === undefined ? null : (
        <MaximizeButton maximized={props.maximized === true} onClick={props.onMaximize} />
      )}
      {split === undefined ? null : <SplitButtons split={split} busy={busy} />}
    </>
  );

  // Pergunta de "Fechar painel e encerrar…": guarda o id do terminal perguntado, e não um sim ou não, então ela
  // some sozinha se a sessão terminar (ou o painel mudar de sessão) enquanto está aberta.
  const [askingId, setAskingId] = useState<string | null>(null);
  // A caixa "Não perguntar de novo" da pergunta: só vale se a pessoa confirmar o fechamento; "Voltar" a esquece.
  const [skipNextTime, setSkipNextTime] = useState(false);
  // De onde a pergunta foi aberta (o X ou o menu ⋯): é para lá que o foco volta se a pessoa escolher "Voltar".
  const askedFrom = useRef<'close' | 'menu'>('menu');
  // Preferência do app inteiro: desligada, o item do menu fecha direto, sem a pergunta.
  const ask = useAskBeforeClosing();

  // Sem terminal para receber o foco (lançador), o foco pedido vai para o próprio painel.
  const section = useRef<HTMLElement>(null);
  const isLauncher = leaf.terminalId === null;
  useEffect(() => {
    if (focusTerminal && isLauncher) section.current?.focus();
  }, [focusTerminal, isLauncher]);

  // Foco do teclado (diferente de `data-active`, que é só o painel escolhido): vale a posse real do teclado dentro do
  // cartão, e só na sessão viva. É daqui que a barra de status sabe que terminal está recebendo as teclas.
  const isLive = leaf.terminalId !== null && terminal !== undefined && terminal.state !== 'exited';
  const liveTitle = isLive ? terminal.title : null;
  // Onde o teclado está dentro do cartão: no terminal, ou em outro ponto (um botão do cabeçalho, o próprio cartão).
  const [keyboardAt, setKeyboardAt] = useState<'none' | 'card' | 'terminal'>('none');
  // Sem sessão viva (lançador, sessão que terminou) o painel não tem terminal com o teclado: o que sobrou de um foco
  // anterior é esquecido, para não reaparecer quando uma sessão nova começar sem um foco novo.
  if (!isLive && keyboardAt !== 'none') setKeyboardAt('none');
  useEffect(() => {
    // O navegador nem sempre avisa (`blur`) quando o elemento focado sai do DOM (um terminal que troca, como ao passar
    // de aba no modo "um painel por vez"): o foco real é o que o documento diz, e o estado se acerta por ele.
    const active = document.activeElement;
    if (keyboardAt !== 'none' && section.current?.contains(active) === false) {
      setKeyboardAt('none');
      return;
    }
    if (liveTitle !== null && keyboardAt !== 'none') {
      // Também segue o título: se a sessão for renomeada com o painel focado, a barra de status acompanha. O lugar do
      // foco se relê do documento (o mesmo critério dos eventos), então o modo "um painel por vez" também o acerta.
      const inTerminal = active instanceof Element && active.closest('.terminal-view') !== null;
      setTerminalFocus({ key: leaf.id, title: liveTitle, inTerminal });
    } else {
      clearTerminalFocus(leaf.id);
    }
  }, [leaf.id, liveTitle, keyboardAt]);
  // Painel que sai da tela (ou muda de folha) com o foco não deixa a barra de status apontando para ele.
  useEffect(() => () => clearTerminalFocus(leaf.id), [leaf.id]);

  let content;
  if (leaf.terminalId === null) {
    content = (
      <>
        <div className="pane__head">
          {grip}
          <span className="pane__title">{label}</span>
          <span className="pane__actions">
            {maximize}
            <CloseButton disabled={busy} onClick={props.onClose} hint="Fecha o painel" />
          </span>
        </div>
        <div className="pane__launcher">
          <EmptyState
            icon={SquareTerminal}
            title="Nenhuma sessão neste painel"
            hint={
              provider?.available === false && provider.reason !== undefined ? (
                <span role="status">{provider.reason}</span>
              ) : undefined
            }
            action={
              <button
                type="button"
                className="btn-primary"
                disabled={busy || unavailable || provider?.available === false}
                {...unavailableLink}
                onClick={props.onStart}
              >
                {`Iniciar ${label}`}
              </button>
            }
          />
          {error !== undefined && <p role="alert">{error}</p>}
        </div>
      </>
    );
  } else if (terminal === undefined || terminal.state === 'exited') {
    // Sem registro não dá para saber se a sessão era de missão: oferecer reiniciar é o caso comum.
    const canRestart = terminal?.missionId === undefined;
    // Conversa do agente não volta com o contexto anterior: o rótulo e a dica dizem isso.
    const isAgent = terminal?.kind === 'agent';
    const restart = (
      <button
        type="button"
        disabled={busy || unavailable}
        {...unavailableLink}
        onClick={props.onStart}
      >
        {isAgent ? 'Iniciar nova conversa' : 'Iniciar de novo'}
      </button>
    );
    content = (
      <>
        <div className="pane__head">
          {grip}
          <div className="pane__notice">
            <span role="status">A sessão terminou.</span>
            <span className="pane__actions">
              {canRestart &&
                (isAgent ? (
                  <Hint label="O contexto da conversa anterior não volta">{restart}</Hint>
                ) : (
                  restart
                ))}
              {maximize}
              <CloseButton disabled={busy} onClick={props.onClose} hint="Fecha o painel" />
            </span>
          </div>
        </div>
        {error !== undefined && <p role="alert">{error}</p>}
        {terminal !== undefined && (
          <div className="pane__body">
            <TerminalView terminalId={terminal.id} active={focusTerminal} />
          </div>
        )}
      </>
    );
  } else {
    // O selo do estado tem forma e rótulo visíveis (a cor nunca é a única pista); a origem da sessão vai na dica.
    const mark = markOfTerminal(terminal.state, props.idle);
    const { glyph, label: markLabel } = MARKS[mark];
    const markTitle =
      terminal.origin === 'recovered' ? `${markLabel} · sessão recuperada` : markLabel;
    // Sem modelo conhecido (sem resposta ainda, outro programa, id que a tabela não reconhece): o nome do programa.
    const model = (terminal.model === undefined ? undefined : modelLabel(terminal.model)) ?? label;
    // O que saiu do cabeçalho de uma linha vai na dica do título: projeto, modelo (ou programa), worktree e contexto.
    const details = [
      terminal.projectName,
      model,
      terminal.worktreeName,
      terminal.context === undefined ? undefined : contextDetailText(terminal.context),
    ]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' · ');
    // O menu ⋯ guarda as ações do painel, e o X ao lado fecha com um clique. Ocupado (um pedido em curso), os itens
    // e o X ficam desabilitados.
    const askToClose = needsCloseConfirmation(terminal);
    // Dividir com outro programa: os botões do cabeçalho abrem o mesmo; a escolha de outro mora no menu.
    const splitWithOther: AcaoMenu[] =
      split === undefined
        ? []
        : (['right', 'bottom'] as const).flatMap((side) =>
            split.others.map((other) => ({
              rotulo: `${SPLIT_LABEL[side]} com ${other.label}`,
              onSelecionar: () => split.onSplit(side, other.id),
              desabilitada: busy || split.blocked[side] !== undefined,
              ...(split.blocked[side] !== undefined ? { dica: split.blocked[side] } : {}),
            })),
          );
    const closeActions: AcaoMenu[] =
      terminal.missionId !== undefined
        ? [
            { rotulo: 'Tirar do painel', onSelecionar: props.onDetach, desabilitada: busy },
            {
              rotulo: 'Fechar painel (a missão continua)',
              onSelecionar: props.onClose,
              desabilitada: busy,
            },
          ]
        : askToClose
          ? ask
            ? [
                {
                  rotulo: 'Fechar painel e encerrar…',
                  // O menu fecha e desmonta ao escolher: a pergunta vive aqui, fora dele.
                  onSelecionar: () => {
                    askedFrom.current = 'menu';
                    setSkipNextTime(false);
                    setAskingId(terminal.id);
                  },
                  perigosa: true,
                  desabilitada: busy,
                },
              ]
            : [
                {
                  // A pessoa pediu para não perguntar mais: o item ainda diz que o processo para, e fecha direto.
                  rotulo: 'Fechar painel e encerrar',
                  onSelecionar: props.onClose,
                  perigosa: true,
                  desabilitada: busy,
                },
              ]
          : [{ rotulo: 'Fechar painel', onSelecionar: props.onClose, desabilitada: busy }];
    const actions = [...splitWithOther, ...closeActions];
    const asking = askToClose && askingId === terminal.id;
    // O X faz o mesmo que o item de fechar do menu: no agente avulso vivo pergunta antes (se a pergunta estiver
    // ligada); no shell comum e no terminal de missão fecha direto (a missão continua).
    const closeHint =
      terminal.missionId !== undefined
        ? 'Fecha o painel (a missão continua)'
        : askToClose
          ? `Fecha o painel e encerra o ${label}`
          : 'Fecha o painel';
    const closeFromButton =
      terminal.missionId === undefined && askToClose && ask
        ? () => {
            askedFrom.current = 'close';
            setSkipNextTime(false);
            setAskingId(terminal.id);
          }
        : props.onClose;
    content = (
      <>
        <div className="pane__head pane__head--live">
          {grip}
          <span className="pane__provider">
            <ProviderIcon provider={terminal.provider} size={16} />
          </span>
          <span className="pane__title" title={details}>
            {terminal.title}
          </span>
          <span className={`pane__state state-mark state-mark--${mark}`} title={markTitle}>
            <span aria-hidden="true" className="state-mark__glyph">
              {glyph}
            </span>
            <span className="state-mark__sr">{markLabel}</span>
          </span>
          <PaneUsage key={terminal.id} usage={terminal.usage} />
          <span className="pane__actions">
            {maximize}
            <MenuAcoes
              rotulo="Mais ações do painel"
              icone={<Ellipsis {...ICON_PROPS} />}
              acoes={actions}
            />
            <CloseButton disabled={busy} onClick={closeFromButton} hint={closeHint} />
          </span>
          <PaneContext context={terminal.context} />
        </div>
        {asking && (
          <div className="pane__confirm">
            <ConfirmInline
              question={`Encerrar o ${label} e fechar o painel? O processo para.`}
              confirmLabel="Fechar e encerrar"
              disabled={busy}
              focusBack
              extra={
                <label className="pane__confirm-skip">
                  <input
                    type="checkbox"
                    checked={skipNextTime}
                    disabled={busy}
                    onChange={(event) => setSkipNextTime(event.target.checked)}
                  />
                  Não perguntar de novo
                </label>
              }
              onConfirm={() => {
                setAskingId(null);
                // Só confirmar guarda a escolha: quem marcou a caixa e voltou continua sendo perguntado.
                if (skipNextTime) setAskBeforeClosing(false);
                props.onClose();
              }}
              onCancel={() => {
                setAskingId(null);
                setSkipNextTime(false);
                // O foco volta para onde a pergunta nasceu (o X ou o menu ⋯), em vez de se perder no corpo da página.
                section.current
                  ?.querySelector<HTMLElement>(
                    askedFrom.current === 'close' ? '.pane__close' : '.menu-acoes__gatilho',
                  )
                  ?.focus();
              }}
            />
          </div>
        )}
        {error !== undefined && <p role="alert">{error}</p>}
        <div className="pane__body">
          <TerminalView terminalId={terminal.id} active={focusTerminal} />
        </div>
      </>
    );
  }

  return (
    <section
      ref={section}
      className="pane"
      aria-label={`Painel ${label}`}
      data-active={active ? 'true' : 'false'}
      tabIndex={-1}
      onPointerDown={(event) => {
        // O menu ⋯ é um portal, mas os eventos do React sobem por ele até aqui: um clique num item não é um clique
        // no painel (pedir o foco do terminal tiraria o foco do menu e o fecharia antes de o item ser escolhido).
        if (!event.currentTarget.contains(event.target as Node)) return;
        (props.onPointerActivate ?? props.onActivate)();
      }}
      onFocus={(event) => {
        props.onActivate();
        // O menu ⋯ é um portal, mas o foco do React sobe por ele até aqui: o foco que cai no menu não é o terminal
        // com o teclado. Só o foco dentro do DOM do cartão conta.
        if (event.currentTarget.contains(event.target as Node)) {
          setKeyboardAt(
            (event.target as Element).closest('.terminal-view') === null ? 'card' : 'terminal',
          );
        }
      }}
      onBlur={(event) => {
        // O blur de um item do menu (portal) não diz nada sobre o cartão.
        if (!event.currentTarget.contains(event.target as Node)) return;
        // Ir de um elemento do cartão a outro (ou ao terminal) mantém o foco; sair do cartão, inclusive para o menu
        // no portal, tira.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setKeyboardAt('none');
      }}
      onDoubleClick={(event) => {
        // Duplo clique no cabeçalho (fora dos botões) maximiza, ou devolve à grade.
        const target = event.target as HTMLElement;
        if (target.closest('.pane__head') === null || target.closest('button') !== null) return;
        props.onMaximize?.();
      }}
    >
      {content}
    </section>
  );
}
