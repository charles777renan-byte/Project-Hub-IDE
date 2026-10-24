import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { SquareTerminal } from '../components/Icon';
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
  /** Encerrar a sessão; não se aplica a sessão de missão. */
  onEnd(): void;
  /** Tirar o terminal do painel sem encerrar o processo. */
  onDetach(): void;
  /** Limpar um painel cuja sessão terminou: encerra a sessão (idempotente) e deixa o painel vazio. */
  onClear(): void;
};

/** Um painel do workspace: lançador, sessão em andamento ou sessão que terminou. */
export function PaneView(props: PaneViewProps) {
  const { leaf, terminal, provider, projectName, active, busy, error } = props;
  const focusTerminal = props.focusTerminal === true;
  const label = provider?.label ?? terminal?.provider ?? leaf.provider;

  let content;
  if (leaf.terminalId === null) {
    content = (
      <>
        <div className="pane__head">
          <span className="pane__title">{label}</span>
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
              <button type="button" onClick={props.onClear}>
                Limpar painel
              </button>
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
            {terminal.missionId === undefined && (
              <ConfirmButton
                label="Encerrar"
                question="Encerrar a sessão? O processo será finalizado."
                confirmLabel="Encerrar"
                disabled={busy}
                onConfirm={props.onEnd}
              />
            )}
            <button type="button" onClick={props.onDetach}>
              Tirar do painel
            </button>
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
