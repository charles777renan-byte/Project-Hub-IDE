import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDto, AppResult, ProjectHubApi, TerminalSummary } from '@project-hub/contracts';
import { ApiKeyActions } from '../../src/renderer/components/settings/ApiKeyActions';

// As ações da chave de uma conta API. A chave nunca passa pela tela: colar manda só o programa e o id da conta, e a
// resposta traz só os 4 últimos caracteres. Trocar e remover não são bloqueados por painéis abertos, mas a
// confirmação diz quais seguem com a chave antiga.

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const WIN_V =
  'Apague a chave do histórico da área de transferência do Windows (Win+V), se ele estiver ligado.';
const REVOKE = 'Para a chave antiga parar de valer, revogue-a no site do serviço.';

const ok = <T,>(data: T): Promise<AppResult<T>> => Promise.resolve({ ok: true, data });
const fail = (code: string, message: string): Promise<AppResult<never>> =>
  Promise.resolve({ ok: false, error: { code, message, retryable: false } } as AppResult<never>);

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

function terminal(overrides: Partial<TerminalSummary>): TerminalSummary {
  return {
    id: 't',
    kind: 'agent',
    title: 'Painel',
    projectId: 'p',
    projectName: 'Projeto',
    state: 'running',
    provider: 'claude',
    origin: 'new',
    ...overrides,
  };
}

function setup(account: AccountDto, terminals: TerminalSummary[] = []) {
  const accounts = {
    pasteKey: vi.fn((_input: unknown) => ok({ last4: 'WXYZ' })),
    removeKey: vi.fn((_input: unknown) => ok(undefined)),
  };
  const list = vi.fn(() => ok(terminals));
  window.projectHub = { accounts, terminals: { list } } as unknown as ProjectHubApi;
  const onChanged = vi.fn();
  render(<ApiKeyActions account={account} program="Claude Code" onChanged={onChanged} />);
  return { accounts, list, onChanged };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ApiKeyActions', () => {
  it('colar manda só programa e id, e mostra os 4 últimos com o lembrete do Win+V', async () => {
    const { accounts, onChanged } = setup(apiAccount({ keyState: 'missing', keyLast4: undefined }));
    expect(screen.queryByRole('button', { name: 'Remover chave' })).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: 'Colar chave da área de transferência' }),
    );

    expect(accounts.pasteKey).toHaveBeenCalledWith({ provider: 'claude', accountId: A });
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(
      'Chave guardada, terminada em …WXYZ. Confira se é a chave certa.',
    );
    expect(notice).toHaveTextContent(WIN_V);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('chave ilegível oferece colar de novo, sem confirmação', async () => {
    const { accounts } = setup(apiAccount({ keyState: 'unreadable' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Colar chave da área de transferência' }),
    );
    expect(accounts.pasteKey).toHaveBeenCalledTimes(1);
  });

  it('recusa do processo principal aparece como veio, em role="alert"', async () => {
    const { accounts, onChanged } = setup(apiAccount({ keyState: 'missing', keyLast4: undefined }));
    accounts.pasteKey.mockImplementationOnce(
      () =>
        fail(
          'VALIDATION_FAILED',
          'A área de transferência não tem uma chave de API da Anthropic.',
        ) as never,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Colar chave da área de transferência' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A área de transferência não tem uma chave de API da Anthropic.',
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('trocar e remover pedem confirmação com os nomes dos painéis abertos', async () => {
    const { accounts, list } = setup(apiAccount(), [
      terminal({ id: '1', title: 'Revisão', accountId: A }),
      terminal({ id: '2', title: 'Ajustes', accountId: A }),
      terminal({ id: '3', title: 'Outra conta', accountId: B }),
      terminal({ id: '4', title: 'Principal', accountId: null }),
      terminal({ id: '5', title: 'Fechado', accountId: A, state: 'exited' }),
      terminal({ id: '6', title: 'Codex', accountId: A, provider: 'codex' }),
      terminal({ id: '7', title: 'Shell', kind: 'shell' }),
    ]);
    const panels = `Os painéis abertos desta conta continuam com a chave antiga até serem fechados: Revisão, Ajustes. ${REVOKE}`;

    await userEvent.click(screen.getByRole('button', { name: 'Trocar chave' }));
    expect(list).toHaveBeenCalledTimes(1);
    const replace = await screen.findByRole('group');
    expect(replace).toHaveAccessibleName(
      `Copie a chave nova no site do serviço e confirme: ela entra no lugar desta. ${panels}`,
    );
    expect(accounts.pasteKey).not.toHaveBeenCalled();
    await userEvent.click(within(replace).getByRole('button', { name: 'Trocar chave' }));
    await waitFor(() =>
      expect(accounts.pasteKey).toHaveBeenCalledWith({ provider: 'claude', accountId: A }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('…WXYZ');

    await userEvent.click(screen.getByRole('button', { name: 'Remover chave' }));
    const remove = await screen.findByRole('group');
    expect(remove).toHaveAccessibleName(
      `Remover a chave apaga a chave guardada desta conta neste computador. ${panels}`,
    );
    expect(accounts.removeKey).not.toHaveBeenCalled();
    await userEvent.click(within(remove).getByRole('button', { name: 'Remover chave' }));
    await waitFor(() =>
      expect(accounts.removeKey).toHaveBeenCalledWith({ provider: 'claude', accountId: A }),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sem painéis abertos, a confirmação só manda revogar a chave antiga', async () => {
    setup(apiAccount());
    await userEvent.click(screen.getByRole('button', { name: 'Remover chave' }));
    const group = await screen.findByRole('group');
    expect(group).toHaveAccessibleName(
      `Remover a chave apaga a chave guardada desta conta neste computador. ${REVOKE}`,
    );
  });

  it('Voltar fecha a confirmação sem chamar o app', async () => {
    const { accounts } = setup(apiAccount());
    await userEvent.click(screen.getByRole('button', { name: 'Remover chave' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(accounts.removeKey).not.toHaveBeenCalled();
  });

  it('remover a chave da conta padrão avisa que a padrão volta à Principal', async () => {
    setup(apiAccount({ isDefault: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover chave' }));
    const group = await screen.findByRole('group');
    expect(group).toHaveAccessibleName(
      `Remover a chave apaga a chave guardada desta conta neste computador. ${REVOKE} Esta é a conta padrão do Claude Code. A padrão volta a ser a Principal.`,
    );
  });

  it('sem a lista dos painéis, a confirmação avisa dos painéis abertos sem nomes', async () => {
    const { list } = setup(apiAccount());
    list.mockImplementationOnce(() => fail('UNKNOWN', 'x') as never);
    await userEvent.click(screen.getByRole('button', { name: 'Trocar chave' }));
    const group = await screen.findByRole('group');
    expect(group).toHaveAccessibleName(
      `Copie a chave nova no site do serviço e confirme: ela entra no lugar desta. Os painéis abertos desta conta continuam com a chave antiga até serem fechados. ${REVOKE}`,
    );
  });
});
