import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDto, AppResult, ProjectHubApi, VaultDto } from '@project-hub/contracts';
import { VaultBar } from '../../src/renderer/components/settings/VaultBar';

// A barra do cofre, no alto da seção Contas quando existe conta API. A senha nunca passa pela tela: Destrancar e
// Trocar senha só pedem ao processo principal, que abre a janela do cofre e devolve o desfecho.

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const ok = <T,>(data: T): Promise<AppResult<T>> => Promise.resolve({ ok: true, data });
const fail = (code: string, message: string): Promise<AppResult<never>> =>
  Promise.resolve({ ok: false, error: { code, message, retryable: false } } as AppResult<never>);

function apiAccount(overrides: Partial<AccountDto>): AccountDto {
  return {
    id: A,
    provider: 'claude',
    name: 'Chave',
    isPrincipal: false,
    isDefault: false,
    kind: 'api',
    state: 'connected',
    keyState: 'locked',
    ...overrides,
  };
}

const ACCOUNTS = [
  apiAccount({ id: A, name: 'Trabalho' }),
  apiAccount({ id: B, name: 'Cliente', keyState: 'unreadable' }),
  apiAccount({ id: C, name: 'Nova', keyState: 'missing' }),
];

function setup(vault: VaultDto, accounts: AccountDto[] = ACCOUNTS) {
  const api = {
    unlock: vi.fn(() => ok({ outcome: 'unlocked' as const })),
    lock: vi.fn(() => ok(undefined)),
    changePassword: vi.fn(() => ok({ outcome: 'changed' as const, lost: [] as string[] })),
    reset: vi.fn((_input: unknown) => ok(undefined)),
  };
  window.projectHub = { vault: api } as unknown as ProjectHubApi;
  const onChanged = vi.fn();
  const view = render(<VaultBar vault={vault} accounts={accounts} onChanged={onChanged} />);
  const bar = () => screen.getByRole('group', { name: 'Cofre das chaves de API' });
  return { api, onChanged, bar, view };
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Mais ações do cofre' }));
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('VaultBar', () => {
  it('a barra do cofre troca entre Destrancar e Trancar cofre conforme o estado', async () => {
    const { api, onChanged, bar, view } = setup({ state: 'locked', available: true });
    expect(within(bar()).getByText('Cofre trancado')).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: 'Trancar cofre' })).toBeNull();

    await userEvent.click(within(bar()).getByRole('button', { name: 'Destrancar' }));
    expect(api.unlock).toHaveBeenCalledWith();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    view.rerender(
      <VaultBar
        vault={{ state: 'unlocked', available: true }}
        accounts={ACCOUNTS}
        onChanged={onChanged}
      />,
    );
    expect(within(bar()).getByText('Cofre destrancado')).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: 'Destrancar' })).toBeNull();
    await userEvent.click(within(bar()).getByRole('button', { name: 'Trancar cofre' }));
    expect(api.lock).toHaveBeenCalledWith();
  });

  it('fechar a janela da senha não muda nada nem mostra erro', async () => {
    const { api, onChanged, bar } = setup({ state: 'locked', available: true });
    api.unlock.mockImplementationOnce(() => ok({ outcome: 'cancelled' as const }) as never);
    await userEvent.click(within(bar()).getByRole('button', { name: 'Destrancar' }));
    await waitFor(() => expect(api.unlock).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a falha do processo principal aparece como veio', async () => {
    const { api, bar } = setup({ state: 'locked', available: true });
    api.unlock.mockImplementationOnce(() => fail('UNKNOWN', 'O cofre não abriu.') as never);
    await userEvent.click(within(bar()).getByRole('button', { name: 'Destrancar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O cofre não abriu.');
  });

  it('Trocar senha só pede ao app e diz quando a senha foi trocada', async () => {
    const { api } = setup({ state: 'unlocked', available: true });
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Trocar senha' }));
    expect(api.changePassword).toHaveBeenCalledWith();
    expect(await screen.findByRole('status')).toHaveTextContent('Senha trocada.');
  });

  it('Trocar senha diz quais contas ficaram sem chave', async () => {
    const { api } = setup({ state: 'unlocked', available: true });
    api.changePassword.mockImplementation(() => ok({ outcome: 'changed' as const, lost: [B] }));
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Trocar senha' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Senha trocada. Ficaram sem chave: Cliente. Cole as chaves de novo.',
    );
  });

  it('redefinir o cofre lista as contas afetadas antes de confirmar', async () => {
    const { api, onChanged, bar } = setup({ state: 'locked', available: true });
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Redefinir cofre' }));

    const confirm = within(bar()).getByRole('group', {
      name: 'Redefinir o cofre apaga a senha e todas as chaves guardadas. Ficam sem chave: Trabalho, Cliente. Depois, crie uma senha nova e cole as chaves de novo.',
    });
    expect(api.reset).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Redefinir cofre' }));

    await waitFor(() => expect(api.reset).toHaveBeenCalledWith({ confirm: true }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('sem chave guardada, redefinir diz que nenhuma conta perde chave', async () => {
    const { bar } = setup({ state: 'locked', available: true }, [
      apiAccount({ name: 'Nova', keyState: 'missing' }),
    ]);
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Redefinir cofre' }));
    expect(
      within(bar()).getByRole('group', {
        name: 'Redefinir o cofre apaga a senha. Nenhuma conta tem chave guardada.',
      }),
    ).toBeInTheDocument();
  });

  it('cofre ainda sem senha não oferece Destrancar nem menu, e diz quando a senha é criada', () => {
    const { bar } = setup({ state: 'empty', available: true });
    expect(within(bar()).getByText('Cofre sem senha')).toBeInTheDocument();
    expect(
      within(bar()).getByText('A senha do cofre é criada ao colar a primeira chave.'),
    ).toBeInTheDocument();
    expect(within(bar()).queryByRole('button')).toBeNull();
  });

  it('sem a proteção do Windows, a barra diz que as chaves não abrem', () => {
    const { bar } = setup({ state: 'locked', available: false });
    expect(
      within(bar()).getByText(
        'A proteção do Windows que cifra a chave não está disponível neste computador: as chaves guardadas não abrem.',
      ),
    ).toBeInTheDocument();
  });
});
