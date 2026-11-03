import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GitPanelFileDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GitCommitBox } from '../../src/renderer/components/right-panel/GitCommitBox';

/** A caixa de commit: mensagem, botão principal e o motivo de estar desligado. */

let commit: Mock;
let stage: Mock;
let track: Mock;
let onError: Mock;

beforeEach(() => {
  commit = vi.fn(() => Promise.resolve({ ok: true, data: { commit: 'abc' } }));
  stage = vi.fn(() => Promise.resolve({ ok: true, data: undefined }));
  track = vi.fn(<T,>(promise: Promise<T>) => promise);
  onError = vi.fn();
  window.projectHub = { git: { commit, stage } } as unknown as ProjectHubApi;
});

afterEach(() => vi.restoreAllMocks());

const STAGED: GitPanelFileDto = { path: 'a.ts', staged: 'M', unstaged: null };
const STAGED_2: GitPanelFileDto = { path: 'b.ts', staged: 'A', unstaged: null };
const DIRTY: GitPanelFileDto = { path: 'c.ts', staged: null, unstaged: 'M' };

function renderBox(files: GitPanelFileDto[], busy = false) {
  return render(
    <GitCommitBox
      projectId="p1"
      files={files}
      busy={busy}
      track={track as never}
      onError={onError}
    />,
  );
}

describe('GitCommitBox', () => {
  it('com arquivos em stage, o botão é "Commit (N)"', () => {
    renderBox([STAGED, STAGED_2, DIRTY]);

    expect(screen.getByRole('button', { name: 'Commit (2)' })).toBeInTheDocument();
  });

  it('sem mensagem, o botão fica desligado e o motivo aparece em texto', () => {
    renderBox([STAGED]);

    expect(screen.getByRole('button', { name: 'Commit (1)' })).toBeDisabled();
    expect(screen.getByText('Escreva a mensagem do commit')).toBeInTheDocument();
  });

  it('com mensagem só de espaços, continua desligado', async () => {
    const user = userEvent.setup();
    renderBox([STAGED]);

    await user.type(screen.getByRole('textbox', { name: 'Mensagem do commit' }), '   ');

    expect(screen.getByRole('button', { name: 'Commit (1)' })).toBeDisabled();
  });

  it('com mensagem acima de 10 000 caracteres, desliga com o motivo', () => {
    renderBox([STAGED]);

    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem do commit' }), {
      target: { value: 'x'.repeat(10_001) },
    });

    expect(screen.getByRole('button', { name: 'Commit (1)' })).toBeDisabled();
    expect(screen.getByText('A mensagem passa de 10 000 caracteres')).toBeInTheDocument();
  });

  it('com mensagem e arquivos em stage, commita com a mensagem aparada, por track', async () => {
    const user = userEvent.setup();
    renderBox([STAGED]);

    await user.type(screen.getByRole('textbox', { name: 'Mensagem do commit' }), '  feat: algo  ');
    await user.click(screen.getByRole('button', { name: 'Commit (1)' }));

    expect(commit).toHaveBeenCalledWith({ projectId: 'p1', message: 'feat: algo' });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('limpa a mensagem depois de um commit bem-sucedido', async () => {
    const user = userEvent.setup();
    renderBox([STAGED]);
    const box = screen.getByRole('textbox', { name: 'Mensagem do commit' });

    await user.type(box, 'feat: x');
    await user.click(screen.getByRole('button', { name: 'Commit (1)' }));

    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('mantém a mensagem e avisa o erro quando o commit falha', async () => {
    const user = userEvent.setup();
    commit.mockResolvedValue({ ok: false, error: { code: 'GIT_FAILED', message: 'hook recusou' } });
    renderBox([STAGED]);
    const box = screen.getByRole('textbox', { name: 'Mensagem do commit' });

    await user.type(box, 'feat: x');
    await user.click(screen.getByRole('button', { name: 'Commit (1)' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('hook recusou'));
    expect(box).toHaveValue('feat: x');
  });

  it('sem nada em stage e com alterações, o botão é "Colocar tudo em stage"', async () => {
    const user = userEvent.setup();
    renderBox([DIRTY]);

    expect(screen.queryByRole('button', { name: /^Commit/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Colocar tudo em stage' }));

    expect(stage).toHaveBeenCalledWith({ projectId: 'p1', paths: ['c.ts'] });
  });

  it('sem alterações, "Commit (0)" fica desligado com o motivo', () => {
    renderBox([]);

    expect(screen.getByRole('button', { name: 'Commit (0)' })).toBeDisabled();
    expect(screen.getByText('Nada em stage para commitar')).toBeInTheDocument();
  });

  it('ocupado, desliga o botão', async () => {
    const user = userEvent.setup();
    renderBox([STAGED], true);

    await user.type(screen.getByRole('textbox', { name: 'Mensagem do commit' }), 'x');

    expect(screen.getByRole('button', { name: 'Commit (1)' })).toBeDisabled();
  });
});
