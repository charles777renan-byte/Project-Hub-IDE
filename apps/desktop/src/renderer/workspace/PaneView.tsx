import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { ConfirmButton } from '../components/ConfirmButton';
import { StateMark } from '../components/StateMark';
import { TerminalView } from '../components/terminals/TerminalView';
import { markOfTerminal } from '../state-mark';

export type PaneViewProps = {
  leaf: LayoutLeaf;
  /** O item de `terminals.list` com o id da folha; indefinido se a sessão sumiu da lista. */
  terminal: TerminalSummary | undefined;
  provider: ProviderInfo | undefined;
  projectName: string;
  active: boolean;
  /** Pedido de iniciar ou encerrar em curso. */
  busy: boolean;
  error?: string;
  onActivate(): void;
  /** Iniciar, ou iniciar de novo quando a sessão terminou. */
  onStart(): void;
  /** Encerrar a sessão; não se aplica a sessão de missão. */
  onEnd(): void;
  /** Tirar o terminal do painel sem encerrar o processo. */
  onDetach(): void;
};

/** Um painel do workspace: lançador, sessão em andamento ou sessão que terminou. */
export function PaneView(props: PaneViewProps) {
  const { leaf, terminal, provider, projectName, active, busy, error } = props;
  const label = provider?.label ?? leaf.provider;

  let content;
  if (leaf.terminalId === null) {
    content = (
      <div className="pane__launcher">
        <strong>{label}</strong>
        <p>Nenhuma sessão neste painel</p>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || provider?.available === false}
          onClick={props.onStart}
        >
          {`Iniciar ${label}`}
        </button>
        {provider?.available === false && provider.reason !== undefined && (
          <p role="status">{provider.reason}</p>
        )}
        {error !== undefined && <p role="alert">{error}</p>}
      </div>
    );
  } else if (terminal === undefined || terminal.state === 'exited') {
    // Sem registro não dá para saber se a sessão era de missão: oferecer reiniciar é o caso comum.
    const canRestart = terminal?.missionId === undefined;
    content = (
      <>
        <div className="pane__head">
          <div className="pane__notice" role="status">
            <span>A sessão terminou.</span>
            <span className="pane__actions">
              {canRestart && (
                <button type="button" disabled={busy} onClick={props.onStart}>
                  Iniciar de novo
                </button>
              )}
              <button type="button" onClick={props.onDetach}>
                Limpar painel
              </button>
            </span>
          </div>
        </div>
        {error !== undefined && <p role="alert">{error}</p>}
        {terminal !== undefined && (
          <div className="pane__body">
            <TerminalView terminalId={terminal.id} active={active} />
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
          <TerminalView terminalId={terminal.id} active={active} />
        </div>
        <div className="pane__foot">
          {`${label} · ${projectName}`}
          {terminal.worktreeName !== undefined && <span> · {terminal.worktreeName}</span>}
        </div>
      </>
    );
  }

  return (
    <section
      className="pane"
      aria-label={`Painel ${label}`}
      data-active={active ? 'true' : 'false'}
      onPointerDown={props.onActivate}
      onFocus={props.onActivate}
    >
      {content}
    </section>
  );
}
