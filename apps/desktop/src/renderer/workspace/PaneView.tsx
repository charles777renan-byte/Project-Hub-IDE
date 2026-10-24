import { useEffect, useRef } from 'react';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { Hint } from '../components/Hint';
import { ICON_PROPS, SquareTerminal, X } from '../components/Icon';
import { StateMark } from '../components/StateMark';
import { EXIT_HINT } from '../components/terminals/exit-hint';
import { TerminalView } from '../components/terminals/TerminalView';
import { markOfTerminal } from '../state-mark';

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
};

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
      <button type="button" aria-label="Fechar painel" disabled={disabled} onClick={onClick}>
        <X {...ICON_PROPS} />
      </button>
    </Hint>
  );
}

/** Um painel do workspace: lançador, sessão em andamento ou sessão que terminou. */
export function PaneView(props: PaneViewProps) {
  const { leaf, terminal, provider, projectName, active, busy, error } = props;
  const focusTerminal = props.focusTerminal === true;
  const label = provider?.label ?? terminal?.provider ?? leaf.provider;

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
                disabled={busy || provider?.available === false}
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
    content = (
      <>
        <div className="pane__head">
          <div className="pane__notice">
            <span role="status">A sessão terminou.</span>
            <span className="pane__actions">
              {canRestart && (
                <button type="button" disabled={busy} onClick={props.onStart}>
                  Iniciar de novo
                </button>
              )}
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
    content = (
      <>
        <div className="pane__head">
          <span className="pane__title" title={terminal.title}>
            {terminal.title}
          </span>
          <StateMark kind={markOfTerminal(terminal.state)} withLabel />
          <span className="pane__tag">
            {terminal.origin === 'recovered' ? 'recuperada' : 'nova'}
          </span>
          <span className="pane__actions">
            {terminal.missionId === undefined ? (
              <ConfirmButton
                label="Fechar painel"
                question="Fechar o painel? O processo será finalizado."
                confirmLabel="Fechar painel"
                hint="Fecha o painel e finaliza o processo"
                disabled={busy}
                onConfirm={props.onClose}
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
    >
      {content}
    </section>
  );
}
