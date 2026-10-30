import { useEffect, useRef } from 'react';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { EmptyState } from '../components/EmptyState';
import { Hint } from '../components/Hint';
import { ICON_PROPS, Maximize2, Minimize2, SquareTerminal, X } from '../components/Icon';
import { PROJECT_UNAVAILABLE_NOTICE_ID } from '../components/project/ProjectHeader';
import { ProviderIcon } from '../components/ProviderIcon';
import { EXIT_HINT } from '../components/terminals/exit-hint';
import { TerminalView } from '../components/terminals/TerminalView';
import { MARKS, markOfTerminal } from '../state-mark';
import { PaneUsage } from './PaneUsage';

export type PaneViewProps = {
  leaf: LayoutLeaf;
  /** O item de `terminals.list` com o id da folha; indefinido se a sessão sumiu da lista. */
  terminal: TerminalSummary | undefined;
  provider: ProviderInfo | undefined;
  projectName: string;
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
};

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
  const { leaf, terminal, provider, projectName, active, busy, error } = props;
  const focusTerminal = props.focusTerminal === true;
  const unavailable = props.unavailable === true;
  // Com a pasta indisponível, o botão de iniciar ou reiniciar aponta para o aviso da página (aria-describedby).
  const unavailableLink: { 'aria-describedby'?: string } = unavailable
    ? { 'aria-describedby': PROJECT_UNAVAILABLE_NOTICE_ID }
    : {};
  const label = provider?.label ?? terminal?.provider ?? leaf.provider;
  const maximize =
    props.onMaximize === undefined ? null : (
      <MaximizeButton maximized={props.maximized === true} onClick={props.onMaximize} />
    );

  // Sem terminal para receber o foco (lançador), o foco pedido vai para o próprio painel.
  const section = useRef<HTMLElement>(null);
  const isLauncher = leaf.terminalId === null;
  useEffect(() => {
    if (focusTerminal && isLauncher) section.current?.focus();
  }, [focusTerminal, isLauncher]);

  let content;
  if (leaf.terminalId === null) {
    content = (
      <>
        <div className="pane__head">
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
    // A luz é a única marca do estado: o rótulo vai para o leitor de tela e para a dica, com a origem da sessão.
    const lightLabel = MARKS[markOfTerminal(terminal.state)].label;
    const lightTitle =
      terminal.origin === 'recovered' ? `${lightLabel} · sessão recuperada` : lightLabel;
    content = (
      <>
        <div className="pane__head">
          <span className="pane__provider" title={terminal.title}>
            <ProviderIcon provider={terminal.provider} size={16} />
            <span className="state-mark__sr">{terminal.title}</span>
          </span>
          <span className="pane__status">
            <PaneUsage key={terminal.id} usage={terminal.usage} />
            <span
              className={`pane__light pane__light--${markOfTerminal(terminal.state)}`}
              title={lightTitle}
            >
              <span aria-hidden="true" className="pane__light-dot" />
              <span className="state-mark__sr">{lightLabel}</span>
            </span>
          </span>
          <span className="pane__actions">
            {maximize}
            {terminal.missionId === undefined ? (
              <CloseButton
                disabled={busy}
                onClick={props.onClose}
                hint="Fecha o painel e finaliza o processo"
              />
            ) : (
              <>
                <Hint label="Tira o terminal do painel sem encerrar o processo">
                  <button type="button" onClick={props.onDetach}>
                    Tirar do painel
                  </button>
                </Hint>
                <CloseButton
                  disabled={busy}
                  onClick={props.onClose}
                  hint="Fecha o painel; a missão continua"
                />
              </>
            )}
          </span>
        </div>
        {error !== undefined && <p role="alert">{error}</p>}
        <div className="pane__body">
          <TerminalView terminalId={terminal.id} active={focusTerminal} />
        </div>
        <div className="pane__foot">
          {`${label} · ${projectName}`}
          {terminal.worktreeName !== undefined && <span> · {terminal.worktreeName}</span>}
          <span className="pane__hint"> · {EXIT_HINT}</span>
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
      onPointerDown={props.onPointerActivate ?? props.onActivate}
      onFocus={props.onActivate}
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
