import { useEffect, useId, useRef, useState } from 'react';
import type {
  AccountDto,
  AccountGroupDto,
  AccountKind,
  AccountLimitsDto,
  AccountProviderId,
  LimitsDto,
  OtherProgramDto,
  VaultDto,
} from '@project-hub/contracts';
import { useAccounts } from '../../use-accounts';
import { useLimits } from '../../use-limits';
import { useLogin, type LoginControls } from '../../use-login';
import { useVault } from '../../use-vault';
import { CircleCheck, CircleSlash, ICON_PROPS, Plus } from '../Icon';
import { ProviderIcon } from '../ProviderIcon';
import { AccountRow } from './AccountRow';
import { AddAccountForm } from './AddAccountForm';
import { AutoSwitchToggles } from './AutoSwitchToggles';
import { VaultBar } from './VaultBar';

const TEXT = {
  title: 'Contas',
  lead: 'Cada programa pode ter várias contas. Na de assinatura, o login fica no próprio programa e o Project Hub não vê a senha nem o token. Na de chave de API, a chave fica cifrada no cofre do app, neste computador.',
  loading: 'Lendo as contas…',
  failed: 'Não foi possível ler as contas.',
  retry: 'Tentar de novo',
  count: (total: number) => (total === 1 ? '1 conta' : `${total} contas`),
  add: 'Adicionar conta',
  addSubmit: 'Adicionar conta',
  addFailed: 'Não foi possível criar a conta.',
  installed: 'Instalado',
  notInstalled: 'Não instalado',
  others: 'Outros programas',
  othersNote: 'Estes programas usam uma conta só, a do próprio programa neste computador.',
} as const;

const PROGRAMS: Record<AccountProviderId, string> = { claude: 'Claude Code', codex: 'Codex' };

/** Os programas em que a conta pode ser por chave de API. O Codex fica de fora até aceitar a chave pelo ambiente. */
const API_PROGRAMS: ReadonlySet<AccountProviderId> = new Set(['claude']);

/** A entrada dos limites de uma conta. Sem ela, o app não tem como ler o uso daquele programa. */
function usageOf(limits: LimitsDto | null, account: AccountDto): AccountLimitsDto | undefined {
  return limits?.accounts.find(
    (entry) => entry.provider === account.provider && entry.accountId === account.id,
  );
}

/** A conta ainda não tem leitura nenhuma: nem janela, nem problema, nem leitura em curso. */
function isUnread(entry: AccountLimitsDto): boolean {
  return (
    entry.capturedAt === undefined &&
    entry.windows.length === 0 &&
    entry.problem === undefined &&
    !entry.refreshing
  );
}

/** As contas de um programa: a Principal (a do programa na máquina) e as extras, com o botão de criar outra. */
function AccountGroup({
  group,
  controls,
  onChanged,
  limits,
  onRefreshUsage,
  vault,
}: {
  group: AccountGroupDto;
  controls: LoginControls;
  onChanged: () => void;
  limits: LimitsDto | null;
  onRefreshUsage: (account: AccountDto) => void;
  vault: VaultDto | null;
}) {
  const titleId = useId();
  const [adding, setAdding] = useState(false);
  const program = PROGRAMS[group.provider];
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Ao fechar o painel de criar, o foco volta ao botão que o abriu (ele some enquanto o painel está aberto).
  useEffect(() => {
    if (adding || !returnFocus.current) return;
    returnFocus.current = false;
    addButton.current?.focus();
  }, [adding]);

  function close() {
    returnFocus.current = true;
    setAdding(false);
  }

  async function add(name: string, kind: AccountKind): Promise<string | null> {
    try {
      const result = await window.projectHub.accounts.add({ provider: group.provider, name, kind });
      if (!result.ok) return result.error.message;
    } catch {
      return TEXT.addFailed;
    }
    close();
    onChanged();
    return null;
  }

  return (
    <section aria-labelledby={titleId} className="acct-group">
      <header className="acct-group__head">
        <h3 id={titleId} className="acct-group__title">
          <ProviderIcon provider={group.provider} size={16} />
          {program}
        </h3>
        <span className="acct-group__count">{TEXT.count(group.accounts.length)}</span>
        {!group.installed ? (
          <span className="acct__state acct-group__action">
            <CircleSlash {...ICON_PROPS} />
            {TEXT.notInstalled}
          </span>
        ) : adding ? null : (
          <button
            ref={addButton}
            type="button"
            className="btn-secondary acct-group__action"
            onClick={() => setAdding(true)}
          >
            <Plus {...ICON_PROPS} />
            {TEXT.add}
          </button>
        )}
      </header>
      {adding ? (
        <AddAccountForm
          program={program}
          allowApi={API_PROGRAMS.has(group.provider)}
          vault={vault}
          submitLabel={TEXT.addSubmit}
          onSubmit={add}
          onCancel={close}
        />
      ) : null}
      <ul className="acct-list">
        {group.accounts.map((account) => (
          <AccountRow
            key={account.id ?? 'principal'}
            account={account}
            program={program}
            controls={controls}
            onChanged={onChanged}
            usage={usageOf(limits, account)}
            onRefreshUsage={() => onRefreshUsage(account)}
          />
        ))}
      </ul>
      {group.installed ? <AutoSwitchToggles group={group} onChanged={onChanged} /> : null}
    </section>
  );
}

/** Os programas de uma conta só: a tela diz apenas se cada um está instalado. */
function OtherPrograms({ others }: { others: OtherProgramDto[] }) {
  const titleId = useId();
  if (others.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="acct-group">
      <header className="acct-group__head">
        <h3 id={titleId} className="acct-group__title">
          {TEXT.others}
        </h3>
      </header>
      <p className="settings__lead">{TEXT.othersNote}</p>
      <ul className="acct-list">
        {others.map((other) => (
          <li key={other.provider} className="acct acct--other">
            <ProviderIcon provider={other.provider} size={16} />
            <span className="acct__other-name">{other.label}</span>
            <span
              className={other.installed ? 'acct__state acct__state--connected' : 'acct__state'}
            >
              {other.installed ? <CircleCheck {...ICON_PROPS} /> : <CircleSlash {...ICON_PROPS} />}
              {other.installed ? TEXT.installed : TEXT.notInstalled}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Seção Contas das Configurações: as contas de cada programa que aceita mais de uma (Claude Code e Codex), com o
 * estado lido do próprio programa, e os outros programas, que usam uma conta só. Há um login por vez no app; ele
 * acontece dentro da linha da conta. Cada conta conectada mostra o uso dela; ao abrir a seção, as que ainda não
 * têm leitura são lidas, uma por vez, e o pedido não se repete enquanto a seção fica aberta.
 */
export function AccountsSection() {
  const titleId = useId();
  const { state, reload } = useAccounts();
  const controls = useLogin(reload);
  const { limits, refreshAccount } = useLimits();
  const vault = useVault(reload);
  /** As contas cuja leitura já foi pedida nesta abertura da seção. */
  const asked = useRef(new Set<string>());
  const reading = useRef(false);

  useEffect(() => {
    if (state.status !== 'ready' || limits === null || reading.current) return;
    const pending = state.data.groups
      .flatMap((group) => (group.installed ? group.accounts : []))
      .filter((account) => {
        if (account.kind === 'api' || account.state !== 'connected') return false;
        const entry = usageOf(limits, account);
        const key = `${account.provider}:${account.id ?? ''}`;
        return entry !== undefined && isUnread(entry) && !asked.current.has(key);
      });
    if (pending.length === 0) return;
    reading.current = true;
    void (async () => {
      try {
        for (const account of pending) {
          asked.current.add(`${account.provider}:${account.id ?? ''}`);
          await refreshAccount(account.provider, account.id);
        }
      } finally {
        reading.current = false;
      }
    })();
  }, [state, limits, refreshAccount]);

  const apiAccounts =
    state.status === 'ready'
      ? state.data.groups.flatMap((group) =>
          group.accounts.filter((account) => account.kind === 'api'),
        )
      : [];

  return (
    <section aria-labelledby={titleId} className="settings__panel">
      <header className="settings__head">
        <h2 id={titleId} className="settings__section-title">
          {TEXT.title}
        </h2>
        <p className="settings__lead">{TEXT.lead}</p>
      </header>
      {state.status === 'loading' ? <p className="settings__lead">{TEXT.loading}</p> : null}
      {state.status === 'failed' ? (
        <div className="login__row">
          <p role="alert" className="settings__error">
            {TEXT.failed}
          </p>
          <button type="button" className="btn-secondary" onClick={reload}>
            {TEXT.retry}
          </button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {vault !== null && apiAccounts.length > 0 ? (
            <VaultBar vault={vault} accounts={apiAccounts} onChanged={reload} />
          ) : null}
          {state.data.groups.map((group) => (
            <AccountGroup
              key={group.provider}
              group={group}
              controls={controls}
              onChanged={reload}
              limits={limits}
              onRefreshUsage={(account) => void refreshAccount(account.provider, account.id)}
              vault={vault}
            />
          ))}
          <OtherPrograms others={state.data.others} />
        </>
      ) : null}
    </section>
  );
}
