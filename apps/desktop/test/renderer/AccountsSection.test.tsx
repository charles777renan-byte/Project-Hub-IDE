import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountDto,
  AccountsDto,
  AppResult,
  LimitsDto,
  LoginDto,
  LoginEvent,
  ProjectHubApi,
  VaultDto,
} from '@project-hub/contracts';
import { AccountsSection } from '../../src/renderer/components/settings/AccountsSection';

// A seção Contas: as contas de cada programa, o que dá para fazer com cada uma e o login guiado dentro da linha.
// O terminal do programa (xterm) precisa de um navegador de verdade: aqui ele é trocado por um falso.

const terminal = vi.hoisted(() => ({
  written: [] as string[],
  typed: undefined as ((data: string) => void) | undefined,
  disposed: 0,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 16;
    open() {}
    write(data: string) {
      terminal.written.push(data);
    }
    onData(listener: (data: string) => void) {
      terminal.typed = listener;
      return { dispose: () => undefined };
    }
    focus() {}
    dispose() {
      terminal.disposed += 1;
    }
  },
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const ok = <T,>(data: T): Promise<AppResult<T>> => Promise.resolve({ ok: true, data });
const fail = (code: string, message: string): Promise<AppResult<never>> =>
  Promise.resolve({ ok: false, error: { code, message, retryable: false } } as AppResult<never>);

function account(overrides: Partial<AccountDto>): AccountDto {
  return {
    id: null,
    provider: 'claude',
    name: 'Principal',
    isPrincipal: true,
    isDefault: false,
    kind: 'subscription',
    state: 'connected',
    ...overrides,
  };
}

const DATA: AccountsDto = {
  groups: [
    {
      provider: 'claude',
      installed: true,
      autoSwitch: { enabled: false, includeApi: false },
      preferredId: null,
      accounts: [
        account({ isDefault: true, identity: 'voce@exemplo.com', organization: 'Org' }),
        account({ id: A, name: 'Trabalho', isPrincipal: false, state: 'signed-out' }),
        account({ id: B, name: 'Cliente', isPrincipal: false, identity: 'cliente@exemplo.com' }),
      ],
    },
    {
      provider: 'codex',
      installed: false,
      autoSwitch: { enabled: false, includeApi: false },
      preferredId: null,
      accounts: [account({ provider: 'codex', isDefault: true, state: 'unknown' })],
    },
  ],
  others: [
    { provider: 'antigravity', label: 'Antigravity', installed: true },
    { provider: 'opencode', label: 'OpenCode', installed: false },
  ],
};

function login(overrides: Partial<LoginDto> = {}): LoginDto {
  return {
    provider: 'claude',
    accountId: A,
    phase: 'browser',
    expiresAt: new Date(Date.now() + 9 * 60_000 + 42_000).toISOString(),
    ...overrides,
  };
}

function installApi(options: { data?: AccountsDto; current?: LoginDto | null } = {}) {
  let listener: ((event: LoginEvent) => void) | undefined;
  const api = {
    list: vi.fn(() => ok(options.data ?? DATA)),
    add: vi.fn((_input: { provider: string; name: string }) =>
      ok(account({ id: B, name: 'Nova', isPrincipal: false, state: 'signed-out' })),
    ),
    rename: vi.fn((_input: unknown) => ok(undefined)),
    setDefault: vi.fn((_input: unknown) => ok(undefined)),
    disconnect: vi.fn((_input: unknown) => ok(undefined)),
    remove: vi.fn((_input: { accountId: string; force: boolean }): Promise<AppResult<undefined>> =>
      ok(undefined),
    ),
    setAutoSwitch: vi.fn((_input: unknown) => ok(undefined)),
    login: {
      start: vi.fn((input: { provider: 'claude' | 'codex'; accountId: string | null }) =>
        ok(login({ ...input, phase: 'starting' })),
      ),
      get: vi.fn(() => ok(options.current ?? null)),
      cancel: vi.fn(() => ok(undefined)),
      confirm: vi.fn(() => ok(undefined)),
      reject: vi.fn(() => ok(undefined)),
      openUrl: vi.fn(() => ok(undefined)),
      copyUrl: vi.fn(() => ok(undefined)),
      write: vi.fn((_data: string) => ok(undefined)),
      resize: vi.fn((_cols: number, _rows: number) => ok(undefined)),
      subscribe: vi.fn((next: (event: LoginEvent) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    },
  };
  window.projectHub = { accounts: api } as unknown as ProjectHubApi;
  const emit = (event: LoginEvent) => act(() => listener?.(event));
  return { api, emit };
}

async function group(name: string): Promise<HTMLElement> {
  return screen.findByRole('region', { name });
}

function rowOf(groupElement: HTMLElement, name: string): HTMLElement {
  const item = within(groupElement)
    .getAllByRole('listitem')
    .find(
      (element) => within(element).queryByText(name, { selector: '.acct__name-text' }) !== null,
    );
  if (item === undefined) throw new Error(`conta ${name} não está na lista`);
  return item;
}

async function openMenu(row: HTMLElement, name: string) {
  await userEvent.click(within(row).getByRole('button', { name: `Mais ações da conta ${name}` }));
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  terminal.written = [];
  terminal.typed = undefined;
  terminal.disposed = 0;
});

describe('AccountsSection: lista', () => {
  it('diz como o login e a chave de API são guardados, sem prometer que o app não guarda nada', async () => {
    installApi();
    render(<AccountsSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'Contas' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Cada programa pode ter várias contas. Na de assinatura, o login fica no próprio programa e o Project Hub não vê a senha nem o token. Na de chave de API, a chave fica cifrada no cofre do app, neste computador.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/não vê nem guarda senha ou token/)).toBeNull();
    await group('Claude Code');
  });

  it('mostra a Principal e as extras de cada programa', async () => {
    installApi();
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    expect(
      within(claude)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.acct__name-text')?.textContent),
    ).toEqual(['Principal', 'Trabalho', 'Cliente']);
    expect(within(claude).getByText('3 contas')).toBeInTheDocument();

    const principal = rowOf(claude, 'Principal');
    expect(within(principal).getByText('Padrão')).toBeInTheDocument();
    expect(within(principal).getByText('voce@exemplo.com')).toBeInTheDocument();
    expect(within(principal).getByText('Conectada')).toBeInTheDocument();
    expect(within(rowOf(claude, 'Cliente')).queryByText('Padrão')).toBeNull();
  });

  it('a conta sem login tem o botão Conectar e o estado Sem login', async () => {
    installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    expect(within(row).getByText('Sem login')).toBeInTheDocument();
    expect(within(row).getByText('Ainda sem login')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Conectar' })).toBeInTheDocument();
    expect(
      within(rowOf(await group('Claude Code'), 'Cliente')).queryByRole('button', {
        name: 'Conectar',
      }),
    ).toBeNull();
  });

  it('a conta que o programa não soube informar diz isso', async () => {
    installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Codex'), 'Principal');
    expect(within(row).getByText('Não foi possível ler')).toBeInTheDocument();
  });

  it('o grupo do programa mostra o interruptor da troca automática, e ligar recarrega a lista', async () => {
    const { api } = installApi();
    const user = userEvent.setup();
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    const toggle = within(claude).getByRole('switch', {
      name: /Trocar de conta quando o limite acabar/,
    });
    const before = api.list.mock.calls.length;
    await user.click(toggle);
    expect(api.setAutoSwitch).toHaveBeenCalledWith({
      provider: 'claude',
      option: 'enabled',
      value: true,
    });
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(before));
  });

  it('programa não instalado não oferece adicionar conta', async () => {
    installApi();
    render(<AccountsSection />);
    const codex = await group('Codex');
    expect(within(codex).getByText('Não instalado')).toBeInTheDocument();
    expect(within(codex).queryByRole('button', { name: 'Adicionar conta' })).toBeNull();
    expect(
      within(await group('Claude Code')).getByRole('button', { name: 'Adicionar conta' }),
    ).toBeInTheDocument();
  });

  it('outros programas mostram Instalado ou Não instalado', async () => {
    installApi();
    render(<AccountsSection />);
    const others = await group('Outros programas');
    const items = within(others).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'AntigravityInstalado',
      'OpenCodeNão instalado',
    ]);
  });

  it('quando a leitura falha, diz isso e deixa tentar de novo', async () => {
    const { api } = installApi();
    api.list.mockImplementationOnce(() => fail('UNKNOWN', 'x') as never);
    render(<AccountsSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler as contas.');

    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await group('Claude Code')).toBeInTheDocument();
  });

  it('sem a ponte do app (testes da janela inteira), a seção ainda aparece', () => {
    render(<AccountsSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'Contas' })).toBeInTheDocument();
  });
});

describe('AccountsSection: adicionar e renomear', () => {
  it('adicionar conta manda programa e nome e relê a lista', async () => {
    const { api } = installApi();
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Adicionar conta' }));

    expect(within(claude).getByRole('form', { name: 'Nova conta do Claude Code' })).toBeVisible();
    expect(within(claude).getByRole('radio', { name: 'Assinatura' })).toHaveFocus();
    const field = within(claude).getByRole('textbox', { name: 'Nome da conta' });
    expect(field).toHaveAttribute('maxlength', '40');
    await userEvent.type(field, 'Estudos{Enter}');

    await waitFor(() =>
      expect(api.add).toHaveBeenCalledWith({
        provider: 'claude',
        name: 'Estudos',
        kind: 'subscription',
      }),
    );
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(within(claude).queryByRole('textbox', { name: 'Nome da conta' })).toBeNull();
  });

  it('nome repetido mostra o erro do serviço no campo', async () => {
    const { api } = installApi();
    api.add.mockImplementationOnce(
      () => fail('VALIDATION_FAILED', 'Já existe uma conta com este nome neste programa.') as never,
    );
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Adicionar conta' }));
    await userEvent.type(
      within(claude).getByRole('textbox', { name: 'Nome da conta' }),
      'Trabalho',
    );
    await userEvent.click(within(claude).getByRole('button', { name: 'Adicionar conta' }));

    expect(await within(claude).findByRole('alert')).toHaveTextContent(
      'Já existe uma conta com este nome neste programa.',
    );
    expect(within(claude).getByRole('textbox', { name: 'Nome da conta' })).toHaveValue('Trabalho');
  });

  it('Cancelar fecha o campo sem chamar o app', async () => {
    const { api } = installApi();
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Adicionar conta' }));
    await userEvent.click(within(claude).getByRole('button', { name: 'Cancelar' }));
    expect(within(claude).queryByRole('textbox')).toBeNull();
    expect(api.add).not.toHaveBeenCalled();
  });

  it('o botão do cabeçalho some com o painel aberto e recebe o foco quando ele fecha', async () => {
    installApi();
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Adicionar conta' }));
    // Com o painel aberto, o único "Adicionar conta" é o de enviar o nome.
    const buttons = within(claude).getAllByRole('button', { name: 'Adicionar conta' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('type', 'submit');

    await userEvent.keyboard('{Escape}');
    expect(within(claude).queryByRole('form')).toBeNull();
    expect(within(claude).getByRole('button', { name: 'Adicionar conta' })).toHaveFocus();
  });

  it('renomear manda o id e o nome novo', async () => {
    const { api } = installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Cliente');
    await openMenu(row, 'Cliente');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Renomear' }));

    const field = within(row).getByRole('textbox', { name: 'Nome da conta' });
    expect(field).toHaveValue('Cliente');
    await userEvent.clear(field);
    await userEvent.type(field, 'Freela{Enter}');

    await waitFor(() => expect(api.rename).toHaveBeenCalledWith({ accountId: B, name: 'Freela' }));
  });

  it('a Principal não tem Renomear nem Remover', async () => {
    installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Principal');
    await openMenu(row, 'Principal');
    await screen.findByRole('menuitem', { name: 'Desconectar' });
    expect(screen.queryByRole('menuitem', { name: 'Renomear' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Remover conta' })).toBeNull();
  });
});

describe('AccountsSection: padrão, desconectar e remover', () => {
  it('Definir como padrão fica desligado na conta sem login, com o motivo', async () => {
    installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await openMenu(row, 'Trabalho');
    const item = await screen.findByRole('menuitem', { name: 'Definir como padrão' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('title', 'Conecte a conta antes');
  });

  it('Definir como padrão manda o programa e a conta', async () => {
    const { api } = installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Cliente');
    await openMenu(row, 'Cliente');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Definir como padrão' }));
    await waitFor(() =>
      expect(api.setDefault).toHaveBeenCalledWith({ provider: 'claude', accountId: B }),
    );
  });

  it('desconectar a Principal mostra o aviso de fora do app antes de chamar', async () => {
    const { api } = installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Principal');
    await openMenu(row, 'Principal');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Desconectar' }));

    expect(
      within(row).getByText(
        'Sair da conta Principal também desconecta o programa fora do Project Hub.',
      ),
    ).toBeInTheDocument();
    expect(api.disconnect).not.toHaveBeenCalled();

    await userEvent.click(within(row).getByRole('button', { name: 'Desconectar' }));

    await waitFor(() =>
      expect(api.disconnect).toHaveBeenCalledWith({ provider: 'claude', accountId: null }),
    );
  });

  it('remover pede confirmação antes de chamar o app', async () => {
    const { api } = installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Cliente');
    await openMenu(row, 'Cliente');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remover conta' }));

    expect(
      within(row).getByText(
        'Remover a conta apaga, neste computador, o login, o histórico e os ajustes dela no programa. O acesso no serviço não é cancelado.',
      ),
    ).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();

    await userEvent.click(within(row).getByRole('button', { name: 'Voltar' }));
    expect(api.remove).not.toHaveBeenCalled();

    await openMenu(row, 'Cliente');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remover conta' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Remover conta' }));

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ accountId: B, force: false }));
  });

  it('a falha de saída oferece remover mesmo assim, com force', async () => {
    const { api } = installApi();
    api.remove.mockImplementationOnce(() =>
      fail('PROCESS_START_FAILED', 'Não foi possível sair da conta pelo programa.'),
    );
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Cliente');
    await openMenu(row, 'Cliente');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remover conta' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Remover conta' }));

    expect(
      await within(row).findByText(
        'Não foi possível sair da conta pelo programa. Remover mesmo assim?',
      ),
    ).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Remover mesmo assim' }));

    await waitFor(() => expect(api.remove).toHaveBeenLastCalledWith({ accountId: B, force: true }));
  });

  it('a falha de uma ação aparece na linha da conta', async () => {
    const { api } = installApi();
    api.disconnect.mockImplementationOnce(
      () =>
        fail('VALIDATION_FAILED', 'Feche antes os painéis que usam esta conta: Painel 1.') as never,
    );
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Cliente');
    await openMenu(row, 'Cliente');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Desconectar' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      'Feche antes os painéis que usam esta conta: Painel 1.',
    );
  });
});

describe('AccountsSection: login guiado', () => {
  it('Conectar inicia o login daquela conta', async () => {
    const { api } = installApi();
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');

    await userEvent.click(within(row).getByRole('button', { name: 'Conectar' }));

    expect(api.login.start).toHaveBeenCalledExactlyOnceWith({ provider: 'claude', accountId: A });
    expect(await within(row).findByText('Conectando')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Conectar' })).toBeNull();
  });

  it('com login em curso, as outras contas não oferecem Conectar', async () => {
    installApi({ current: login({ accountId: B, phase: 'browser' }) });
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    await within(rowOf(claude, 'Cliente')).findByText('Conectando');
    expect(
      within(rowOf(claude, 'Trabalho')).getByRole('button', { name: 'Conectar' }),
    ).toBeDisabled();
  });

  it('mostra os três passos, com o servidor do login, e nunca o endereço', async () => {
    installApi({ current: login({ host: 'claude.ai' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    const steps = await within(row).findByRole('list', { name: 'Passos do login' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.login-step__title')?.textContent),
    ).toEqual([
      'Claude Code aberto na pasta da conta Trabalho',
      'Entre pelo navegador',
      'Conferir a conta conectada',
    ]);
    expect(within(steps).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step');
    expect(within(row).getByText('claude.ai')).toBeInTheDocument();
    expect(row.textContent).not.toContain('https://');
    expect(within(row).getByText(/expira em 9:4\d/)).toBeInTheDocument();
  });

  it('Abrir de novo e Copiar endereço pedem ao app, sem mandar endereço', async () => {
    const { api } = installApi({ current: login({ host: 'claude.ai' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await userEvent.click(await within(row).findByRole('button', { name: 'Abrir de novo' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Copiar endereço' }));
    expect(api.login.openUrl).toHaveBeenCalledExactlyOnceWith();
    expect(api.login.copyUrl).toHaveBeenCalledExactlyOnceWith();
    expect(await within(row).findByText('Endereço copiado.')).toBeInTheDocument();
  });

  it('sem o servidor ainda, os botões do endereço ficam desligados', async () => {
    installApi({ current: login() });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    expect(await within(row).findByRole('button', { name: 'Abrir de novo' })).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Copiar endereço' })).toBeDisabled();
  });

  it('o terminal do programa mostra a saída e manda a digitação', async () => {
    const { api, emit } = installApi({ current: login() });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    const toggle = await within(row).findByRole('button', { name: 'Ver o terminal do programa' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    emit({ type: 'data', data: 'Cole o código: ' });

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // A saída que chegou antes de o terminal abrir não se perde.
    expect(terminal.written.join('')).toContain('Cole o código: ');
    expect(api.login.resize).toHaveBeenCalledWith(80, 16);

    emit({ type: 'data', data: 'ok' });
    expect(terminal.written.join('')).toContain('ok');
    act(() => terminal.typed?.('abc\r'));
    expect(api.login.write).toHaveBeenCalledWith('abc\r');
  });

  it('na conferência mostra a conta informada, e Concluir confirma', async () => {
    const { api, emit } = installApi({ current: login() });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await within(row).findByRole('list', { name: 'Passos do login' });

    emit({ type: 'state', login: login({ phase: 'confirm', identity: 'trabalho@exemplo.com' }) });

    expect(within(row).getByText('O programa conectou esta conta:')).toBeInTheDocument();
    expect(within(row).getByText('trabalho@exemplo.com')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Concluir' }));
    expect(api.login.confirm).toHaveBeenCalledOnce();
  });

  it('avisa quando a conta conectada é a mesma de outra', async () => {
    installApi({
      current: login({ phase: 'confirm', identity: 'voce@exemplo.com', duplicateOf: 'Principal' }),
    });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    expect(
      await within(row).findByText(
        'É a mesma conta de “Principal”. Se não era a intenção, escolha “Não é esta conta”.',
      ),
    ).toBeInTheDocument();
  });

  it('sem identidade (Codex), diz que o programa não informa a conta', async () => {
    installApi({ current: login({ phase: 'confirm' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    expect(
      await within(row).findByText('O programa confirma o login, mas não informa qual é a conta.'),
    ).toBeInTheDocument();
  });

  it('no Codex, a conferência diz que a conta veio pelo ChatGPT', async () => {
    installApi({ current: login({ provider: 'codex', accountId: null, phase: 'confirm' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Codex'), 'Principal');
    expect(
      await within(row).findByText('Conectada pelo ChatGPT. O Codex não informa qual conta.'),
    ).toBeInTheDocument();
  });

  it('Não é esta conta pede para sair e recomeçar', async () => {
    const { api } = installApi({ current: login({ phase: 'confirm', identity: 'x@y.co' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await userEvent.click(await within(row).findByRole('button', { name: 'Não é esta conta' }));
    expect(api.login.reject).toHaveBeenCalledOnce();
  });

  it('Cancelar encerra o login', async () => {
    const { api } = installApi({ current: login() });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await userEvent.click(await within(row).findByRole('button', { name: 'Cancelar' }));
    expect(api.login.cancel).toHaveBeenCalledOnce();
  });

  it('o login concluído fecha o guia e relê as contas', async () => {
    const { api, emit } = installApi({ current: login() });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await within(row).findByRole('list', { name: 'Passos do login' });
    const before = api.list.mock.calls.length;

    emit({ type: 'state', login: login({ phase: 'done' }) });

    await waitFor(() => expect(api.list.mock.calls.length).toBe(before + 1));
    expect(screen.queryByRole('list', { name: 'Passos do login' })).toBeNull();
  });

  it('a falha diz o que houve e deixa tentar de novo ou fechar', async () => {
    const { api } = installApi({ current: login({ phase: 'failed', problem: 'not-connected' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      'O login não foi concluído. A conta continua sem login.',
    );

    await userEvent.click(within(row).getByRole('button', { name: 'Tentar de novo' }));
    expect(api.login.start).toHaveBeenCalledWith({ provider: 'claude', accountId: A });
  });

  it('Fechar dispensa o login que falhou', async () => {
    const { api } = installApi({ current: login({ phase: 'failed', problem: 'start-failed' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await userEvent.click(await within(row).findByRole('button', { name: 'Fechar' }));
    expect(api.login.cancel).toHaveBeenCalledOnce();
  });

  it('o prazo esgotado diz isso', async () => {
    installApi({ current: login({ phase: 'timed-out' }) });
    render(<AccountsSection />);
    const row = rowOf(await group('Claude Code'), 'Trabalho');
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      'O login expirou sem a autorização no navegador.',
    );
  });
});

describe('AccountsSection: uso por conta', () => {
  type Entry = LimitsDto['accounts'][number];
  const entry = (overrides: Partial<Entry>): Entry => ({
    provider: 'claude',
    accountId: null,
    accountName: 'Principal',
    windows: [],
    refreshing: false,
    ...overrides,
  });
  const read = (overrides: Partial<Entry>): Entry =>
    entry({
      windows: [
        {
          id: 'five_hour',
          usedPercent: 40,
          resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
      capturedAt: new Date(Date.now() - 12 * 60_000 - 5_000).toISOString(),
      ...overrides,
    });

  function installLimits(accounts: Entry[]) {
    const state: LimitsDto = { providers: [], accounts };
    const limits = {
      get: vi.fn(() => ok(state)),
      refresh: vi.fn(() => ok(state)),
      refreshAccount: vi.fn((_input: { provider: string; accountId: string | null }) => ok(state)),
      subscribe: vi.fn(() => () => undefined),
    };
    (window.projectHub as unknown as { limits: unknown }).limits = limits;
    return limits;
  }

  it('cada conta com leitura mostra a barra de uso e a idade da leitura', async () => {
    installApi();
    installLimits([read({}), read({ accountId: B, accountName: 'Cliente' })]);
    render(<AccountsSection />);

    const row = rowOf(await group('Claude Code'), 'Cliente');
    const usage = await within(row).findByRole('group', { name: 'Uso da conta Cliente' });
    expect(within(usage).getByRole('meter')).toHaveAttribute('aria-valuenow', '40');
    expect(within(usage).getByText('Lido há 12 min')).toBeInTheDocument();
  });

  it('"Atualizar uso" pede a leitura daquela conta, só pelo programa e pelo id', async () => {
    installApi();
    const limits = installLimits([read({}), read({ accountId: B, accountName: 'Cliente' })]);
    render(<AccountsSection />);

    const row = rowOf(await group('Claude Code'), 'Cliente');
    await userEvent.click(await within(row).findByRole('button', { name: 'Atualizar uso' }));

    expect(limits.refreshAccount.mock.calls).toEqual([[{ provider: 'claude', accountId: B }]]);
  });

  it('enquanto lê, o botão fica desabilitado, com rótulo próprio', async () => {
    installApi();
    installLimits([read({}), read({ accountId: B, accountName: 'Cliente', refreshing: true })]);
    render(<AccountsSection />);

    const row = rowOf(await group('Claude Code'), 'Cliente');
    expect(await within(row).findByRole('button', { name: 'Lendo o uso…' })).toBeDisabled();
  });

  it('problema de leitura vira a frase fixa, sem barra', async () => {
    installApi();
    installLimits([
      read({}),
      entry({ accountId: B, accountName: 'Cliente', problem: 'not-logged-in' }),
    ]);
    render(<AccountsSection />);

    const row = rowOf(await group('Claude Code'), 'Cliente');
    const usage = await within(row).findByRole('group', { name: 'Uso da conta Cliente' });
    expect(within(usage).getByText(/pede login/)).toBeInTheDocument();
    expect(within(usage).queryByRole('meter')).toBeNull();
  });

  it('conta sem login não mostra uso nem pede leitura', async () => {
    installApi();
    const limits = installLimits([
      read({}),
      entry({ accountId: A, accountName: 'Trabalho' }),
      read({ accountId: B, accountName: 'Cliente' }),
    ]);
    render(<AccountsSection />);

    const row = rowOf(await group('Claude Code'), 'Trabalho');
    await waitFor(() => expect(limits.get).toHaveBeenCalled());
    expect(within(row).queryByRole('group', { name: 'Uso da conta Trabalho' })).toBeNull();
    expect(limits.refreshAccount).not.toHaveBeenCalled();
  });

  it('abrir a seção pede a leitura das contas conectadas sem leitura, uma por vez, e não repete', async () => {
    installApi();
    const limits = installLimits([entry({}), entry({ accountId: B, accountName: 'Cliente' })]);
    let release: (() => void) | undefined;
    limits.refreshAccount.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, data: { providers: [], accounts: [] } });
        }) as ReturnType<typeof limits.refreshAccount>,
    );
    render(<AccountsSection />);

    await waitFor(() => expect(limits.refreshAccount).toHaveBeenCalledTimes(1));
    expect(limits.refreshAccount.mock.calls[0]).toEqual([{ provider: 'claude', accountId: null }]);
    await act(async () => {
      release?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(limits.refreshAccount).toHaveBeenCalledTimes(2));
    expect(limits.refreshAccount.mock.calls[1]).toEqual([{ provider: 'claude', accountId: B }]);
    // A resposta ainda diz "sem leitura": com a seção aberta, o pedido não se repete.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(limits.refreshAccount).toHaveBeenCalledTimes(2);
  });
});

describe('AccountsSection: conta por chave de API', () => {
  const K = '33333333-3333-4333-8333-333333333333';
  const WITH_API: AccountsDto = {
    groups: [
      {
        provider: 'claude',
        installed: true,
        autoSwitch: { enabled: false, includeApi: false },
        preferredId: null,
        accounts: [
          account({ isDefault: true, identity: 'voce@exemplo.com' }),
          account({
            id: K,
            name: 'Chave',
            isPrincipal: false,
            kind: 'api',
            keyState: 'locked',
            keyLast4: 'ab12',
          }),
        ],
      },
      {
        provider: 'codex',
        installed: true,
        autoSwitch: { enabled: false, includeApi: false },
        preferredId: null,
        accounts: [account({ provider: 'codex', isDefault: true })],
      },
    ],
    others: [],
  };

  function installVault(initial: VaultDto) {
    let listener: ((state: VaultDto) => void) | undefined;
    const vault = {
      get: vi.fn(() => ok(initial)),
      unlock: vi.fn(() => ok({ outcome: 'unlocked' as const })),
      lock: vi.fn(() => ok(undefined)),
      changePassword: vi.fn(() => ok({ outcome: 'changed' as const })),
      reset: vi.fn((_input: unknown) => ok(undefined)),
      subscribe: vi.fn((next: (state: VaultDto) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    };
    (window.projectHub as unknown as { vault: unknown }).vault = vault;
    const emit = (state: VaultDto) => act(() => listener?.(state));
    return { vault, emit };
  }

  it('a barra do cofre só aparece quando existe conta API', async () => {
    installApi();
    installVault({ state: 'locked', available: true });
    const first = render(<AccountsSection />);
    await group('Claude Code');
    expect(screen.queryByRole('group', { name: 'Cofre das chaves de API' })).toBeNull();
    first.unmount();

    installApi({ data: WITH_API });
    installVault({ state: 'locked', available: true });
    render(<AccountsSection />);
    const bar = await screen.findByRole('group', { name: 'Cofre das chaves de API' });
    expect(within(bar).getByText('Cofre trancado')).toBeInTheDocument();
  });

  it('a mudança do cofre relê as contas', async () => {
    const { api } = installApi({ data: WITH_API });
    const { emit } = installVault({ state: 'locked', available: true });
    render(<AccountsSection />);
    await screen.findByRole('group', { name: 'Cofre das chaves de API' });
    expect(api.list).toHaveBeenCalledTimes(1);

    await emit({ state: 'unlocked', available: true });

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(
      within(screen.getByRole('group', { name: 'Cofre das chaves de API' })).getByText(
        'Cofre destrancado',
      ),
    ).toBeInTheDocument();
  });

  it('adicionar conta no Claude Code pergunta o tipo e manda kind api; o Codex não pergunta', async () => {
    const { api } = installApi({ data: WITH_API });
    installVault({ state: 'locked', available: true });
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Adicionar conta' }));
    await userEvent.click(within(claude).getByRole('radio', { name: 'Chave de API' }));
    await userEvent.type(
      within(claude).getByRole('textbox', { name: 'Nome da conta' }),
      'Por uso{Enter}',
    );
    await waitFor(() =>
      expect(api.add).toHaveBeenCalledWith({ provider: 'claude', name: 'Por uso', kind: 'api' }),
    );

    const codex = await group('Codex');
    await userEvent.click(within(codex).getByRole('button', { name: 'Adicionar conta' }));
    expect(within(codex).getByRole('form', { name: 'Nova conta do Codex' })).toBeVisible();
    expect(within(codex).queryByRole('radiogroup', { name: 'Tipo da conta' })).toBeNull();
  });

  it('a linha da conta API não pede leitura de uso', async () => {
    installApi({ data: WITH_API });
    installVault({ state: 'unlocked', available: true });
    const limits = {
      get: vi.fn(() =>
        ok<LimitsDto>({
          providers: [],
          accounts: [
            {
              provider: 'claude',
              accountId: K,
              accountName: 'Chave',
              windows: [],
              refreshing: false,
            },
          ],
        }),
      ),
      refresh: vi.fn(() => ok(undefined)),
      refreshAccount: vi.fn((_input: unknown) => ok(undefined)),
      subscribe: vi.fn(() => () => undefined),
    };
    (window.projectHub as unknown as { limits: unknown }).limits = limits;
    render(<AccountsSection />);
    await group('Claude Code');
    await waitFor(() => expect(limits.get).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(limits.refreshAccount).not.toHaveBeenCalledWith({ provider: 'claude', accountId: K });
  });

  it('nenhum campo de texto para a chave existe na tela', async () => {
    installApi({ data: WITH_API });
    installVault({ state: 'unlocked', available: true });
    render(<AccountsSection />);
    const claude = await group('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Adicionar conta' }));
    await userEvent.click(within(claude).getByRole('radio', { name: 'Chave de API' }));
    const boxes = screen.queryAllByRole('textbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveAccessibleName('Nome da conta');
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });
});
