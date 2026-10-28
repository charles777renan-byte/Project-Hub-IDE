import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ProjectSummary, TerminalSummary, WorkspaceDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  RecentProjects,
  RECENT_PROJECTS,
} from '../../src/renderer/components/home/RecentProjects';
import { projectPath } from '../../src/renderer/routes';

const NOW = new Date('2026-10-24T12:00:00.000Z');

function project(id: string): ProjectSummary {
  return {
    id,
    name: `Projeto ${id}`,
    path: `C:\\${id}`,
    repositoryKind: 'git',
    available: true,
    defaultBranch: 'main',
  };
}

function workspace(projectId: string, lastActiveAt: string): WorkspaceDto {
  return {
    id: `w-${projectId}`,
    projectId,
    layout: null,
    position: 0,
    lastActiveAt,
  } as unknown as WorkspaceDto;
}

function terminal(id: string, projectId: string, state: TerminalSummary['state']): TerminalSummary {
  return {
    id,
    kind: 'shell',
    title: id,
    projectId,
    projectName: `Projeto ${projectId}`,
    state,
    provider: 'shell',
    origin: 'new',
  };
}

function renderProjects(props: Partial<Parameters<typeof RecentProjects>[0]> = {}) {
  return render(
    <MemoryRouter>
      <RecentProjects
        status="ready"
        projects={[]}
        workspaces={[]}
        terminals={[]}
        now={NOW}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('agoLabel', () => {
  it.each([
    ['2026-10-24T11:59:40.000Z', 'há instantes'],
    ['2026-10-24T11:45:00.000Z', 'há 15 min'],
    ['2026-10-24T09:00:00.000Z', 'há 3 h'],
    ['2026-10-23T10:00:00.000Z', 'há 1 dia'],
    ['2026-10-20T12:00:00.000Z', 'há 4 dias'],
    ['2026-10-25T12:00:00.000Z', 'há instantes'],
  ])('%s vira "%s"', (iso, expected) => {
    expect(agoLabel(iso, NOW)).toBe(expected);
  });

  it('data inválida não vira texto', () => {
    expect(agoLabel('não é data', NOW)).toBeUndefined();
  });
});

describe('RecentProjects', () => {
  it('sem projeto, mostra o convite sem link (a lateral tem o Adicionar projeto) e nenhuma grade', () => {
    const { container } = renderProjects();

    expect(
      screen.getByText('Nenhum projeto ainda. Adicione um projeto para começar.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('.recent-projects__grid')).toBeNull();
  });

  it('projeto sem workspace aparece sem "há X"; o com workspace mostra o tempo e as sessões abertas', () => {
    renderProjects({
      projects: [project('p1'), project('p2')],
      workspaces: [workspace('p1', '2026-10-24T09:00:00.000Z')],
      terminals: [
        terminal('t1', 'p1', 'running'),
        terminal('t2', 'p1', 'waiting'),
        terminal('t3', 'p1', 'exited'),
        terminal('t4', 'p2', 'exited'),
      ],
    });

    const withWorkspace = screen.getByRole('link', { name: /^Projeto p1/ }).closest('li');
    const without = screen.getByRole('link', { name: /^Projeto p2/ }).closest('li');
    expect(withWorkspace).not.toBeNull();
    expect(without).not.toBeNull();
    expect(
      within(withWorkspace as HTMLElement).getByText('2 sessões · há 3 h'),
    ).toBeInTheDocument();
    expect(within(without as HTMLElement).queryByText(/há /)).toBeNull();
    expect(within(without as HTMLElement).getByText('nenhuma sessão')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Projeto p1/ })).toHaveAttribute(
      'href',
      projectPath('p1'),
    );
  });

  it('ordena pela atividade mais recente, com os sem workspace por último', () => {
    renderProjects({
      projects: [project('a'), project('b'), project('c')],
      workspaces: [
        workspace('b', '2026-10-24T08:00:00.000Z'),
        workspace('c', '2026-10-24T10:00:00.000Z'),
      ],
    });

    const names = document.querySelectorAll('.recent-card__name');
    expect([...names].map((name) => name.textContent)).toEqual([
      'Projeto c',
      'Projeto b',
      'Projeto a',
    ]);
  });

  it('mostra no máximo 6 projetos', () => {
    const many = Array.from({ length: 9 }, (_, index) => project(`p${index}`));
    renderProjects({ projects: many });

    expect(screen.getAllByRole('listitem')).toHaveLength(RECENT_PROJECTS);
  });

  it('não fala de sessões enquanto a lista de terminais não chegou', () => {
    renderProjects({ projects: [project('p1')], terminals: null });

    expect(screen.queryByText(/sess/)).toBeNull();
  });

  it('com a leitura de terminais desconhecida, diz que as sessões estão indisponíveis', () => {
    renderProjects({ projects: [project('p1')], terminals: 'unknown' });

    expect(screen.getByText('Sessões indisponíveis')).toBeInTheDocument();
    expect(screen.queryByText('nenhuma sessão')).toBeNull();
  });

  it('cada cartão é um único link, com a inicial na classe de cor do projeto', () => {
    const { container } = renderProjects({ projects: [project('p1')] });

    expect(screen.getAllByRole('link')).toHaveLength(1);
    const icon = container.querySelector('.recent-card__icon');
    expect(icon).toHaveTextContent('P');
    expect(icon?.className).toMatch(/swatch--(purple|cyan|orange|pink|blue|teal)/);
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('mostra o apelido quando existe, com o nome da pasta no title; sem apelido, o nome', () => {
    const { container } = renderProjects({
      projects: [{ ...project('p1'), nickname: 'Re_Zero' }, project('p2')],
    });

    const names = container.querySelectorAll('.recent-card__name');
    expect(names[0]).toHaveTextContent('Re_Zero');
    expect(names[0]).toHaveAttribute('title', 'Projeto p1');
    expect(names[1]).toHaveTextContent('Projeto p2');
    expect(names[1]).toHaveAttribute('title', 'Projeto p2');
    expect(container.querySelectorAll('.recent-card__icon')[0]).toHaveTextContent('R');
  });

  it('o selo mostra o total de projetos, mesmo acima de 6', () => {
    const many = Array.from({ length: 9 }, (_, index) => project(`p${index}`));
    const { container } = renderProjects({ projects: many });

    expect(container.querySelector('.home-badge')).toHaveTextContent('9');
  });

  it('uma sessão fica no singular', () => {
    renderProjects({ projects: [project('p1')], terminals: [terminal('t1', 'p1', 'running')] });

    expect(screen.getByText('1 sessão')).toBeInTheDocument();
  });

  it('mostra a mensagem em erro e Carregando enquanto carrega', () => {
    const { rerender } = renderProjects({ status: 'error', message: 'Falhou ao ler.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Falhou ao ler.');

    rerender(
      <MemoryRouter>
        <RecentProjects status="loading" projects={[]} workspaces={[]} terminals={null} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
  });
});
