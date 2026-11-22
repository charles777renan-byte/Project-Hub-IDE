import { useRef, useState } from 'react';
import type { AccountDto, AccountLimitsDto, AppResult } from '@project-hub/contracts';
import { loginInProgress, type LoginControls } from '../../use-login';
import { ApiBadge } from '../ApiBadge';
import { ConfirmInline } from '../ConfirmButton';
import {
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  CircleSlash,
  Ellipsis,
  ICON_PROPS,
  LoaderCircle,
  Lock,
} from '../Icon';
import { MenuAcoes, type AcaoMenu } from '../MenuAcoes';
import { AccountNameForm } from './AddAccountForm';
import { AccountUsage } from './AccountUsage';
import { ApiKeyActions } from './ApiKeyActions';
import { LoginGuide } from './LoginGuide';

const TEXT = {
  defaultTag: 'Padrão',
  noLogin: 'Ainda sem login',
  noIdentity: 'O programa não informa qual é a conta',
  unreadable: 'O programa não respondeu',
  connect: 'Conectar',
  otherLogin: 'Termine ou cancele o login em andamento',
  menu: (name: string) => `Mais ações da conta ${name}`,
  rename: 'Renomear',
  save: 'Salvar',
  makeDefault: 'Definir como padrão',
  connectFirst: 'Conecte a conta antes',
  disconnect: 'Desconectar',
  remove: 'Remover conta',
  removeQuestion:
    'Remover a conta apaga, neste computador, o login, o histórico e os ajustes dela no programa. O acesso no serviço não é cancelado.',
  forceQuestion: 'Não foi possível sair da conta pelo programa. Remover mesmo assim?',
  forceConfirm: 'Remover mesmo assim',
  principalQuestion: 'Sair da conta Principal também desconecta o programa fora do Project Hub.',
  billing: 'Cobrança por uso',
  keyEnd: (last4: string) => `Cobrança por uso · chave terminada em …${last4}`,
  storeKeyFirst: 'Guarde a chave antes',
  defaultApiQuestion:
    'Esta conta cobra por uso, sem o teto de uma assinatura. Missões longas podem custar caro.',
  removeApiQuestion:
    'Remover a conta apaga, neste computador, a chave guardada, o histórico e os ajustes dela no programa. A chave continua valendo no serviço até ser revogada no site.',
  failed: 'Não foi possível concluir a ação.',
} as const;

const STATE = {
  connected: { label: 'Conectada', icon: CircleCheck },
  'signed-out': { label: 'Sem login', icon: CircleSlash },
  unknown: { label: 'Não foi possível ler', icon: CircleQuestionMark },
} as const;

/** O estado da conta API é o da chave: só "Chave guardada" pode ser usada ou virar padrão. */
const KEY_STATE = {
  stored: { label: 'Chave guardada', icon: CircleCheck },
  missing: { label: 'Sem chave', icon: CircleSlash },
  unreadable: { label: 'Chave ilegível', icon: CircleAlert },
  locked: { label: 'Cofre trancado', icon: Lock },
} as const;

type Mode = 'idle' | 'rename' | 'remove' | 'force' | 'disconnect' | 'default';

function identityLine(account: AccountDto): { text: string; data: boolean } {
  if (account.kind === 'api') {
    return {
      text: account.keyLast4 === undefined ? TEXT.billing : TEXT.keyEnd(account.keyLast4),
      data: false,
    };
  }
  if (account.identity !== undefined) return { text: account.identity, data: true };
  if (account.state === 'signed-out') return { text: TEXT.noLogin, data: false };
  return { text: account.state === 'connected' ? TEXT.noIdentity : TEXT.unreadable, data: false };
}

/**
 * Uma conta de um programa: o nome, quem está conectado (lido do programa, nunca gravado), o estado e as ações.
 * A tela manda só o programa e o id da conta; a pasta e os comandos são do processo principal. O login guiado
 * abre dentro da própria linha. Remover e sair da Principal pedem confirmação antes; a Principal não é renomeada
 * nem removida.
 */
export function AccountRow({
  account,
  program,
  controls,
  onChanged,
  usage,
  onRefreshUsage,
}: {
  account: AccountDto;
  /** Nome do programa ("Claude Code"). */
  program: string;
  controls: LoginControls;
  /** Algo mudou nas contas: a lista é relida. */
  onChanged: () => void;
  /** O uso da conta, quando o app tem como lê-lo. Conta sem login não mostra uso. */
  usage?: AccountLimitsDto | undefined;
  /** A pessoa pediu uma leitura nova do uso desta conta. */
  onRefreshUsage?: (() => void) | undefined;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** O item do menu abriu um campo ou uma pergunta nesta linha: o foco fica nele, e não volta ao botão do menu. */
  const keepFocus = useRef(false);

  const { login } = controls;
  const target = { provider: account.provider, accountId: account.id };
  const mine =
    login !== null && login.provider === account.provider && login.accountId === account.id;
  const connecting = mine && loginInProgress(login);
  const isApi = account.kind === 'api';
  const keyState = account.keyState ?? 'missing';
  const identity = identityLine(account);
  const state = isApi ? KEY_STATE[keyState] : STATE[account.state];
  const stateClass = isApi ? `key-${keyState}` : account.state;
  const StateIcon = state.icon;

  async function run(action: () => Promise<AppResult<unknown>>): Promise<AppResult<unknown>> {
    setBusy(true);
    setError(null);
    let result: AppResult<unknown>;
    try {
      result = await action();
    } catch {
      result = { ok: false, error: { code: 'UNKNOWN', message: TEXT.failed, retryable: false } };
    }
    setBusy(false);
    return result;
  }

  /** Ação simples: deu certo, relê a lista; falhou, a linha diz o que houve. */
  async function act(action: () => Promise<AppResult<unknown>>) {
    const result = await run(action);
    setMode('idle');
    if (result.ok) onChanged();
    else setError(result.error.message);
  }

  async function remove(force: boolean) {
    const id = account.id;
    if (id === null) return;
    const result = await run(() => window.projectHub.accounts.remove({ accountId: id, force }));
    if (result.ok) {
      setMode('idle');
      onChanged();
    } else if (!force && result.error.code === 'PROCESS_START_FAILED') {
      setMode('force');
    } else {
      setMode('idle');
      setError(result.error.message);
    }
  }

  async function connect() {
    setError(null);
    const failure = await controls.start(target);
    if (failure !== null) setError(failure);
  }

  function open(next: Mode) {
    keepFocus.current = true;
    setError(null);
    setMode(next);
  }

  const actions: AcaoMenu[] = [];
  if (!account.isPrincipal)
    actions.push({ rotulo: TEXT.rename, onSelecionar: () => open('rename') });
  if (!account.isDefault && isApi) {
    const stored = keyState === 'stored';
    actions.push({
      rotulo: TEXT.makeDefault,
      desabilitada: !stored,
      ...(stored ? {} : { dica: TEXT.storeKeyFirst }),
      onSelecionar: () => open('default'),
    });
  } else if (!account.isDefault) {
    const connected = account.state === 'connected';
    actions.push({
      rotulo: TEXT.makeDefault,
      desabilitada: !connected,
      ...(connected ? {} : { dica: TEXT.connectFirst }),
      onSelecionar: () => void act(() => window.projectHub.accounts.setDefault(target)),
    });
  }
  if (!isApi && account.state !== 'signed-out') {
    actions.push({
      rotulo: TEXT.disconnect,
      onSelecionar: account.isPrincipal
        ? () => open('disconnect')
        : () => void act(() => window.projectHub.accounts.disconnect(target)),
    });
  }
  if (!account.isPrincipal) {
    actions.push({ rotulo: TEXT.remove, perigosa: true, onSelecionar: () => open('remove') });
  }

  return (
    <li className="acct">
      <div className="acct__main">
        <div className="acct__id">
          <p className="acct__name">
            <span className="acct__name-text">{account.name}</span>
            {isApi ? <ApiBadge /> : null}
            {account.isDefault ? <span className="acct__tag">{TEXT.defaultTag}</span> : null}
          </p>
          <p className="acct__identity">
            <span className={identity.data ? 'acct__identity--data' : undefined}>
              {identity.text}
            </span>
            {identity.data && account.organization !== undefined ? (
              <span>{` · ${account.organization}`}</span>
            ) : null}
          </p>
        </div>
        {connecting ? (
          <span className="acct__state acct__state--busy">
            <LoaderCircle {...ICON_PROPS} />
            Conectando
          </span>
        ) : (
          <span className={`acct__state acct__state--${stateClass}`}>
            <StateIcon {...ICON_PROPS} />
            {state.label}
          </span>
        )}
        {mine ? null : (
          <div className="acct__actions">
            {!isApi && account.state === 'signed-out' ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy || loginInProgress(login)}
                title={loginInProgress(login) ? TEXT.otherLogin : undefined}
                onClick={() => void connect()}
              >
                {TEXT.connect}
              </button>
            ) : null}
            {actions.length === 0 ? null : (
              <MenuAcoes
                rotulo={TEXT.menu(account.name)}
                icone={<Ellipsis {...ICON_PROPS} size={16} />}
                acoes={actions}
                aoFecharDevolverFoco={(event) => {
                  if (!keepFocus.current) return;
                  keepFocus.current = false;
                  event.preventDefault();
                }}
              />
            )}
          </div>
        )}
      </div>
      {isApi ? <ApiKeyActions account={account} program={program} onChanged={onChanged} /> : null}
      {!isApi &&
      usage !== undefined &&
      onRefreshUsage !== undefined &&
      account.state !== 'signed-out' ? (
        <AccountUsage name={account.name} usage={usage} onRefresh={onRefreshUsage} />
      ) : null}
      {mode === 'rename' && account.id !== null ? (
        <AccountNameForm
          initial={account.name}
          submitLabel={TEXT.save}
          onCancel={() => setMode('idle')}
          onSubmit={async (name) => {
            const id = account.id;
            if (id === null) return null;
            const result = await run(() =>
              window.projectHub.accounts.rename({ accountId: id, name }),
            );
            if (!result.ok) return result.error.message;
            setMode('idle');
            onChanged();
            return null;
          }}
        />
      ) : null}
      {mode === 'remove' ? (
        <ConfirmInline
          question={isApi ? TEXT.removeApiQuestion : TEXT.removeQuestion}
          confirmLabel={TEXT.remove}
          disabled={busy}
          focusBack
          onConfirm={() => void remove(false)}
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {mode === 'force' ? (
        <ConfirmInline
          question={TEXT.forceQuestion}
          confirmLabel={TEXT.forceConfirm}
          disabled={busy}
          focusBack
          onConfirm={() => void remove(true)}
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {mode === 'default' ? (
        <ConfirmInline
          question={TEXT.defaultApiQuestion}
          confirmLabel={TEXT.makeDefault}
          confirmTone="primary"
          disabled={busy}
          focusBack
          onConfirm={() => void act(() => window.projectHub.accounts.setDefault(target))}
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {mode === 'disconnect' ? (
        <ConfirmInline
          question={TEXT.principalQuestion}
          confirmLabel={TEXT.disconnect}
          disabled={busy}
          focusBack
          onConfirm={() => void act(() => window.projectHub.accounts.disconnect(target))}
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {error === null ? null : (
        <p role="alert" className="acct__error settings__error">
          {error}
        </p>
      )}
      {mine ? (
        <LoginGuide
          controls={controls}
          program={program}
          account={account.name}
          onRetry={() => void connect()}
        />
      ) : null}
    </li>
  );
}
