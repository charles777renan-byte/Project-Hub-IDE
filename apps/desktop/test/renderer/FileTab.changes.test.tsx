import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  FileContentDto,
  FileVersionDto,
  GitFileDiffDto,
  GitStatusDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileEditorTab } from '../../src/renderer/components/project/FileEditorTab';
import {
  openFile,
  resetOpenFilesForTests,
  updateText,
  useOpenFiles,
} from '../../src/renderer/open-files';
import { stubLayoutForCodeMirror, viewOf } from './codemirror-jsdom';

/** A aba de arquivo com Git: o par Arquivo | Alterações e o diff contra o HEAD, só leitura. */

beforeAll(stubLayoutForCodeMirror);

const VERSION: FileVersionDto = { size: 5, mtimeMs: 10, hash: 'a'.repeat(64) };
const DISK_VERSION: FileVersionDto = { size: 9, mtimeMs: 20, hash: 'b'.repeat(64) };

function content(overrides: Partial<FileContentDto> = {}): FileContentDto {
  return { text: 'texto', eol: 'lf', bom: false, version: VERSION, ...overrides };
}

function status(overrides: Partial<GitStatusDto> = {}): GitStatusDto {
  return {
    branch: 'feat/x',
    upstream: null,
    ahead: null,
    behind: null,
    baseRef: 'origin/main',
    linesAdded: null,
    linesRemoved: null,
    files: [],
    ...overrides,
  };
}

function diff(overrides: Partial<GitFileDiffDto> = {}): GitFileDiffDto {
  return {
    path: 'src/a.ts',
    baseRef: 'HEAD',
    patch: '@@ -1 +1 @@\n-velho\n+novo\n',
    binary: false,
    truncated: false,
    ...overrides,
  };
}

type Api = {
  files: {
    read: ReturnType<typeof vi.fn<ProjectHubApi['files']['read']>>;
    write: ReturnType<typeof vi.fn<ProjectHubApi['files']['write']>>;
    stat: ReturnType<typeof vi.fn<ProjectHubApi['files']['stat']>>;
  };
  git: {
    status: ReturnType<typeof vi.fn<ProjectHubApi['git']['status']>>;
    diff: ReturnType<typeof vi.fn<ProjectHubApi['git']['diff']>>;
  };
};
let api: Api;

function ok<T>(data: T): Promise<AppResult<T>> {
  return Promise.resolve({ ok: true, data });
}

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  api = {
    files: {
      read: vi.fn<ProjectHubApi['files']['read']>(() => ok(content())),
      write: vi.fn<ProjectHubApi['files']['write']>(() => ok(DISK_VERSION)),
      stat: vi.fn<ProjectHubApi['files']['stat']>(() =>
        ok({ exists: true as const, version: VERSION }),
      ),
    },
    git: {
      status: vi.fn<ProjectHubApi['git']['status']>(() => ok(status())),
      diff: vi.fn<ProjectHubApi['git']['diff']>(() => ok(diff())),
    },
  };
  window.projectHub = api as unknown as typeof window.projectHub;
});

function Harness({ path = 'src/a.ts' }: { path?: string }) {
  const { files } = useOpenFiles('p1');
  const file = files.find((item) => item.path === path);
  return (
    <>
      <FileEditorTab projectId="p1" path={path} />
      <output data-testid="estado">
        {JSON.stringify({ dirty: file?.dirty, mode: file?.mode, notice: file?.notice })}
      </output>
    </>
  );
}

function state(): { dirty: boolean; mode: string | undefined; notice: string | undefined } {
  return JSON.parse(screen.getByTestId('estado').textContent ?? '{}') as ReturnType<typeof state>;
}

/** Abre o arquivo no store, monta a aba e espera o editor aparecer. */
async function mountEditor(options: { mode?: 'arquivo' | 'alteracoes' } = {}) {
  const view = render(<Harness />);
  act(() => openFile('p1', 'src/a.ts', options));
  await waitFor(
    () =>
      expect(
        view.container
          .querySelector('.code-editor__host')
          ?.shadowRoot?.querySelector('.cm-content'),
      ).toBeTruthy(),
    { timeout: 10_000 },
  );
  return view;
}

const fileButton = () => screen.getByRole('button', { name: 'Arquivo' });
const changesButton = () => screen.getByRole('button', { name: 'Alterações' });

function ctrlS(target: Element): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 's',
    code: 'KeyS',
    ctrlKey: true,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe('aba de arquivo: Arquivo | Alterações', () => {
  it('o par de botões troca o modo com Tab e setas, com aria-pressed', async () => {
    const user = userEvent.setup();
    await mountEditor();
    await screen.findByRole('button', { name: 'Alterações' });
    expect(fileButton()).toHaveAttribute('aria-pressed', 'true');
    expect(changesButton()).toHaveAttribute('aria-pressed', 'false');

    // Os dois são alcançáveis por Tab, na ordem.
    fileButton().focus();
    await user.tab();
    expect(changesButton()).toHaveFocus();
    await user.tab({ shift: true });
    expect(fileButton()).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(changesButton()).toHaveAttribute('aria-pressed', 'true');
    expect(fileButton()).toHaveAttribute('aria-pressed', 'false');
    expect(changesButton()).toHaveFocus();
    expect(await screen.findByLabelText('Diff de src/a.ts')).toBeInTheDocument();
    expect(state().mode).toBe('alteracoes');

    await user.keyboard('{ArrowLeft}');
    expect(fileButton()).toHaveAttribute('aria-pressed', 'true');
    expect(fileButton()).toHaveFocus();
    expect(state().mode).toBe('arquivo');
  });

  it('projeto sem commit: Alterações segue ligado e o erro do caso de uso aparece em role=alert', async () => {
    api.git.diff.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Não há commit para comparar: o projeto ainda não tem nenhum commit.',
          retryable: false,
        },
      } as AppResult<GitFileDiffDto>),
    );
    const user = userEvent.setup();
    await mountEditor();
    await screen.findByRole('button', { name: 'Alterações' });

    expect(changesButton()).not.toHaveAttribute('aria-disabled');
    await user.click(changesButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não há commit para comparar: o projeto ainda não tem nenhum commit.',
    );
    expect(api.git.diff).toHaveBeenCalledWith({ projectId: 'p1', path: 'src/a.ts' });
    expect(changesButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('o diff é contra o HEAD: sem base no status, Alterações abre e chama git.diff', async () => {
    api.git.status.mockImplementation(() => ok(status({ baseRef: null })));
    await mountEditor({ mode: 'alteracoes' });

    expect(await screen.findByLabelText('Diff de src/a.ts')).toBeInTheDocument();
    expect(api.git.diff).toHaveBeenCalledWith({ projectId: 'p1', path: 'src/a.ts' });
    expect(changesButton()).not.toHaveAttribute('aria-disabled');
    expect(changesButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['o projeto não é um repositório', { code: 'VALIDATION_FAILED' }],
    ['a pasta está indisponível', { code: 'PROJECT_PATH_UNAVAILABLE' }],
    ['a leitura falhou', { code: 'GIT_LOCKED' }],
  ])('sem Git (%s), a aba é só o editor', async (_name, error) => {
    api.git.status.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: { ...error, message: 'sem git', retryable: false },
      } as AppResult<GitStatusDto>),
    );
    await mountEditor();
    await waitFor(() => expect(api.git.status).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: 'Alterações' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arquivo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('lê o diff do arquivo e mostra adições e remoções com sinal, como texto', async () => {
    const user = userEvent.setup();
    await mountEditor();
    await user.click(await screen.findByRole('button', { name: 'Alterações' }));

    const patch = await screen.findByLabelText('Diff de src/a.ts');
    expect(api.git.diff).toHaveBeenCalledWith({ projectId: 'p1', path: 'src/a.ts' });
    expect(patch).toHaveTextContent('@@ -1 +1 @@');
    expect(screen.getByText('-velho')).toHaveClass('diff__line--removed');
    expect(screen.getByText('+novo')).toHaveClass('diff__line--added');
    expect(screen.getByText('@@ -1 +1 @@')).toHaveClass('diff__line--hunk');
  });

  it('arquivo binário diz que não há diff de texto', async () => {
    api.git.diff.mockImplementation(() => ok(diff({ binary: true, patch: '' })));
    await mountEditor({ mode: 'alteracoes' });

    expect(await screen.findByText('Arquivo binário: não há diff de texto.')).toBeInTheDocument();
  });

  it('patch vazio diz que não há alterações em relação ao último commit', async () => {
    api.git.diff.mockImplementation(() => ok(diff({ patch: '' })));
    await mountEditor({ mode: 'alteracoes' });

    expect(
      await screen.findByText('Este arquivo não tem alterações em relação ao último commit.'),
    ).toBeInTheDocument();
  });

  it('diff truncado mostra o começo e o aviso em texto', async () => {
    api.git.diff.mockImplementation(() => ok(diff({ truncated: true })));
    await mountEditor({ mode: 'alteracoes' });

    expect(
      await screen.findByText('O diff passou do limite: mostrado só o começo.'),
    ).toBeInTheDocument();
    expect(screen.getByText('+novo')).toBeInTheDocument();
  });

  it('erro do IPC aparece em role=alert com a mensagem do processo principal', async () => {
    api.git.diff.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'GIT_LOCKED', message: 'O git travou.', retryable: false },
      } as AppResult<GitFileDiffDto>),
    );
    await mountEditor({ mode: 'alteracoes' });

    expect(await screen.findByRole('alert')).toHaveTextContent('O git travou.');
  });

  it('o patch entra como texto: marcação no diff não vira elemento', async () => {
    api.git.diff.mockImplementation(() =>
      ok(diff({ patch: '@@ -1 +1 @@\n+<img src=x onerror=alert(1)>\n' })),
    );
    const { container } = await mountEditor({ mode: 'alteracoes' });

    expect(await screen.findByText('+<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('trocar de modo mantém a edição não salva', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    act(() => updateText('p1', 'src/a.ts', 'texto editado'));
    await user.click(await screen.findByRole('button', { name: 'Alterações' }));
    await screen.findByLabelText('Diff de src/a.ts');
    expect(state().dirty).toBe(true);

    await user.click(fileButton());

    expect(viewOf(container).state.doc.toString()).toBe('texto editado');
    expect(state().dirty).toBe(true);
  });

  it('Ctrl+S em modo Alterações não grava', async () => {
    const user = userEvent.setup();
    await mountEditor();
    act(() => updateText('p1', 'src/a.ts', 'texto editado'));
    await user.click(await screen.findByRole('button', { name: 'Alterações' }));
    const patch = await screen.findByLabelText('Diff de src/a.ts');

    const prevented = ctrlS(patch);

    expect(prevented).toBe(true);
    expect(api.files.write).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(state().dirty).toBe(true);
  });

  it('restaurar com edição não salva: Salvar mostra a faixa e não grava por cima do disco', async () => {
    // O disco como um Desfazer o deixaria: outro conteúdo, outra versão. A gravação confere a versão esperada.
    let disk = content();
    api.files.stat.mockImplementation(() => ok({ exists: true as const, version: disk.version }));
    api.files.read.mockImplementation(() => ok(disk));
    api.files.write.mockImplementation((input) => {
      if (input.expected?.hash !== disk.version.hash) {
        return Promise.resolve({
          ok: false,
          error: {
            code: 'FILE_CHANGED_ON_DISK',
            message: 'O arquivo mudou no disco depois de aberto.',
            retryable: false,
          },
        } as AppResult<FileVersionDto>);
      }
      disk = content({ text: input.text, version: DISK_VERSION });
      return ok(DISK_VERSION);
    });
    const user = userEvent.setup();
    await mountEditor();
    act(() => updateText('p1', 'src/a.ts', 'texto editado'));
    disk = content({
      text: 'texto restaurado',
      version: { ...DISK_VERSION, hash: 'c'.repeat(64) },
    });

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('O arquivo mudou no disco enquanto você editava')).toBeVisible();
    expect(disk.text).toBe('texto restaurado');
    expect(state().dirty).toBe(true);
    expect(state().notice).toBe('changed-on-disk');
  });

  it('arquivo removido (D): abre em Alterações com o diff; em Arquivo mostra o erro de leitura, sem editor vazio', async () => {
    api.files.read.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'FILE_NOT_FOUND', message: 'O arquivo não existe.', retryable: false },
      } as AppResult<FileContentDto>),
    );
    const user = userEvent.setup();
    render(<Harness />);
    act(() => openFile('p1', 'src/a.ts', { mode: 'alteracoes' }));

    expect(await screen.findByLabelText('Diff de src/a.ts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Arquivo' }));

    expect(screen.getByText('O arquivo não existe.')).toBeVisible();
    expect(screen.queryByLabelText('Diff de src/a.ts')).not.toBeInTheDocument();
  });
});
