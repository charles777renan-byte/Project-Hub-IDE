import { useEffect, useId, useState, type ReactNode } from 'react';
import type { LoginDto, LoginProblem } from '@project-hub/contracts';
import { loginInProgress, type LoginControls } from '../../use-login';
import { ChevronDown, ChevronRight, CircleCheck, CircleDot, ICON_PROPS } from '../Icon';
import { LoginTerminal } from './LoginTerminal';

const TEXT = {
  steps: 'Passos do login',
  opened: (program: string, account: string) => `${program} aberto na pasta da conta ${account}`,
  opening: 'Abrindo o programa…',
  browser: 'Entre pelo navegador',
  browserBody:
    'O programa abriu o login no seu navegador padrão. Entre com a conta que você quer usar aqui.',
  browserWaiting: 'Esperando o programa informar o endereço do login.',
  otherAccount:
    'Para entrar com outra conta, saia da atual no navegador ou abra o endereço numa janela anônima.',
  openAgain: 'Abrir de novo',
  copy: 'Copiar endereço',
  copied: 'Endereço copiado.',
  check: 'Conferir a conta conectada',
  verifying: 'Lendo a conta que o programa conectou…',
  checkTitle: 'O programa conectou esta conta:',
  server: 'Servidor do login:',
  running: 'Login em andamento',
  noIdentity: 'O programa confirma o login, mas não informa qual é a conta.',
  codexIdentity: 'Conectada pelo ChatGPT. O Codex não informa qual conta.',
  duplicate: (name: string) =>
    `É a mesma conta de “${name}”. Se não era a intenção, escolha “Não é esta conta”.`,
  finish: 'Concluir',
  notThis: 'Não é esta conta',
  terminal: 'Ver o terminal do programa',
  terminalNote: 'Se o programa pedir um código ou uma escolha, responda aqui.',
  cancel: 'Cancelar',
  expires: (time: string) => `expira em ${time}`,
  retry: 'Tentar de novo',
  close: 'Fechar',
  timedOut: 'O login expirou sem a autorização no navegador.',
  failed: 'O login não foi concluído.',
} as const;

const PROBLEMS: Record<LoginProblem, string> = {
  'not-installed': 'O programa não está instalado neste computador.',
  'start-failed': 'Não foi possível abrir o programa para o login.',
  'not-connected': 'O login não foi concluído. A conta continua sem login.',
  'status-failed': 'O login terminou, mas não foi possível ler a conta conectada.',
};

/** Tempo que falta até o login expirar, em `m:ss`, atualizado a cada segundo. */
function useRemaining(expiresAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const end = Date.parse(expiresAt);
  const seconds = Number.isFinite(end) ? Math.max(0, Math.floor((end - now) / 1000)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type StepState = 'done' | 'current' | 'todo';

/** Um passo: feito (marca de concluído), atual (marca cheia e `aria-current`) ou por vir (o número). */
function Step({
  number,
  state,
  title,
  children,
}: {
  number: number;
  state: StepState;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li
      className={`login-step login-step--${state}`}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <span className="login-step__mark" aria-hidden="true">
        {state === 'done' ? (
          <CircleCheck {...ICON_PROPS} size={16} />
        ) : state === 'current' ? (
          <CircleDot {...ICON_PROPS} size={16} />
        ) : (
          number
        )}
      </span>
      <div className="login-step__text">
        <p className="login-step__title">{title}</p>
        {state === 'current' && children !== undefined ? (
          <div className="login-step__body">{children}</div>
        ) : null}
      </div>
    </li>
  );
}

function stepStates(login: LoginDto): [StepState, StepState, StepState] {
  if (login.phase === 'starting') return ['current', 'todo', 'todo'];
  if (login.phase === 'browser') return ['done', 'current', 'todo'];
  return ['done', 'done', 'current'];
}

/**
 * O login de uma conta, dentro da linha dela, em três passos: o programa aberto na pasta da conta, a entrada pelo
 * navegador padrão do computador e a conferência da conta conectada. O estado do login não traz o endereço: o guia
 * mostra só o servidor, e abrir ou copiar é pedido ao processo principal. Quando o login falha ou expira, a linha
 * diz o que houve e oferece tentar de novo.
 */
export function LoginGuide({
  controls,
  program,
  account,
  onRetry,
}: {
  controls: LoginControls;
  /** Nome do programa ("Claude Code"). */
  program: string;
  /** Nome da conta ("Trabalho"). */
  account: string;
  onRetry: () => void;
}) {
  const { login } = controls;
  if (login === null) return null;
  if (!loginInProgress(login)) {
    const message =
      login.phase === 'timed-out'
        ? TEXT.timedOut
        : login.problem === undefined
          ? TEXT.failed
          : PROBLEMS[login.problem];
    return (
      <div className="login login--ended">
        <p role="alert" className="settings__error">
          {message}
        </p>
        <div className="login__row">
          <button type="button" className="btn-secondary" onClick={onRetry}>
            {TEXT.retry}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void controls.cancel()}>
            {TEXT.close}
          </button>
        </div>
      </div>
    );
  }
  return <Progress controls={controls} login={login} program={program} account={account} />;
}

function Progress({
  controls,
  login,
  program,
  account,
}: {
  controls: LoginControls;
  login: LoginDto;
  program: string;
  account: string;
}) {
  const terminalId = useId();
  const remaining = useRemaining(login.expiresAt);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [first, second, third] = stepStates(login);
  const hasAddress = login.host !== undefined;

  async function run(action: () => Promise<string | null>, onDone?: () => void) {
    setError(null);
    const failure = await action();
    if (failure === null) onDone?.();
    else setError(failure);
  }

  return (
    <div className="login">
      <p className="login__head">
        <span>{TEXT.running}</span>
        <span className="login__timer">{TEXT.expires(remaining)}</span>
      </p>
      <ol aria-label={TEXT.steps} className="login__steps">
        <Step number={1} state={first} title={TEXT.opened(program, account)}>
          <p>{TEXT.opening}</p>
        </Step>
        <Step number={2} state={second} title={TEXT.browser}>
          <p>{hasAddress ? TEXT.browserBody : TEXT.browserWaiting}</p>
          {hasAddress ? (
            <p>
              {TEXT.server} <span className="login__host">{login.host}</span>
            </p>
          ) : null}
          <div className="login__row">
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasAddress}
              onClick={() => void run(controls.openUrl)}
            >
              {TEXT.openAgain}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!hasAddress}
              onClick={() => void run(controls.copyUrl, () => setCopied(true))}
            >
              {TEXT.copy}
            </button>
            {copied ? (
              <span role="status" className="login__note">
                {TEXT.copied}
              </span>
            ) : null}
          </div>
          <p className="login__note">{TEXT.otherAccount}</p>
        </Step>
        <Step number={3} state={third} title={TEXT.check}>
          {login.phase === 'confirm' ? (
            <>
              <p className="login__check-title">{TEXT.checkTitle}</p>
              {login.identity === undefined ? (
                <p>{login.provider === 'codex' ? TEXT.codexIdentity : TEXT.noIdentity}</p>
              ) : (
                <p className="login__identity">{login.identity}</p>
              )}
              {login.duplicateOf === undefined ? null : (
                <p className="login__warn">{TEXT.duplicate(login.duplicateOf)}</p>
              )}
              <div className="login__row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void run(controls.confirm)}
                >
                  {TEXT.finish}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void run(controls.reject)}
                >
                  {TEXT.notThis}
                </button>
              </div>
            </>
          ) : (
            <p>{TEXT.verifying}</p>
          )}
        </Step>
      </ol>
      {error === null ? null : (
        <p role="alert" className="settings__error">
          {error}
        </p>
      )}
      <div className="login__foot">
        <button
          type="button"
          className="login__toggle"
          aria-expanded={terminalOpen}
          aria-controls={terminalId}
          onClick={() => setTerminalOpen((open) => !open)}
        >
          {terminalOpen ? <ChevronDown {...ICON_PROPS} /> : <ChevronRight {...ICON_PROPS} />}
          {TEXT.terminal}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void run(controls.cancel)}>
          {TEXT.cancel}
        </button>
      </div>
      <div id={terminalId} className="login__terminal" hidden={!terminalOpen}>
        {terminalOpen ? (
          <>
            <p className="login__note">{TEXT.terminalNote}</p>
            <LoginTerminal
              output={controls.output}
              write={controls.write}
              resize={controls.resize}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
