import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AccountDto, AppResult } from '@project-hub/contracts';
import { ADD_PROJECT_REQUEST_EVENT, type AddProjectRequest } from '../../projects-events';
import { settingsPath } from '../../routes';
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  FolderPlus,
  ICON_PROPS,
  LoaderCircle,
  RefreshCw,
  type LucideIcon,
} from '../Icon';

const TEXT = {
  title: 'Boas-vindas ao Project Hub',
  lead: 'Você descreve o que quer numa missão. O agente planeja, trabalha numa cópia separada do projeto e pede a sua aprovação antes das ações protegidas.',
  checks: 'Antes de começar',
  recheck: 'Conferir de novo',
  checking: 'Conferindo',
  unread: 'Não foi possível conferir',
  installed: 'Instalado',
  missing: 'Não encontrado',
  git: 'Git',
  gitHint:
    'Instale o Git e confira de novo. Sem ele, o app não cria as cópias de trabalho das missões.',
  claude: 'Claude Code',
  claudeHint: 'As missões rodam no Claude Code. Instale-o e confira de novo.',
  test: 'Testar',
  testClaude: 'Testar Claude Code',
  testing: 'Testando',
  answered: (version: string) => `Respondeu: ${version}`,
  testFailed: 'O teste não terminou.',
  account: 'Conta do Claude Code',
  connected: 'Conectada',
  signedOut: 'Sem login',
  accountHint: 'Conecte uma conta para o Claude Code responder nas missões.',
  openAccounts: 'Abrir Contas',
  data: 'Onde ficam os seus dados',
  dataDir: 'Os dados do app ficam neste computador, em',
  worktrees: 'Cada missão trabalha numa cópia separada do projeto, em',
  logins:
    'O login de cada programa fica no próprio programa. O Project Hub não vê a senha nem o token.',
  approvals: 'O agente pede a sua aprovação antes das ações protegidas.',
  ready: 'Tudo pronto para o primeiro projeto.',
  partial: 'Você pode adicionar o projeto agora e resolver o que falta depois.',
  addProject: 'Adicionar projeto',
} as const;

/** O estado de uma conferência: lendo, pronta, faltando, ou sem leitura. */
type CheckState = 'checking' | 'ok' | 'missing' | 'unread';

type Environment = {
  git: CheckState;
  gitVersion?: string;
  claude: CheckState;
  account: CheckState;
  dataDir?: string;
  worktreesRoot?: string;
};

const CHECKING: Environment = { git: 'checking', claude: 'checking', account: 'checking' };

const STATE_ICON: Record<CheckState, LucideIcon> = {
  checking: LoaderCircle,
  ok: CircleCheck,
  missing: CircleSlash,
  unread: CircleAlert,
};

/** A conta serve para abrir o Claude Code: assinatura conectada, ou chave de API guardada. */
function usable(account: AccountDto): boolean {
  if (account.kind === 'api') return account.keyState === 'stored' || account.keyState === 'locked';
  return account.state === 'connected';
}

/** Lê uma parte do ambiente. Falha, exceção ou ponte ausente viram `undefined`: as outras partes seguem. */
async function read<T>(call: (() => Promise<AppResult<T>>) | undefined): Promise<T | undefined> {
  if (call === undefined) return undefined;
  try {
    const result = await call();
    return result.ok ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * As conferências do ambiente, lidas do processo principal. `reload` relê tudo (a pessoa pode ter acabado de
 * instalar o Git). Sem a ponte do app, tudo fica em "Conferindo".
 */
function useEnvironment(): { environment: Environment; busy: boolean; reload: () => void } {
  const [environment, setEnvironment] = useState<Environment>(CHECKING);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  /** Só a resposta da leitura mais nova vale. */
  const round = useRef(0);

  const reload = useCallback(() => {
    const api = window.projectHub;
    if (api === undefined) return;
    const mine = ++round.current;
    setBusy(true);
    void Promise.all([
      read(api.system?.environment),
      read(api.agents?.get),
      read(api.accounts?.list),
      read(api.app?.info),
    ]).then(([system, agents, accounts, app]) => {
      if (!alive.current || mine !== round.current) return;
      const claude = agents?.programs.find((program) => program.provider === 'claude');
      const group = accounts?.groups.find((entry) => entry.provider === 'claude');
      const account: CheckState =
        group === undefined
          ? 'unread'
          : group.accounts.some(usable)
            ? 'ok'
            : group.accounts.some((entry) => entry.kind !== 'api' && entry.state === 'unknown')
              ? 'unread'
              : 'missing';
      setEnvironment({
        git: system === undefined ? 'unread' : system.git.installed ? 'ok' : 'missing',
        ...(system?.git.version === undefined ? {} : { gitVersion: system.git.version }),
        claude: claude === undefined ? 'unread' : claude.installed ? 'ok' : 'missing',
        account,
        ...(app === undefined ? {} : { dataDir: app.dataDir }),
        ...(system === undefined ? {} : { worktreesRoot: system.worktreesRoot }),
      });
      setBusy(false);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { environment, busy, reload };
}

/** Uma conferência: o nome, o estado em ícone e palavra, e o que vier embaixo (a versão, a dica, uma ação). */
function Check({
  name,
  state,
  label,
  action,
  children,
}: {
  name: string;
  state: CheckState;
  /** A palavra do estado. */
  label: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const StateIcon = STATE_ICON[state];
  return (
    <li className="welcome__check">
      <div className="welcome__check-main">
        <span className="welcome__check-name">{name}</span>
        <span className={`welcome__state welcome__state--${state}`}>
          <StateIcon {...ICON_PROPS} />
          {label}
        </span>
        {action === undefined ? null : <span className="welcome__check-action">{action}</span>}
      </div>
      {children}
    </li>
  );
}

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; version: string }
  | { status: 'failed'; message: string };

/** O teste do Claude Code: roda o programa só para pedir a versão, como na seção Agentes. */
function useClaudeTest(): { test: TestState; run: () => void } {
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function run() {
    setTest({ status: 'running' });
    void (async () => {
      let next: TestState;
      try {
        const result = await window.projectHub.agents.testProgram({ provider: 'claude' });
        next = result.ok
          ? { status: 'ok', version: result.data.version }
          : { status: 'failed', message: result.error.message };
      } catch {
        next = { status: 'failed', message: TEXT.testFailed };
      }
      if (alive.current) setTest(next);
    })();
  }

  return { test, run };
}

const INSTALL_LABEL: Record<CheckState, string> = {
  checking: TEXT.checking,
  ok: TEXT.installed,
  missing: TEXT.missing,
  unread: TEXT.unread,
};

const ACCOUNT_LABEL: Record<CheckState, string> = {
  checking: TEXT.checking,
  ok: TEXT.connected,
  missing: TEXT.signedOut,
  unread: TEXT.unread,
};

/**
 * Boas-vindas, no Início sem nenhum projeto: explica o fluxo, confere o Git, o Claude Code e a conta dele, diz onde
 * os dados ficam e oferece o primeiro projeto. Nenhuma conferência impede adicionar o projeto. O botão pede o
 * cadastro pelo mesmo evento da barra lateral, com `irParaMissoes`.
 */
export function Welcome() {
  const titleId = useId();
  const checksId = useId();
  const dataId = useId();
  const { environment, busy, reload } = useEnvironment();
  const { test, run } = useClaudeTest();
  const states = [environment.git, environment.claude, environment.account];
  const settled = !states.includes('checking');
  const ready = states.every((state) => state === 'ok');

  function requestAdd() {
    const detail: AddProjectRequest = { irParaMissoes: true };
    window.dispatchEvent(new CustomEvent(ADD_PROJECT_REQUEST_EVENT, { detail }));
  }

  return (
    <section aria-labelledby={titleId} className="welcome">
      <header className="welcome__head">
        <h2 id={titleId} className="welcome__title">
          {TEXT.title}
        </h2>
        <p className="welcome__lead">{TEXT.lead}</p>
      </header>

      <section aria-labelledby={checksId} className="welcome__part">
        <div className="welcome__part-head">
          <h3 id={checksId} className="welcome__part-title">
            {TEXT.checks}
          </h3>
          <button
            type="button"
            className="btn-ghost welcome__recheck"
            disabled={busy}
            onClick={reload}
          >
            <RefreshCw {...ICON_PROPS} />
            {TEXT.recheck}
          </button>
        </div>
        <ul className="welcome__checks">
          <Check name={TEXT.git} state={environment.git} label={INSTALL_LABEL[environment.git]}>
            {environment.gitVersion === undefined ? null : (
              <p className="welcome__detail welcome__detail--data">{environment.gitVersion}</p>
            )}
            {environment.git === 'missing' ? (
              <p className="welcome__detail">{TEXT.gitHint}</p>
            ) : null}
          </Check>
          <Check
            name={TEXT.claude}
            state={environment.claude}
            label={INSTALL_LABEL[environment.claude]}
            action={
              environment.claude === 'ok' ? (
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={TEXT.testClaude}
                  disabled={test.status === 'running'}
                  onClick={run}
                >
                  {TEXT.test}
                </button>
              ) : undefined
            }
          >
            {environment.claude === 'missing' ? (
              <p className="welcome__detail">{TEXT.claudeHint}</p>
            ) : null}
            {test.status === 'running' ? (
              <p className="welcome__detail welcome__state welcome__state--checking">
                <LoaderCircle {...ICON_PROPS} />
                {TEXT.testing}
              </p>
            ) : null}
            {test.status === 'ok' ? (
              <p role="status" className="welcome__detail welcome__state welcome__state--ok">
                <CircleCheck {...ICON_PROPS} />
                <span className="welcome__detail--data">{TEXT.answered(test.version)}</span>
              </p>
            ) : null}
            {test.status === 'failed' ? (
              <p role="alert" className="welcome__detail welcome__state welcome__state--unread">
                <CircleAlert {...ICON_PROPS} />
                {test.message}
              </p>
            ) : null}
          </Check>
          <Check
            name={TEXT.account}
            state={environment.account}
            label={ACCOUNT_LABEL[environment.account]}
            action={
              environment.account === 'missing' || environment.account === 'unread' ? (
                <Link to={settingsPath('contas')} className="welcome__link">
                  {TEXT.openAccounts}
                </Link>
              ) : undefined
            }
          >
            {environment.account === 'missing' ? (
              <p className="welcome__detail">{TEXT.accountHint}</p>
            ) : null}
          </Check>
        </ul>
      </section>

      <section aria-labelledby={dataId} className="welcome__part">
        <h3 id={dataId} className="welcome__part-title">
          {TEXT.data}
        </h3>
        <ul className="welcome__notes">
          <li>
            {TEXT.dataDir}{' '}
            {environment.dataDir === undefined ? null : (
              <span className="welcome__path">{environment.dataDir}</span>
            )}
          </li>
          <li>
            {TEXT.worktrees}{' '}
            {environment.worktreesRoot === undefined ? null : (
              <span className="welcome__path">{environment.worktreesRoot}</span>
            )}
          </li>
          <li>{TEXT.logins}</li>
          <li>{TEXT.approvals}</li>
        </ul>
      </section>

      <footer className="welcome__foot">
        <p className="welcome__summary" aria-live="polite">
          {settled ? (ready ? TEXT.ready : TEXT.partial) : null}
        </p>
        <button type="button" className="btn-primary welcome__add" onClick={requestAdd}>
          <FolderPlus {...ICON_PROPS} />
          {TEXT.addProject}
        </button>
      </footer>
    </section>
  );
}
