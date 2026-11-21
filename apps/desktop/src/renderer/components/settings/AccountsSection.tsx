import { useId, useState } from 'react';
import type {
  AccountGroupDto,
  AccountProviderId,
  OtherProgramDto,
} from '@project-hub/contracts';
import { useAccounts } from '../../use-accounts';
import { useLogin, type LoginControls } from '../../use-login';
import { CircleCheck, CircleSlash, ICON_PROPS, Plus } from '../Icon';
import { ProviderIcon } from '../ProviderIcon';
import { AccountRow } from './AccountRow';
import { AccountNameForm } from './AddAccountForm';

const TEXT = {
  title: 'Contas',
  lead: 'O login é feito no próprio programa de cada conta e fica guardado por ele. O Project Hub não vê nem guarda senha ou token.',
  loading: 'Lendo as contas…',
  failed: 'Não foi possível ler as contas.',
  retry: 'Tentar de novo',
  count: (total: number) => (total === 1 ? '1 conta' : `${total} contas`),
  add: 'Adicionar conta',
  addSubmit: 'Adicionar',
  addFailed: 'Não foi possível criar a conta.',
  installed: 'Instalado',
  notInstalled: 'Não instalado',
  others: 'Outros programas',
  othersNote: 'Estes programas usam uma conta só, a do próprio programa neste computador.',
} as const;

const PROGRAMS: Record<AccountProviderId, string> = { claude: 'Claude Code', codex: 'Codex' };

/** As contas de um programa: a Principal (a do programa na máquina) e as extras, com o botão de criar outra. */
function AccountGroup({
  group,
  controls,
  onChanged,
}: {
  group: AccountGroupDto;
  controls: LoginControls;
  onChanged: () => void;
}) {
  const titleId = useId();
  const [adding, setAdding] = useState(false);
  const program = PROGRAMS[group.provider];

  async function add(name: string): Promise<string | null> {
    try {
      const result = await window.projectHub.accounts.add({ provider: group.provider, name });
      if (!result.ok) return result.error.message;
    } catch {
      return TEXT.addFailed;
    }
    setAdding(false);
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
        {group.installed ? (
          <button
            type="button"
            className="btn-secondary acct-group__action"
            disabled={adding}
            onClick={() => setAdding(true)}
          >
            <Plus {...ICON_PROPS} />
            {TEXT.add}
          </button>
        ) : (
          <span className="acct__state acct-group__action">
            <CircleSlash {...ICON_PROPS} />
            {TEXT.notInstalled}
          </span>
        )}
      </header>
      {adding ? (
        <AccountNameForm
          submitLabel={TEXT.addSubmit}
          onSubmit={add}
          onCancel={() => setAdding(false)}
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
          />
        ))}
      </ul>
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
              className={
                other.installed ? 'acct__state acct__state--connected' : 'acct__state'
              }
            >
              {other.installed ? (
                <CircleCheck {...ICON_PROPS} />
              ) : (
                <CircleSlash {...ICON_PROPS} />
              )}
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
 * acontece dentro da linha da conta.
 */
export function AccountsSection() {
  const titleId = useId();
  const { state, reload } = useAccounts();
  const controls = useLogin(reload);

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
          {state.data.groups.map((group) => (
            <AccountGroup
              key={group.provider}
              group={group}
              controls={controls}
              onChanged={reload}
            />
          ))}
          <OtherPrograms others={state.data.others} />
        </>
      ) : null}
    </section>
  );
}
