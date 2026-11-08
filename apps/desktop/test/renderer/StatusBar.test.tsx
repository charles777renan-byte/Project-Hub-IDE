import { act, render, screen, within } from '@testing-library/react';
import type { AppResult, MissionDto, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../../src/renderer/components/StatusBar';
import { setTerminalFocus, resetTerminalFocusForTests } from '../../src/renderer/terminal-focus';

// Barra de status (rodapé da janela): projeto e branch da aba ativa, os contadores da visão geral como links
// para o Início filtrado, o uso do computador e "Parar todos". A API do preload é falsa.

function project(id: string, name: string, defaultBranch?: string): ProjectSummary {
  return {
    id,
    name,
    path: `C:\\${name}`,
    repositoryKind: defaultBranch === undefined ? 'none' : 'git',
    available: true,
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
  };
}

function mission(id: string, status: MissionDto['status']): MissionDto {
  return {
    id,
    projectId: 'p1',
    title: `Missão ${id}`,
    objective: 'Objetivo',
    status,
    altersCode: false,
    acceptanceCriteria: [{ id: `${id}-c`, position: 1, text: 'Critério' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

function installApi(projects: ProjectSummary[], missions: MissionDto[] = []) {
  window.projectHub = {
    projects: {
      list: vi.fn(() => Promise.resolve<AppResult<ProjectSummary[]>>({ ok: true, data: projects })),
    },
    missions: {
      list: vi.fn(() => Promise.resolve<AppResult<MissionDto[]>>({ ok: true, data: missions })),
      subscribe: vi.fn(() => () => {}),
    },
    system: {
      usage: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: {
            cpuPercent: 12,
            memoryUsedBytes: 6 * 1024 ** 3,
            memoryTotalBytes: 24 * 1024 ** 3,
          },
        }),
      ),
    },
  } as unknown as ProjectHubApi;
}

function renderBar(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <StatusBar />
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  resetTerminalFocusForTests();
});

describe('StatusBar', () => {
  it('é o rodapé "Barra de status"', () => {
    installApi([]);
    renderBar();
    const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
    expect(footer.tagName).toBe('FOOTER');
  });

  it('mostra os três contadores como links para o Início filtrado por estado', async () => {
    installApi(
      [project('p1', 'TESTE', 'master')],
      [mission('m1', 'running'), mission('m2', 'waiting_input'), mission('m3', 'failed')],
    );
    renderBar();

    const running = await screen.findByRole('link', { name: '1 executando' });
    const attention = screen.getByRole('link', { name: '1 aguarda você' });
    const failed = screen.getByRole('link', { name: '1 falhou' });
    expect(running).toHaveAttribute('href', '/?estado=running');
    expect(attention).toHaveAttribute('href', '/?estado=attention');
    expect(failed).toHaveAttribute('href', '/?estado=failed');
    for (const link of [running, attention, failed]) {
      expect(link.getAttribute('href')).toContain('estado=');
    }
  });

  it('mostra "TESTE · master" na rota do workspace do projeto', async () => {
    installApi([project('p1', 'TESTE', 'master'), project('p2', 'Outro', 'main')]);
    renderBar('/workspaces/p1');
    expect(await screen.findByText('TESTE · master')).toBeInTheDocument();
    expect(screen.queryByText(/Outro/)).toBeNull();
  });

  it('mostra só o nome quando o projeto não tem branch', async () => {
    installApi([project('p1', 'Notas')]);
    renderBar('/workspaces/p1');
    expect(await screen.findByText('Notas')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('não mostra projeto na rota do Início', async () => {
    installApi([project('p1', 'TESTE', 'master')]);
    renderBar('/');
    await screen.findByRole('link', { name: '0 executando' });
    expect(screen.queryByText(/TESTE/)).toBeNull();
    expect(document.querySelector('.statusbar__project')).toBeNull();
  });

  it('mostra o nome do projeto como texto, nunca como marcação', async () => {
    installApi([project('p1', '<b>x</b>', 'master')]);
    renderBar('/workspaces/p1');
    const text = await screen.findByText('<b>x</b> · master');
    expect(text.querySelector('b')).toBeNull();
  });

  describe('foco do teclado no terminal', () => {
    const FOCO = 'Foco: Claude · Meu Projeto · Ctrl+Shift+Tab sai do terminal';

    it('com o foco num terminal, na rota do workspace, diz qual e como sair', async () => {
      installApi([project('p1', 'TESTE', 'master')]);
      setTerminalFocus({ key: 'a', title: 'Claude · Meu Projeto', inTerminal: true });
      renderBar('/workspaces/p1');
      const focus = await screen.findByText(FOCO);
      expect(focus.tagName).toBe('P');
      expect(focus).toHaveClass('statusbar__focus');
      // Truncado com reticências, o texto inteiro continua na dica.
      expect(focus).toHaveAttribute('title', FOCO);
      expect(await screen.findByText('TESTE · master')).toBeInTheDocument();
    });

    it('com o foco só no cartão do painel (fora do terminal), diz qual e não repete como sair', async () => {
      installApi([project('p1', 'TESTE', 'master')]);
      setTerminalFocus({ key: 'a', title: 'Claude · Meu Projeto', inTerminal: false });
      renderBar('/workspaces/p1');
      const focus = await screen.findByText('Foco: Claude · Meu Projeto');
      expect(focus).toHaveClass('statusbar__focus');
      expect(focus).toHaveAttribute('title', 'Foco: Claude · Meu Projeto');
      expect(screen.queryByText(/Ctrl+Shift+Tab/)).toBeNull();
      // O foco que entra no terminal acrescenta a dica de sair.
      act(() => setTerminalFocus({ key: 'a', title: 'Claude · Meu Projeto', inTerminal: true }));
      expect(screen.getByText(FOCO)).toBeInTheDocument();
    });

    it('sem foco, não mostra a parte Foco', async () => {
      installApi([project('p1', 'TESTE', 'master')]);
      renderBar('/workspaces/p1');
      await screen.findByText('TESTE · master');
      expect(screen.queryByText(/Foco:/)).toBeNull();
      expect(document.querySelector('.statusbar__focus')).toBeNull();
    });

    it('fora da rota do workspace não mostra, mesmo com foco definido', async () => {
      installApi([project('p1', 'TESTE', 'master')]);
      setTerminalFocus({ key: 'a', title: 'Claude · Meu Projeto', inTerminal: true });
      renderBar('/');
      await screen.findByRole('link', { name: '0 executando' });
      expect(screen.queryByText(/Foco:/)).toBeNull();
    });

    it('trocar de painel troca o título e perder o foco tira a parte Foco', async () => {
      installApi([project('p1', 'TESTE', 'master')]);
      renderBar('/workspaces/p1');
      await screen.findByText('TESTE · master');
      act(() => setTerminalFocus({ key: 'a', title: 'Claude', inTerminal: true }));
      expect(screen.getByText(/^Foco: Claude · /)).toBeInTheDocument();
      act(() => setTerminalFocus({ key: 'b', title: 'Codex', inTerminal: true }));
      expect(screen.queryByText(/^Foco: Claude/)).toBeNull();
      expect(screen.getByText(/^Foco: Codex · /)).toBeInTheDocument();
      act(() => resetTerminalFocusForTests());
      expect(screen.queryByText(/Foco:/)).toBeNull();
    });

    it('mostra o título como texto, nunca como marcação', async () => {
      installApi([project('p1', 'TESTE', 'master')]);
      setTerminalFocus({ key: 'a', title: '<b>x</b>', inTerminal: true });
      renderBar('/workspaces/p1');
      const focus = await screen.findByText(/^Foco: <b>x<\/b> · /);
      expect(focus.querySelector('b')).toBeNull();
    });
  });

  it('tem o uso do computador e o botão "Parar todos" quando há missão em execução', async () => {
    installApi([project('p1', 'TESTE', 'master')], [mission('m1', 'running')]);
    renderBar();
    const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
    expect(within(footer).getByRole('group', { name: 'Uso do computador' })).toBeInTheDocument();
    expect(await within(footer).findByRole('button', { name: 'Parar todos' })).toBeInTheDocument();
  });
});
