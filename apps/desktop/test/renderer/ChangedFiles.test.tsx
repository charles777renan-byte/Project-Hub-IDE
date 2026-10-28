import { render, screen, waitFor, within } from '@testing-library/react';
import type { MissionDiffDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangedFiles } from '../../src/renderer/components/mission/ChangedFiles';

function fileOf(path: string, added: number, removed: number): MissionDiffDto['files'][number] {
  return { path, status: 'modified', added, removed, binary: false, truncated: false };
}

function installDiff(result: unknown) {
  const diff = vi.fn(() => Promise.resolve(result));
  window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
  return diff;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ChangedFiles', () => {
  it('lista cada arquivo do worktree com o caminho e as linhas a mais e a menos', async () => {
    installDiff({
      ok: true,
      data: { files: [fileOf('src/a.ts', 3, 1), fileOf('src/b.ts', 0, 5)], truncatedFiles: false },
    });
    render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);

    const section = screen.getByRole('region', { name: 'Arquivos alterados' });
    const items = await within(section).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['src/a.ts +3 −1', 'src/b.ts +0 −5']);
  });

  it('o caminho e as contagens ficam em elementos próprios, e o caminho entra como texto', async () => {
    installDiff({
      ok: true,
      data: { files: [fileOf('<img src=x onerror=alert(1)>.ts', 3, 1)], truncatedFiles: false },
    });
    const { container } = render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByText('<img src=x onerror=alert(1)>.ts')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.diff__added')).toHaveTextContent('+3');
    expect(container.querySelector('.diff__removed')).toHaveTextContent('−1');
  });

  it('sem worktree, diz "Nenhuma alteração pendente." e não chama a API', () => {
    const diff = installDiff({ ok: true, data: { files: [], truncatedFiles: false } });
    render(<ChangedFiles missionId="m1" hasWorktree={false} refreshKey={0} />);

    expect(screen.getByText('Nenhuma alteração pendente.')).toBeInTheDocument();
    expect(diff).not.toHaveBeenCalled();
  });

  it('com worktree e sem arquivos, diz "Nenhuma alteração pendente."', async () => {
    installDiff({ ok: true, data: { files: [], truncatedFiles: false } });
    render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByText('Nenhuma alteração pendente.')).toBeInTheDocument();
  });

  it('enquanto lê, não afirma que não há alterações', () => {
    window.projectHub = {
      missions: { diff: vi.fn(() => new Promise(() => {})) },
    } as unknown as ProjectHubApi;
    render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando alterações…');
    expect(screen.queryByText('Nenhuma alteração pendente.')).toBeNull();
  });

  it('lê as alterações da missão certa e de novo quando a chave muda', async () => {
    const diff = installDiff({ ok: true, data: { files: [], truncatedFiles: false } });
    const { rerender } = render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);
    await waitFor(() => expect(diff).toHaveBeenCalledTimes(1));
    expect(diff).toHaveBeenCalledWith('m1');

    rerender(<ChangedFiles missionId="m1" hasWorktree refreshKey={4} />);
    await waitFor(() => expect(diff).toHaveBeenCalledTimes(2));
  });

  it('falha de leitura aparece como alerta, com a mensagem da API', async () => {
    installDiff({ ok: false, error: { code: 'INTERNAL', message: 'O Git não respondeu.' } });
    render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('O Git não respondeu.');
    expect(screen.queryByText('Nenhuma alteração pendente.')).toBeNull();
  });

  it('uma chamada que lança vira o aviso genérico', async () => {
    window.projectHub = {
      missions: { diff: vi.fn(() => Promise.reject(new Error('x'))) },
    } as unknown as ProjectHubApi;
    render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível ler as alterações da missão. Tente de novo.',
    );
  });

  it('lista cortada avisa que há mais arquivos no worktree', async () => {
    installDiff({
      ok: true,
      data: { files: [fileOf('src/a.ts', 1, 0)], truncatedFiles: true },
    });
    render(<ChangedFiles missionId="m1" hasWorktree refreshKey={0} />);

    expect(
      await screen.findByText('Mostrando os primeiros 1 arquivos. Há mais alterações no worktree.'),
    ).toBeInTheDocument();
  });
});
