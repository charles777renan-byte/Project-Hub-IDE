import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { AccountDto } from '@project-hub/contracts';
import { ApiBadge } from './ApiBadge';
import { clockOf } from '../limit-time';
import { CircleAlert, CircleSlash, Clock, ICON_PROPS, Lock, type LucideIcon } from './Icon';

/**
 * O que a lista precisa saber de cada conta: o id (`null` é a Principal), o nome, se é a padrão e o estado. Na conta
 * por chave de API, o tipo e o estado da chave dizem se ela pode ser escolhida.
 */
export type AccountChoiceItem = Pick<AccountDto, 'id' | 'name' | 'isDefault' | 'state'> &
  Partial<Pick<AccountDto, 'kind' | 'keyState' | 'exhaustedUntil'>>;

const TEXT = {
  defaultTag: 'Padrão',
  noLogin: 'Sem login',
  noKey: 'Sem chave',
  badKey: 'Chave ilegível',
  locked: 'Cofre trancado',
  exhausted: (time: string) => `Sem limite até ${time}`,
} as const;

/** O estado que aparece ao lado da conta, quando há algo a dizer. */
function stateOf(account: AccountChoiceItem): { label: string; icon: LucideIcon } | undefined {
  if (account.kind === 'api') {
    if (account.keyState === 'missing' || account.keyState === undefined) {
      return { label: TEXT.noKey, icon: CircleSlash };
    }
    if (account.keyState === 'unreadable') return { label: TEXT.badKey, icon: CircleAlert };
    if (account.keyState === 'locked') return { label: TEXT.locked, icon: Lock };
  } else if (account.state === 'signed-out') {
    return { label: TEXT.noLogin, icon: CircleSlash };
  }
  // O limite vem depois da chave e do login: a conta continua escolhível, só avisa até quando.
  return account.exhaustedUntil === undefined
    ? undefined
    : { label: TEXT.exhausted(clockOf(account.exhaustedUntil, new Date())), icon: Clock };
}

/**
 * A conta pode ser escolhida. A conta API sem chave, ou com uma que não abre, não pode: nada abriria nela. Com o
 * cofre trancado, pode: a senha é pedida na abertura.
 */
export function isUsable(account: AccountChoiceItem): boolean {
  if (account.kind !== 'api') return true;
  return account.keyState === 'stored' || account.keyState === 'locked';
}

/**
 * Lista de escolha única das contas de um programa. A conta marcada é a única na ordem do Tab; as setas andam
 * entre as contas (dando a volta), Home e End vão às pontas, Enter ou espaço escolhem, e Esc avisa quem abriu a
 * lista (`onCancel`). A marcada se distingue pela forma (o ponto cheio), e não só pela cor. Conta "Sem login"
 * continua escolhível: o próprio programa pede o login no painel. A conta por chave de API leva o selo "API"; sem
 * chave, ou com uma que não abre, ela aparece desativada, com o estado. Só o id sai daqui.
 */
export function AccountChoice({
  accounts,
  value,
  onChange,
  label,
  onCancel,
  autoFocus = false,
  disabled = false,
  detailOf,
}: {
  accounts: readonly AccountChoiceItem[];
  /** O id da conta marcada; `null` é a Principal. */
  value: string | null;
  onChange(accountId: string | null): void;
  /** O nome acessível da lista, ex.: "Conta do Claude Code". */
  label: string;
  /** Esc dentro da lista. Com ele, o Esc não segue para quem está em volta. */
  onCancel?(): void;
  /** Leva o foco à conta marcada ao aparecer. */
  autoFocus?: boolean;
  disabled?: boolean;
  /** Um detalhe ao lado de cada conta, ex.: o uso dela. */
  detailOf?(account: AccountChoiceItem): ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const options = () =>
    Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
  // Sem conta com o id marcado (a conta saiu da lista), a primeira é a que entra na ordem do Tab.
  const tabStop = accounts.some((account) => account.id === value) ? value : accounts[0]?.id;

  useEffect(() => {
    if (!autoFocus) return;
    const all = options();
    (all.find((option) => option.tabIndex === 0) ?? all[0])?.focus();
  }, [autoFocus]);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'Escape') {
      if (onCancel === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    const all = options();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => {
      event.preventDefault();
      all[(index + all.length) % all.length]?.focus();
    };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at < 0 ? all.length - 1 : at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(all.length - 1);
    else if ((event.key === 'Enter' || event.key === ' ') && at >= 0) {
      event.preventDefault();
      const account = accounts[at];
      if (account !== undefined && !disabled && isUsable(account)) onChange(account.id);
    }
  }

  return (
    <ul
      ref={list}
      role="listbox"
      aria-label={label}
      aria-disabled={disabled ? true : undefined}
      className="account-choice"
      onKeyDown={onKeyDown}
    >
      {accounts.map((account) => {
        const detail = detailOf?.(account);
        const usable = isUsable(account);
        const state = stateOf(account);
        const StateIcon = state?.icon;
        return (
          <li
            key={account.id ?? 'principal'}
            role="option"
            aria-selected={account.id === value}
            aria-disabled={usable ? undefined : true}
            tabIndex={account.id === tabStop ? 0 : -1}
            className="account-choice__option"
            onClick={() => {
              if (!disabled && usable) onChange(account.id);
            }}
          >
            <span className="account-choice__mark" aria-hidden="true" />
            <span className="account-choice__name">{account.name}</span>
            {account.kind === 'api' ? <ApiBadge /> : null}
            {account.isDefault ? (
              <span className="account-choice__tag">{TEXT.defaultTag}</span>
            ) : null}
            {state === undefined || StateIcon === undefined ? null : (
              <span className="account-choice__state">
                <StateIcon {...ICON_PROPS} />
                {state.label}
              </span>
            )}
            {detail === undefined || detail === null ? null : (
              <span className="account-choice__detail">{detail}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
