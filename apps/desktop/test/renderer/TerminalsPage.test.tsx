import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, ProjectHubApi, TerminalSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalsPage } from '../../src/renderer/pages/TerminalsPage';

// O xterm precisa de um navegador de verdade. Aqui o terminal é trocado por um marcador.
vi.mock('../../src/renderer/components/terminals/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="terminal-view">{terminalId}</div>
  ),
}));

const agent: TerminalSummary = {
  id: 'sessao-agente',
  kind: 'agent',
  title: 'Corrigir login',
  projectId: 'p1',
  projectName: 'app',
  missionId: 'm1',
  state: 'waiting',
};
const shell: TerminalSummary = {
  id: 'shell-1',
  kind: 'shell',
  title: 'Shell · app',
  projectId: 'p1',
  projectName: 'app',
  state: 'running',
};

function installApi(list: TerminalSummary[] = [agent, shell]) {
  const ok = <T,>(data: T) => Promise.resolve<AppResult<T>>({ ok: true, data });
  const terminals = {
    list: vi.fn(() => ok(list)),
    openShell: vi.fn(() => ok({ terminalId: 'shell-novo' })),
    close: vi.fn(() => ok(undefined)),
  };
  window.projectHub = {
    projects: {
      list: vi.fn(() =>
        ok([{ id: 'p1', name: 'app', path: 'C:/dev/app', repositoryKind: 'git', available: true }]),
      ),
    },
    terminals,
  } as unknown as ProjectHubApi;
  return terminals;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('TerminalsPage', () => {
  it('lista os terminais por projeto, com o estado em texto e em forma', async () => {
    installApi();
    render(<TerminalsPage />);

    const group = await screen.findByRole('region', { name: 'app' });
    expect(within(group).getByText('Corrigir login')).toBeInTheDocument();
    expect(within(group).getByText('Aguardando você')).toBeInTheDocument();
    expect(within(group).getByText('Rodando')).toBeInTheDocument();
  });

  it('escolher um item mostra o terminal no painel ativo', async () => {
    installApi();
    render(<TerminalsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Corrigir login/ }));

    expect(screen.getByTestId('terminal-view')).toHaveTextContent('sessao-agente');
  });

  it('dividir abre um segundo painel, e o mesmo terminal não vai para dois painéis', async () => {
    installApi();
    render(<TerminalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Corrigir login/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Dividir ao lado' }));
    expect(screen.getAllByRole('region', { name: /^Painel/ })).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: /Corrigir login/ }));
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1);

    await userEvent.click(screen.getByRole('region', { name: 'Painel 2' }));
    await userEvent.click(screen.getByRole('button', { name: /Shell · app/ }));
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(2);
  });

  it('limita a quatro painéis', async () => {
    installApi();
    render(<TerminalsPage />);
    const split = await screen.findByRole('button', { name: 'Dividir ao lado' });

    for (let i = 0; i < 5; i += 1) await userEvent.click(split);

    expect(screen.getAllByRole('region', { name: /^Painel/ })).toHaveLength(4);
    expect(split).toBeDisabled();
  });

  it('novo shell abre no projeto escolhido e já aparece no painel', async () => {
    const terminals = installApi();
    render(<TerminalsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Novo shell' }));

    await waitFor(() => expect(terminals.openShell).toHaveBeenCalledWith('p1'));
    expect(await screen.findByTestId('terminal-view')).toHaveTextContent('shell-novo');
  });

  it('fechar o painel só tira o terminal da tela; encerrar shell fecha o processo', async () => {
    const terminals = installApi();
    render(<TerminalsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Shell · app/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument();
    expect(terminals.close).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Shell · app/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar shell' }));
    expect(terminals.close).toHaveBeenCalledWith('shell-1');
  });

  it('sem terminais, avisa que a lista está vazia', async () => {
    installApi([]);
    render(<TerminalsPage />);

    expect(await screen.findByText('Nenhum agente nem shell aberto.')).toBeInTheDocument();
  });
});
