import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountDto,
  AccountLimitsDto,
  AppResult,
  ProjectHubApi,
} from '@project-hub/contracts';
import { AccountRow } from '../../src/renderer/components/settings/AccountRow';
import type { LoginControls } from '../../src/renderer/use-login';

// A linha de uma conta do tipo API: selo, cobrança por uso, o final da chave e o estado da chave. Ela não tem login,
// então não oferece Conectar nem Desconectar, e não mostra o uso da assinatura.

const A = '11111111-1111-4111-8111-111111111111';
const BILLING =
  'Esta conta cobra por uso, sem o teto de uma assinatura. Missões longas podem custar caro.';

const ok = <T,>(data: T): Promise<AppResult<T>> => Promise.resolve({ ok: true, data });

function apiAccount(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: A,
    provider: 'claude',
    name: 'Chave',
    isPrincipal: false,
    isDefault: false,
    kind: 'api',
    state: 'connected',
    keyState: 'stored',
    keyLast4: 'ab12',
    ...overrides,
  };
}

const controls: LoginControls = {
  login: null,
  output: { snapshot: () => '', subscribe: () => () => undefined },
  start: vi.fn(() => Promise.resolve(null)),
  cancel: vi.fn(() => Promise.resolve(null)),
  confirm: vi.fn(() => Promise.resolve(null)),
  reject: vi.fn(() => Promise.resolve(null)),
  openUrl: vi.fn(() => Promise.resolve(null)),
  copyUrl: vi.fn(() => Promise.resolve(null)),
  write: vi.fn(),
  resize: vi.fn(),
};

const USAGE: AccountLimitsDto = {
  provider: 'claude',
  accountId: A,
  accountName: 'Chave',
  windows: [
    { id: 'five_hour', usedPercent: 40, resetsAt: new Date(Date.now() + 60_000).toISOString() },
  ],
  capturedAt: new Date().toISOString(),
  refreshing: false,
};

function setup(account: AccountDto) {
  const accounts = {
    setDefault: vi.fn((_input: unknown) => ok(undefined)),
    remove: vi.fn((_input: unknown) => ok(undefined)),
    disconnect: vi.fn((_input: unknown) => ok(undefined)),
    pasteKey: vi.fn((_input: unknown) => ok({ last4: 'WXYZ' })),
    removeKey: vi.fn((_input: unknown) => ok(undefined)),
  };
  window.projectHub = {
    accounts,
    terminals: { list: vi.fn(() => ok([])) },
  } as unknown as ProjectHubApi;
  const onChanged = vi.fn();
  render(
    <ul>
      <AccountRow
        account={account}
        program="Claude Code"
        controls={controls}
        onChanged={onChanged}
        usage={USAGE}
        onRefreshUsage={() => undefined}
      />
    </ul>,
  );
  return { accounts, onChanged, row: screen.getByRole('listitem') };
}

async function openMenu(row: HTMLElement) {
  await userEvent.click(within(row).getByRole('button', { name: 'Mais ações da conta Chave' }));
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('AccountRow: conta API', () => {
  it('linha de conta API: selo, "Cobrança por uso" e o final da chave; sem Conectar', async () => {
    const { row } = setup(apiAccount({ state: 'signed-out' }));
    expect(within(row).getByText('API')).toBeInTheDocument();
    expect(
      within(row).getByText('Cobrança por uso · chave terminada em …ab12'),
    ).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Conectar' })).toBeNull();
    expect(within(row).queryByRole('button', { name: /Atualizar uso/ })).toBeNull();
    expect(within(row).queryByRole('group', { name: /uso/i })).toBeNull();

    await openMenu(row);
    expect(screen.queryByRole('menuitem', { name: 'Desconectar' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Renomear' })).toBeInTheDocument();
  });

  it('sem chave ainda, a linha diz só "Cobrança por uso"', () => {
    const { row } = setup(apiAccount({ keyState: 'missing', keyLast4: undefined }));
    expect(within(row).getByText('Cobrança por uso')).toBeInTheDocument();
  });

  it.each([
    ['stored', 'Chave guardada'],
    ['missing', 'Sem chave'],
    ['unreadable', 'Chave ilegível'],
    ['locked', 'Cofre trancado'],
  ] as const)('estado %s aparece com rótulo próprio', (keyState, label) => {
    const { row } = setup(apiAccount({ keyState }));
    const state = within(row).getByText(label);
    expect(state).toHaveClass('acct__state', `acct__state--key-${keyState}`);
    expect(state.querySelector('svg')).not.toBeNull();
  });

  it('definir conta API como padrão pede confirmação com o aviso de cobrança', async () => {
    const { row, accounts, onChanged } = setup(apiAccount());
    await openMenu(row);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Definir como padrão' }));

    const confirm = within(row).getByRole('group', { name: BILLING });
    expect(accounts.setDefault).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Definir como padrão' }));

    await waitFor(() =>
      expect(accounts.setDefault).toHaveBeenCalledWith({ provider: 'claude', accountId: A }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it.each(['missing', 'unreadable', 'locked'] as const)(
    'sem "Chave guardada" (%s), Definir como padrão fica desligado',
    async (keyState) => {
      const { row } = setup(apiAccount({ keyState }));
      await openMenu(row);
      const item = screen.getByRole('menuitem', { name: 'Definir como padrão' });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveAttribute('title', 'Guarde a chave antes');
    },
  );

  it('remover a conta API diz que a chave guardada é apagada e que ela segue valendo no serviço', async () => {
    const { row, accounts } = setup(apiAccount());
    await openMenu(row);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remover conta' }));
    expect(
      within(row).getByText(
        'Remover a conta apaga, neste computador, a chave guardada, o histórico e os ajustes dela no programa. A chave continua valendo no serviço até ser revogada no site.',
      ),
    ).toBeInTheDocument();
    expect(accounts.remove).not.toHaveBeenCalled();
  });
});
