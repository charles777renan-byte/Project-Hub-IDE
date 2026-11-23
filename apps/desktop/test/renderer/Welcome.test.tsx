import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountsDto,
  AgentsDto,
  AppResult,
  EnvironmentDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { Welcome } from '../../src/renderer/components/home/Welcome';
import { ADD_PROJECT_REQUEST_EVENT } from '../../src/renderer/projects-events';

// O painel de boas-vindas do Início sem projeto: as conferências do ambiente, onde os dados ficam e o primeiro projeto.

const ok = <T,>(data: T): Promise<AppResult<T>> => Promise.resolve({ ok: true, data });
const fail = (message: string): Promise<AppResult<never>> =>
  Promise.resolve({
    ok: false,
    error: { code: 'UNKNOWN', message, retryable: false },
  } as AppResult<never>);

const ENVIRONMENT: EnvironmentDto = {
  git: { installed: true, version: 'git version 2.47.0' },
  worktreesRoot: 'C:\\dados\\worktrees',
};

function agents(installed = true): AgentsDto {
  return {
    programs: [
      { provider: 'claude', label: 'Claude Code', installed, role: 'missions' },
      { provider: 'codex', label: 'Codex', installed: true, role: 'panels' },
    ],
    profiles: [{ id: 'padrao', name: 'Padrão do programa', builtIn: true, isDefault: true }],
  };
}

function accounts(state: 'connected' | 'signed-out' | 'unknown' = 'connected'): AccountsDto {
  return {
    groups: [
      {
        provider: 'claude',
        installed: true,
        accounts: [{ id: null, name: 'Principal', isDefault: true, state }],
        autoSwitch: { enabled: false, includeApi: false },
        preferredId: null,
      },
    ],
    others: [],
  } as unknown as AccountsDto;
}

type Setup = {
  environment?: EnvironmentDto | 'error';
  agents?: AgentsDto | 'error';
  accounts?: AccountsDto | 'error';
};

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function setup(options: Setup = {}) {
  const read = <T,>(value: T | 'error' | undefined, fallback: T) =>
    value === 'error' ? fail('x') : ok(value ?? fallback);
  const api = {
    system: { environment: vi.fn(() => read(options.environment, ENVIRONMENT)) },
    agents: {
      get: vi.fn(() => read(options.agents, agents())),
      testProgram: vi.fn(() => ok({ version: '2.1.330 (Claude Code)' })),
    },
    accounts: { list: vi.fn(() => read(options.accounts, accounts())) },
    app: { info: vi.fn(() => ok({ version: '0.1.0', dataDir: 'C:\\dados' })) },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <Welcome />
              <Where />
            </>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return api;
}

const check = async (name: string) =>
  (await screen.findByText(name, { selector: '.welcome__check-name' })).closest('li')!;

afterEach(() => {
  delete (window as { projectHub?: unknown }).projectHub;
});

describe('Welcome', () => {
  it('dá as boas-vindas e explica o fluxo numa frase', async () => {
    setup();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Boas-vindas ao Project Hub' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Você descreve o que quer numa missão/)).toBeInTheDocument();
  });

  it('com tudo no lugar: Git com a versão, Claude Code instalado, conta conectada e "Tudo pronto"', async () => {
    setup();

    const git = await check('Git');
    expect(await within(git).findByText('Instalado')).toBeInTheDocument();
    expect(within(git).getByText('git version 2.47.0')).toBeInTheDocument();
    expect(within(await check('Claude Code')).getByText('Instalado')).toBeInTheDocument();
    expect(within(await check('Conta do Claude Code')).getByText('Conectada')).toBeInTheDocument();
    expect(await screen.findByText('Tudo pronto para o primeiro projeto.')).toBeInTheDocument();
  });

  it('sem o Git: diz que não foi encontrado e o que fazer', async () => {
    setup({ environment: { ...ENVIRONMENT, git: { installed: false } } });

    const git = await check('Git');
    expect(await within(git).findByText('Não encontrado')).toBeInTheDocument();
    expect(within(git).getByText(/Instale o Git/)).toBeInTheDocument();
    expect(screen.queryByText('Tudo pronto para o primeiro projeto.')).toBeNull();
    expect(
      screen.getByText('Você pode adicionar o projeto agora e resolver o que falta depois.'),
    ).toBeInTheDocument();
  });

  it('sem o Claude Code: diz que as missões dependem dele, e não oferece o teste', async () => {
    setup({ agents: agents(false) });

    const claude = await check('Claude Code');
    expect(await within(claude).findByText('Não encontrado')).toBeInTheDocument();
    expect(within(claude).getByText(/As missões rodam no Claude Code/)).toBeInTheDocument();
    expect(within(claude).queryByRole('button', { name: 'Testar Claude Code' })).toBeNull();
  });

  it('Testar roda o Claude Code e mostra a versão', async () => {
    const api = setup();

    const claude = await check('Claude Code');
    await userEvent.click(
      await within(claude).findByRole('button', { name: 'Testar Claude Code' }),
    );

    expect(api.agents.testProgram).toHaveBeenCalledWith({ provider: 'claude' });
    expect(await within(claude).findByRole('status')).toHaveTextContent(
      'Respondeu: 2.1.330 (Claude Code)',
    );
  });

  it('o teste que falha diz o motivo', async () => {
    const api = setup();
    api.agents.testProgram.mockReturnValueOnce(fail('Claude Code não respondeu ao teste.'));

    const claude = await check('Claude Code');
    await userEvent.click(
      await within(claude).findByRole('button', { name: 'Testar Claude Code' }),
    );

    expect(await within(claude).findByRole('alert')).toHaveTextContent(
      'Claude Code não respondeu ao teste.',
    );
  });

  it('conta sem login: diz "Sem login" e leva às Contas', async () => {
    setup({ accounts: accounts('signed-out') });

    const account = await check('Conta do Claude Code');
    expect(await within(account).findByText('Sem login')).toBeInTheDocument();
    await userEvent.click(within(account).getByRole('link', { name: 'Abrir Contas' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/settings/contas');
  });

  it('uma conferência que não pôde ser lida diz isso e não trava as outras', async () => {
    setup({ environment: 'error' });

    expect(
      await within(await check('Git')).findByText('Não foi possível conferir'),
    ).toBeInTheDocument();
    expect(await within(await check('Claude Code')).findByText('Instalado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeEnabled();
  });

  it('Conferir de novo relê as conferências', async () => {
    const api = setup({ environment: { ...ENVIRONMENT, git: { installed: false } } });
    await within(await check('Git')).findByText('Não encontrado');
    api.system.environment.mockReturnValue(ok(ENVIRONMENT));

    await userEvent.click(screen.getByRole('button', { name: 'Conferir de novo' }));

    expect(await within(await check('Git')).findByText('Instalado')).toBeInTheDocument();
    expect(api.agents.get).toHaveBeenCalledTimes(2);
    expect(api.accounts.list).toHaveBeenCalledTimes(2);
  });

  it('diz onde ficam os dados e as cópias de trabalho', async () => {
    setup();

    const region = await screen.findByRole('region', { name: 'Onde ficam os seus dados' });
    expect(await within(region).findByText('C:\\dados')).toBeInTheDocument();
    expect(within(region).getByText('C:\\dados\\worktrees')).toBeInTheDocument();
    expect(within(region).getByText(/não vê a senha nem o token/)).toBeInTheDocument();
  });

  it('Adicionar projeto dispara o pedido com irParaMissoes', async () => {
    setup();
    const requests: Event[] = [];
    const listener = (event: Event) => requests.push(event);
    window.addEventListener(ADD_PROJECT_REQUEST_EVENT, listener);

    try {
      await userEvent.click(await screen.findByRole('button', { name: 'Adicionar projeto' }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect((requests[0] as CustomEvent).detail).toEqual({ irParaMissoes: true });
    } finally {
      window.removeEventListener(ADD_PROJECT_REQUEST_EVENT, listener);
    }
  });

  it('sem a ponte do app, mostra o painel e o botão, com as conferências em "Conferindo"', async () => {
    render(
      <MemoryRouter>
        <Welcome />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeInTheDocument();
    expect(within(await check('Git')).getByText('Conferindo')).toBeInTheDocument();
  });
});
