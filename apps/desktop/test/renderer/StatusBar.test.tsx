import { render, screen, within } from '@testing-library/react';
import type { AppResult, MissionDto, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../../src/renderer/components/StatusBar';

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

  it('tem o uso do computador e o botão "Parar todos" quando há missão em execução', async () => {
    installApi([project('p1', 'TESTE', 'master')], [mission('m1', 'running')]);
    renderBar();
    const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
    expect(within(footer).getByRole('group', { name: 'Uso do computador' })).toBeInTheDocument();
    expect(await within(footer).findByRole('button', { name: 'Parar todos' })).toBeInTheDocument();
  });
});
