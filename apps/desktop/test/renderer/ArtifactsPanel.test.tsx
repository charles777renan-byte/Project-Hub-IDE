import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('lista só os arquivos novos, com o caminho relativo e as linhas adicionadas', () => {
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

    const list = screen.getByRole('list', { name: 'Arquivos criados' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('docs/novo.md');
    expect(items[0]).toHaveTextContent('+2 linhas');
    expect(items[1]).toHaveTextContent('src/b.ts');
    expect(items[1]).toHaveTextContent('+1 linha');
    expect(items[1]).not.toHaveTextContent('+1 linhas');
  });

  it('sem arquivos novos, diz que a missão ainda não criou arquivos', () => {
    render(<ArtifactsPanel files={[file('a.txt', 'modified', 1)]} />);

    expect(screen.getByText('A missão ainda não criou arquivos.')).toBeInTheDocument();
  });

  it('mostra o caminho com acento correto', () => {
    render(<ArtifactsPanel files={[file('relatórios/avaliação-ção.md', 'untracked', 4)]} />);

    expect(screen.getByText('relatórios/avaliação-ção.md')).toBeInTheDocument();
  });
});

describe('DiffPanel com a aba Artefatos', () => {
  const DIFF: MissionDiffDto = {
    files: [file('a.txt', 'modified', 1), file('novo.md', 'untracked', 5)],
    truncatedFiles: false,
  };

  it('abre em Alterações e troca para Artefatos sem nova consulta', async () => {
    const diff = vi.fn(() => Promise.resolve({ ok: true, data: DIFF }));
    window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
    const user = userEvent.setup();

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    expect(screen.getByRole('tab', { name: 'Alterações' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await screen.findByRole('list', { name: 'Arquivos alterados' });

    await user.click(screen.getByRole('tab', { name: 'Artefatos' }));

    const list = screen.getByRole('list', { name: 'Arquivos criados' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('novo.md');
    expect(diff).toHaveBeenCalledTimes(1);
  });

  it('sem worktree, a aba Artefatos diz que não há arquivos criados', async () => {
    window.projectHub = { missions: { diff: vi.fn() } } as unknown as ProjectHubApi;
    const user = userEvent.setup();

    render(<DiffPanel missionId="m1" hasWorktree={false} refreshKey={0} />);
    await user.click(screen.getByRole('tab', { name: 'Artefatos' }));

    expect(screen.getByText('A missão ainda não criou arquivos.')).toBeInTheDocument();
  });
});
