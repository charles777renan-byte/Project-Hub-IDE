import { render, screen, within } from '@testing-library/react';
import type { MissionDiffDto, MissionDiffFileDto, ProjectHubApi } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactsPanel } from '../../src/renderer/components/workspace/ArtifactsPanel';
import { DiffPanel } from '../../src/renderer/components/workspace/DiffPanel';

function file(
  path: string,
  status: MissionDiffFileDto['status'],
  added: number,
): MissionDiffFileDto {
  return { path, status, added, removed: 0, binary: false, truncated: false, patch: '' };
}

describe('ArtifactsPanel', () => {
  it('conta só os arquivos novos, sem listar caminhos nem linhas', () => {
    render(
      <ArtifactsPanel
        files={[
          file('a.txt', 'modified', 3),
          file('docs/novo.md', 'untracked', 2),
          file('src/b.ts', 'added', 1),
          file('velho.txt', 'deleted', 0),
        ]}
      />,
    );

    expect(screen.getByText('2 arquivos criados, listados acima')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.body).not.toHaveTextContent('docs/novo.md');
    expect(document.body).not.toHaveTextContent('src/b.ts');
    expect(document.body).not.toHaveTextContent('linha');
  });

  it('um arquivo novo diz "1 arquivo criado, listado acima", no singular', () => {
    render(<ArtifactsPanel files={[file('a.txt', 'modified', 1), file('b.md', 'added', 3)]} />);

    expect(screen.getByText('1 arquivo criado, listado acima')).toBeInTheDocument();
  });

  it('sem arquivos novos, diz "Nenhum arquivo criado"', () => {
    render(<ArtifactsPanel files={[file('a.txt', 'modified', 1)]} />);

    expect(screen.getByText('Nenhum arquivo criado')).toBeInTheDocument();
  });

  it('com a lista cortada, não dá a entender que ela está completa', () => {
    const { rerender } = render(
      <ArtifactsPanel files={[file('b.md', 'added', 3), file('c.md', 'added', 1)]} truncated />,
    );
    expect(screen.getByText('Pelo menos 2 arquivos criados, listados acima')).toBeInTheDocument();

    rerender(<ArtifactsPanel files={[file('b.md', 'added', 3)]} truncated />);
    expect(screen.getByText('Pelo menos 1 arquivo criado, listado acima')).toBeInTheDocument();

    rerender(<ArtifactsPanel files={[file('a.txt', 'modified', 1)]} truncated />);
    expect(screen.getByText('Nenhum arquivo criado entre os listados')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum arquivo criado')).toBeNull();
  });
});

describe('DiffPanel com a seção Artefatos', () => {
  const DIFF: MissionDiffDto = {
    files: [file('a.txt', 'modified', 1), file('novo.md', 'untracked', 5)],
    truncatedFiles: false,
  };

  it('mostra as alterações e, abaixo, a seção Artefatos, sem sub-abas e com uma consulta só', async () => {
    const diff = vi.fn(() => Promise.resolve({ ok: true, data: DIFF }));
    window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    expect(screen.queryByRole('tablist')).toBeNull();
    await screen.findByRole('list', { name: 'Arquivos alterados' });
    const artifacts = screen.getByRole('region', { name: 'Artefatos' });
    expect(within(artifacts).getByText('1 arquivo criado, listado acima')).toBeInTheDocument();
    expect(artifacts).not.toHaveTextContent('novo.md');
    expect(diff).toHaveBeenCalledTimes(1);
  });

  it('sem worktree, a seção Artefatos não afirma nada', () => {
    window.projectHub = { missions: { diff: vi.fn() } } as unknown as ProjectHubApi;

    render(<DiffPanel missionId="m1" hasWorktree={false} refreshKey={0} />);

    expect(screen.queryByRole('region', { name: 'Artefatos' })).toBeNull();
    expect(screen.queryByText(/arquivo criado/)).toBeNull();
  });

  it('enquanto carrega e com erro, a seção Artefatos não afirma nada', async () => {
    window.projectHub = {
      missions: { diff: vi.fn(() => new Promise(() => {})) },
    } as unknown as ProjectHubApi;
    const loading = render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);
    expect(screen.queryByText(/arquivo criado/)).toBeNull();
    loading.unmount();

    window.projectHub = {
      missions: {
        diff: vi.fn(() => Promise.resolve({ ok: false, error: { code: 'X', message: 'Falhou.' } })),
      },
    } as unknown as ProjectHubApi;
    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/arquivo criado/)).toBeNull();
  });

  it('com a lista cortada, a seção Artefatos diz "Pelo menos"', async () => {
    window.projectHub = {
      missions: {
        diff: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: { files: [file('novo.md', 'untracked', 5)], truncatedFiles: true },
          }),
        ),
      },
    } as unknown as ProjectHubApi;

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    const artifacts = await screen.findByRole('region', { name: 'Artefatos' });
    expect(
      within(artifacts).getByText('Pelo menos 1 arquivo criado, listado acima'),
    ).toBeInTheDocument();
  });
});
