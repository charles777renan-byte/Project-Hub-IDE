import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDto, AccountGroupDto, AppResult, ProjectHubApi } from '@project-hub/contracts';
import { AutoSwitchToggles } from '../../src/renderer/components/settings/AutoSwitchToggles';

const A = '11111111-1111-4111-8111-111111111111';

function account(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: null,
    provider: 'claude',
    name: 'Principal',
    isPrincipal: true,
    isDefault: true,
    state: 'connected',
    kind: 'subscription',
    ...overrides,
  };
}

function group(overrides: Partial<AccountGroupDto> = {}): AccountGroupDto {
  return {
    provider: 'claude',
    installed: true,
    accounts: [account(), account({ id: A, name: 'Trabalho', isPrincipal: false, isDefault: false })],
    autoSwitch: { enabled: false, includeApi: false },
    preferredId: null,
    ...overrides,
  };
}

function installApi(result: AppResult<undefined> = { ok: true, data: undefined }) {
  const setAutoSwitch = vi.fn((_input: unknown) => Promise.resolve(result));
  window.projectHub = { accounts: { setAutoSwitch } } as unknown as ProjectHubApi;
  return setAutoSwitch;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('AutoSwitchToggles', () => {
  it('mostra o estado por texto e pela forma, e manda a mudança', async () => {
    const setAutoSwitch = installApi();
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AutoSwitchToggles group={group()} onChanged={onChanged} />);

    const toggle = screen.getByRole('switch', { name: /Trocar de conta quando o limite acabar/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent('Desligado');
    expect(toggle).toHaveAccessibleDescription(
      'Quando o limite de uma conta acaba, a missão continua na próxima conta com limite, e painéis e missões novos não abrem na conta esgotada.',
    );
    await user.click(toggle);
    expect(setAutoSwitch).toHaveBeenCalledWith({
      provider: 'claude',
      option: 'enabled',
      value: true,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('ligado, diz Ligado e desliga ao clicar', async () => {
    const setAutoSwitch = installApi();
    const user = userEvent.setup();
    render(
      <AutoSwitchToggles
        group={group({ autoSwitch: { enabled: true, includeApi: false } })}
        onChanged={() => undefined}
      />,
    );
    const toggle = screen.getByRole('switch', { name: /Trocar de conta/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent('Ligado');
    await user.click(toggle);
    expect(setAutoSwitch).toHaveBeenCalledWith({
      provider: 'claude',
      option: 'enabled',
      value: false,
    });
  });

  it('o de API só fica ativo com o principal ligado', async () => {
    const setAutoSwitch = installApi();
    const user = userEvent.setup();
    const { rerender } = render(
      <AutoSwitchToggles group={group()} onChanged={() => undefined} />,
    );
    const api = screen.getByRole('switch', { name: /Incluir contas de chave de API/ });
    expect(api).toBeDisabled();
    expect(screen.getByText('Ligue antes a troca de conta.')).toBeInTheDocument();

    rerender(
      <AutoSwitchToggles
        group={group({ autoSwitch: { enabled: true, includeApi: false } })}
        onChanged={() => undefined}
      />,
    );
    const enabledApi = screen.getByRole('switch', { name: /Incluir contas de chave de API/ });
    expect(enabledApi).toBeEnabled();
    expect(enabledApi).toHaveAccessibleDescription('Elas cobram por uso, sem teto.');
    await user.click(enabledApi);
    expect(setAutoSwitch).toHaveBeenCalledWith({
      provider: 'claude',
      option: 'includeApi',
      value: true,
    });
  });

  it('com uma conta só, os dois ficam desativados com o motivo', () => {
    installApi();
    render(
      <AutoSwitchToggles group={group({ accounts: [account()] })} onChanged={() => undefined} />,
    );
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled();
    expect(
      screen.getByText('Adicione outra conta para usar a troca automática.'),
    ).toBeInTheDocument();
  });

  it('o Codex não tem o interruptor de API e explica só os painéis', () => {
    installApi();
    render(
      <AutoSwitchToggles
        group={group({
          provider: 'codex',
          accounts: [
            account({ provider: 'codex' }),
            account({ provider: 'codex', id: A, name: 'Estudo', isPrincipal: false }),
          ],
        })}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(screen.getByRole('switch', { name: /Trocar de conta/ })).toHaveAccessibleDescription(
      'Quando o limite de uma conta acaba, painéis novos não abrem na conta esgotada.',
    );
  });

  it('mostra o erro do processo principal', async () => {
    installApi({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Adicione outra conta para usar a troca automática.',
        retryable: false,
      },
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<AutoSwitchToggles group={group()} onChanged={onChanged} />);
    await user.click(screen.getByRole('switch', { name: /Trocar de conta/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adicione outra conta para usar a troca automática.',
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
