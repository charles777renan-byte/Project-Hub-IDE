import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionDiffDto, ProjectHubApi } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { DiffPanel } from '../../src/renderer/components/workspace/DiffPanel';

const CHANGED: MissionDiffDto = {
  files: [
    {
      path: 'a.txt',
      status: 'modified',
      added: 1,
      removed: 1,
      binary: false,
      truncated: false,
      patch: '@@ -1 +1 @@\n-conteudo inicial\n+linha nova\n',
    },
    {
      path: 'b.md',
      status: 'untracked',
      added: 2,
      removed: 0,
      binary: false,
      truncated: false,
      patch: '@@ -0,0 +1,2 @@\n+um\n+dois\n',
    },
  ],
  truncatedFiles: false,
};

/** Instala a API de imitação com a leitura de alterações dada. */
function installDiff(diff: ReturnType<typeof vi.fn>) {
  window.projectHub = { missions: { diff } } as unknown as ProjectHubApi;
  return diff;
}

const okWith = (data: MissionDiffDto) => vi.fn(() => Promise.resolve({ ok: true, data }));

describe('DiffPanel', () => {
  it('sem worktree, não consulta o Git e explica que não há alterações', () => {
    const diff = installDiff(vi.fn());

    render(<DiffPanel missionId="m1" hasWorktree={false} refreshKey={0} />);

    expect(screen.getByText(/ainda não tem worktree/)).toBeInTheDocument();
    expect(diff).not.toHaveBeenCalled();
  });

  it('lista os arquivos com o estado e as contagens, e mostra o diff do primeiro', async () => {
    const diff = installDiff(okWith(CHANGED));

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    const list = await screen.findByRole('list', { name: 'Arquivos alterados' });
    expect(diff).toHaveBeenCalledWith('m1');
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(within(list).getByRole('button', { name: /a\.txt/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(list).getByRole('button', { name: /b\.md/ })).toHaveTextContent('Novo');
    const patch = screen.getByLabelText('Diff de a.txt');
    expect(patch).toHaveTextContent('+linha nova');
    expect(patch).toHaveTextContent('-conteudo inicial');
  });

  it('escolher outro arquivo mostra o diff dele', async () => {
    installDiff(okWith(CHANGED));
    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);
    await screen.findByRole('list', { name: 'Arquivos alterados' });

    await userEvent.click(screen.getByRole('button', { name: /b\.md/ }));

    expect(screen.getByLabelText('Diff de b.md')).toHaveTextContent('+dois');
    expect(screen.getByRole('button', { name: /b\.md/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('binário e arquivo sem prévia dizem por que não há trechos', async () => {
    installDiff(
      okWith({
        files: [
          {
            path: 'imagem.png',
            status: 'added',
            added: 0,
            removed: 0,
            binary: true,
            truncated: false,
          },
          {
            path: 'atalho',
            status: 'untracked',
            added: 0,
            removed: 0,
            binary: false,
            truncated: false,
          },
        ],
        truncatedFiles: false,
      }),
    );
    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);
    await screen.findByRole('list', { name: 'Arquivos alterados' });

    expect(screen.getByText('Arquivo binário: sem prévia do conteúdo.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /atalho/ }));

    expect(screen.getByText('Sem prévia para este arquivo.')).toBeInTheDocument();
  });

  it('avisa quando a lista e um arquivo foram cortados pelo limite', async () => {
    installDiff(
      okWith({
        files: [
          {
            path: 'grande.txt',
            status: 'untracked',
            added: 40,
            removed: 0,
            binary: false,
            truncated: true,
            patch: '@@ -0,0 +1,40 @@\n+linha 0\n',
          },
        ],
        truncatedFiles: true,
      }),
    );

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByText(/Mostrando os primeiros 1 arquivos/)).toBeInTheDocument();
    expect(screen.getByText('Arquivo grande: mostrando só o começo.')).toBeInTheDocument();
  });

  it('sem arquivos alterados, diz que a missão ainda não alterou nada', async () => {
    installDiff(okWith({ files: [], truncatedFiles: false }));

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByText('A missão ainda não alterou arquivos.')).toBeInTheDocument();
  });

  it('caminho e conteúdo com marcação saem como texto, nunca como elementos', async () => {
    installDiff(
      okWith({
        files: [
          {
            path: '<b>x</b>.md',
            status: 'untracked',
            added: 1,
            removed: 0,
            binary: false,
            truncated: false,
            patch: '@@ -0,0 +1 @@\n+<img src=x onerror="alerta()">\n',
          },
        ],
        truncatedFiles: false,
      }),
    );

    const { container } = render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);
    await screen.findByRole('list', { name: 'Arquivos alterados' });

    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<b>x</b>.md')).toBeInTheDocument();
    expect(screen.getByLabelText('Diff de <b>x</b>.md')).toHaveTextContent('<img src=x');
  });

  it('falha de leitura mostra a mensagem segura da API como alerta', async () => {
    installDiff(
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'PROJECT_PATH_UNAVAILABLE',
            message: 'A pasta não está acessível.',
            retryable: false,
          },
        }),
      ),
    );

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('A pasta não está acessível.');
  });

  it('uma chamada que lança cai no erro genérico, sem derrubar o painel', async () => {
    installDiff(
      vi.fn(() => {
        throw new Error('ponte fora do ar');
      }),
    );

    render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível ler as alterações da missão. Tente de novo.',
    );
  });

  it('um novo refreshKey recarrega a lista', async () => {
    const diff = installDiff(okWith(CHANGED));
    const { rerender } = render(<DiffPanel missionId="m1" hasWorktree refreshKey={0} />);
    await screen.findByRole('list', { name: 'Arquivos alterados' });

    rerender(<DiffPanel missionId="m1" hasWorktree refreshKey={1} />);

    await waitFor(() => expect(diff).toHaveBeenCalledTimes(2));
  });
});
