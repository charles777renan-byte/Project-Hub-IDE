import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, GitPanelFileDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GitChangesList } from '../../src/renderer/components/right-panel/GitChangesList';

/** A lista de alterações: stage, desfazer com confirmação e "Commitado na branch". */

const OK = { ok: true as const, data: undefined } as AppResult<void>;
let stage: Mock;
let unstage: Mock;
let discard: Mock;
let branchChanges: Mock;
let track: Mock;
let onError: Mock;

beforeEach(() => {
  stage = vi.fn(() => Promise.resolve(OK));
  unstage = vi.fn(() => Promise.resolve(OK));
  discard = vi.fn(() => Promise.resolve(OK));
  branchChanges = vi.fn(() =>
    Promise.resolve({ ok: true, data: { baseRef: 'origin/main', mergeBase: 'abc', files: [] } }),
  );
  track = vi.fn(<T,>(promise: Promise<T>) => promise);
  onError = vi.fn();
  window.projectHub = {
    git: { stage, unstage, discard, branchChanges },
  } as unknown as ProjectHubApi;
});

afterEach(() => vi.restoreAllMocks());

function renderList(files: GitPanelFileDto[], busy = false) {
  return render(
    <GitChangesList
      projectId="p1"
      files={files}
      busy={busy}
      track={track as never}
      onError={onError}
    />,
  );
}

const MODIFIED: GitPanelFileDto = { path: 'src/a.ts', staged: null, unstaged: 'M' };
const NEW: GitPanelFileDto = { path: 'novo.ts', staged: null, unstaged: 'U' };
const STAGED: GitPanelFileDto = { path: 'src/b.ts', staged: 'A', unstaged: null };

describe('GitChangesList: stage', () => {
  it('põe um arquivo em stage com o caminho e passa por track', async () => {
    const user = userEvent.setup();
    renderList([MODIFIED]);

    await user.click(screen.getByRole('button', { name: 'Colocar em stage src/a.ts' }));

    expect(stage).toHaveBeenCalledWith({ projectId: 'p1', paths: ['src/a.ts'] });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('"Colocar tudo em stage" manda todos os caminhos fora do stage', async () => {
    const user = userEvent.setup();
    renderList([MODIFIED, NEW, STAGED]);

    await user.click(screen.getByRole('button', { name: 'Colocar tudo em stage' }));

    expect(stage).toHaveBeenCalledWith({ projectId: 'p1', paths: ['src/a.ts', 'novo.ts'] });
  });

  it('tira um arquivo do stage', async () => {
    const user = userEvent.setup();
    renderList([STAGED]);

    await user.click(screen.getByRole('button', { name: 'Tirar do stage src/b.ts' }));

    expect(unstage).toHaveBeenCalledWith({ projectId: 'p1', paths: ['src/b.ts'] });
  });

  it('mostra a letra de estado como texto', () => {
    renderList([MODIFIED, NEW, STAGED]);

    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('uma falha de escrita vai para onError com a mensagem', async () => {
    const user = userEvent.setup();
    stage.mockResolvedValue({ ok: false, error: { code: 'GIT_FAILED', message: 'deu ruim' } });
    renderList([MODIFIED]);

    await user.click(screen.getByRole('button', { name: 'Colocar em stage src/a.ts' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('deu ruim'));
  });

  it('ocupado, desliga as ações', () => {
    renderList([MODIFIED], true);

    expect(screen.getByRole('button', { name: 'Colocar em stage src/a.ts' })).toBeDisabled();
  });
});

describe('GitChangesList: desfazer', () => {
  it('abre a confirmação, lista o arquivo e só chama a API ao confirmar', async () => {
    const user = userEvent.setup();
    renderList([MODIFIED]);

    await user.click(screen.getByRole('button', { name: 'Desfazer src/a.ts' }));

    expect(discard).not.toHaveBeenCalled();
    const group = screen.getByRole('group');
    expect(group).toHaveTextContent('src/a.ts');
    expect(group).toHaveTextContent('não dá para voltar');

    await user.click(screen.getByRole('button', { name: 'Desfazer alterações' }));

    expect(discard).toHaveBeenCalledWith({ projectId: 'p1', paths: ['src/a.ts'] });
  });

  it('"Voltar" não chama a API', async () => {
    const user = userEvent.setup();
    renderList([MODIFIED]);

    await user.click(screen.getByRole('button', { name: 'Desfazer src/a.ts' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(discard).not.toHaveBeenCalled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('não aparece para arquivo novo ou em conflito (unstaged U)', () => {
    renderList([NEW]);

    expect(screen.queryByRole('button', { name: /Desfazer/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Colocar em stage novo.ts' })).toBeInTheDocument();
  });

  it('"Desfazer tudo" lista só os arquivos que podem ser desfeitos', async () => {
    const user = userEvent.setup();
    const deleted: GitPanelFileDto = { path: 'velho.ts', staged: null, unstaged: 'D' };
    renderList([MODIFIED, NEW, deleted]);

    await user.click(screen.getByRole('button', { name: 'Desfazer tudo' }));

    const group = screen.getByRole('group');
    expect(group).toHaveTextContent('src/a.ts');
    expect(group).toHaveTextContent('velho.ts');
    expect(group).not.toHaveTextContent('novo.ts');
    await user.click(screen.getByRole('button', { name: 'Desfazer alterações' }));
    expect(discard).toHaveBeenCalledWith({ projectId: 'p1', paths: ['src/a.ts', 'velho.ts'] });
  });
});

describe('GitChangesList: Commitado na branch', () => {
  it('mostra os arquivos da branch com +N −M', async () => {
    branchChanges.mockResolvedValue({
      ok: true,
      data: {
        baseRef: 'origin/main',
        mergeBase: 'abc',
        files: [
          { path: 'x.ts', status: 'M', added: 3, removed: 1 },
          { path: 'img.png', status: 'A', added: null, removed: null },
        ],
      },
    });
    renderList([]);

    expect(await screen.findByText('x.ts')).toBeInTheDocument();
    expect(screen.getByText('+3 −1')).toBeInTheDocument();
    expect(screen.getByText('binário')).toBeInTheDocument();
    expect(branchChanges).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('com mais de 10 arquivos, mostra 10 e "Ver tudo" mostra o resto', async () => {
    const user = userEvent.setup();
    const files = Array.from({ length: 12 }, (_, i) => ({
      path: `f${i}.ts`,
      status: 'M' as const,
      added: 1,
      removed: 0,
    }));
    branchChanges.mockResolvedValue({
      ok: true,
      data: { baseRef: 'origin/main', mergeBase: 'abc', files },
    });
    renderList([]);

    await screen.findByText('f0.ts');
    expect(screen.queryByText('f11.ts')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver tudo (12)' }));
    expect(screen.getByText('f11.ts')).toBeInTheDocument();
  });
});

describe('GitChangesList: abrir o arquivo', () => {
  function renderOpen(files: GitPanelFileDto[], onOpenFile: Mock) {
    return render(
      <GitChangesList
        projectId="p1"
        files={files}
        busy={false}
        track={track as never}
        onError={onError}
        onOpenFile={onOpenFile}
      />,
    );
  }

  it('o clique no nome de um arquivo em "Alterações" abre a aba no modo Alterações', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    renderOpen([MODIFIED], onOpenFile);

    await user.click(screen.getByRole('button', { name: 'Ver alterações de src/a.ts' }));

    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts', 'alteracoes');
    expect(stage).not.toHaveBeenCalled();
  });

  it('vale também para "Em stage" e para um arquivo removido', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const removed: GitPanelFileDto = { path: 'velho.ts', staged: null, unstaged: 'D' };
    renderOpen([STAGED, removed], onOpenFile);

    await user.click(screen.getByRole('button', { name: 'Ver alterações de src/b.ts' }));
    await user.click(screen.getByRole('button', { name: 'Ver alterações de velho.ts' }));

    expect(onOpenFile).toHaveBeenNthCalledWith(1, 'src/b.ts', 'alteracoes');
    expect(onOpenFile).toHaveBeenNthCalledWith(2, 'velho.ts', 'alteracoes');
  });

  it('o clique em "Commitado na branch" também abre no modo Alterações', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    branchChanges.mockResolvedValue({
      ok: true,
      data: {
        baseRef: 'origin/main',
        mergeBase: 'abc',
        files: [{ path: 'x.ts', status: 'M', added: 3, removed: 1 }],
      },
    });
    renderOpen([], onOpenFile);

    await user.click(await screen.findByRole('button', { name: 'Ver alterações de x.ts' }));

    expect(onOpenFile).toHaveBeenCalledWith('x.ts', 'alteracoes');
  });
});
