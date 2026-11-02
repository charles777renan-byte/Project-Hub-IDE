import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FileContentDto, FileVersionDto, ProjectHubApi } from '@project-hub/contracts';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileEditorTab } from '../../src/renderer/components/project/FileEditorTab';
import {
  openFile,
  resetOpenFilesForTests,
  saveAllDirty,
  updateText,
  useOpenFiles,
} from '../../src/renderer/open-files';
import { shadowOf, stubLayoutForCodeMirror, viewOf } from './codemirror-jsdom';

/** A aba de um arquivo aberto: a barra do caminho, o botão Salvar e o editor, ou o aviso de que não abre aqui. */

beforeAll(stubLayoutForCodeMirror);

const VERSION: FileVersionDto = { size: 5, mtimeMs: 10, hash: 'a'.repeat(64) };
const NEXT_VERSION: FileVersionDto = { size: 9, mtimeMs: 20, hash: 'b'.repeat(64) };

function content(overrides: Partial<FileContentDto> = {}): FileContentDto {
  return { text: 'texto', eol: 'lf', bom: false, version: VERSION, ...overrides };
}

type Api = {
  read: ReturnType<typeof vi.fn<ProjectHubApi['files']['read']>>;
  write: ReturnType<typeof vi.fn<ProjectHubApi['files']['write']>>;
  openDefault: ReturnType<typeof vi.fn<ProjectHubApi['files']['openDefault']>>;
};
let api: Api;

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  api = {
    read: vi.fn<ProjectHubApi['files']['read']>(() =>
      Promise.resolve({ ok: true, data: content() }),
    ),
    write: vi.fn<ProjectHubApi['files']['write']>(() =>
      Promise.resolve({ ok: true, data: NEXT_VERSION }),
    ),
    openDefault: vi.fn<ProjectHubApi['files']['openDefault']>(() =>
      Promise.resolve({ ok: true, data: undefined }),
    ),
  };
  window.projectHub = { files: api } as unknown as typeof window.projectHub;
});

/** A aba mais o estado do store, para conferir `dirty` e `saved` de fora. */
function Harness({ path = 'src/a.ts' }: { path?: string }) {
  const { files } = useOpenFiles('p1');
  const file = files.find((item) => item.path === path);
  return (
    <>
      <FileEditorTab projectId="p1" path={path} />
      <output data-testid="estado">
        {JSON.stringify({ dirty: file?.dirty, saved: file?.saved?.text })}
      </output>
    </>
  );
}

function state(): { dirty: boolean; saved: string | undefined } {
  return JSON.parse(screen.getByTestId('estado').textContent ?? '{}') as {
    dirty: boolean;
    saved: string | undefined;
  };
}

/** Abre o arquivo no store, monta a aba e espera o editor aparecer. */
async function mountEditor(path = 'src/a.ts') {
  const view = render(<Harness path={path} />);
  act(() => openFile('p1', path));
  await waitFor(
    () =>
      expect(
        view.container
          .querySelector('.code-editor__host')
          ?.shadowRoot?.querySelector('.cm-content'),
      ).toBeTruthy(),
    // O primeiro import do CodeMirror, a frio, passa de 1 s (o padrão do waitFor).
    { timeout: 10_000 },
  );
  return view;
}

/** A pessoa digita no fim do texto. */
function type(container: HTMLElement, extra: string) {
  act(() => {
    const view = viewOf(container);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: extra },
      userEvent: 'input.type',
    });
  });
}

/** Ctrl+S dentro do editor; devolve se o navegador foi impedido de agir (`preventDefault`). */
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

const saveButton = () => screen.getByRole('button', { name: 'Salvar' });

describe('FileEditorTab', () => {
  it('mostra o caminho do arquivo e o texto lido no editor', async () => {
    const { container } = await mountEditor('src/pasta/a.ts');

    expect(screen.getByText(/src\//)).toBeInTheDocument();
    expect(container.querySelector('.file-editor__path')).toHaveTextContent('src/pasta/a.ts');
    expect(viewOf(container).state.doc.toString()).toBe('texto');
    expect(shadowOf(container).querySelector('.cm-content')).toHaveAttribute(
      'aria-label',
      'Editor de a.ts',
    );
  });

  it('enquanto o arquivo é lido, avisa que está carregando', () => {
    api.read.mockReturnValue(new Promise(() => undefined));
    render(<Harness />);
    act(() => openFile('p1', 'src/a.ts'));

    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
  });

  it('falha na leitura mostra a mensagem do processo principal', async () => {
    api.read.mockResolvedValue({
      ok: false,
      error: {
        code: 'FILE_NOT_FOUND',
        message: 'O arquivo não existe mais no projeto.',
        retryable: false,
      },
    });
    render(<Harness />);
    act(() => openFile('p1', 'src/a.ts'));

    expect(await screen.findByText('O arquivo não existe mais no projeto.')).toBeInTheDocument();
  });

  it('o botão Salvar fica desligado enquanto não há alteração e liga ao editar', async () => {
    const { container } = await mountEditor();
    expect(saveButton()).toBeDisabled();

    type(container, '!');

    expect(saveButton()).toBeEnabled();
    expect(state().dirty).toBe(true);
  });

  it('Ctrl+S grava com a versão lida, o fim de linha e o BOM originais, e zera o dirty', async () => {
    api.read.mockResolvedValue({
      ok: true,
      data: content({ text: 'a\nb', eol: 'crlf', bom: true }),
    });
    const { container } = await mountEditor();
    type(container, 'c');

    const prevented = ctrlS(shadowOf(container).querySelector('.cm-content')!);

    expect(prevented).toBe(true);
    await waitFor(() => expect(state().dirty).toBe(false));
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(api.write).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'src/a.ts',
      text: 'a\nbc',
      eol: 'crlf',
      bom: true,
      expected: VERSION,
    });
    expect(state().saved).toBe('a\nbc');
    expect(saveButton()).toBeDisabled();
  });

  it('o botão Salvar grava igual a Ctrl+S, e a gravação seguinte espera a versão nova', async () => {
    const { container } = await mountEditor();
    type(container, '1');
    await userEvent.click(saveButton());
    await waitFor(() => expect(state().dirty).toBe(false));

    type(container, '2');
    await userEvent.click(saveButton());
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));

    expect(api.write.mock.calls[0]?.[0].expected).toEqual(VERSION);
    expect(api.write.mock.calls[1]?.[0]).toMatchObject({ text: 'texto12', expected: NEXT_VERSION });
  });

  it('Ctrl+S sem alteração não grava, mas impede o navegador de agir', async () => {
    const { container } = await mountEditor();

    const prevented = ctrlS(shadowOf(container).querySelector('.cm-content')!);

    expect(prevented).toBe(true);
    expect(api.write).not.toHaveBeenCalled();
  });

  it('Ctrl+S fora da aba não grava nem é interceptado', async () => {
    const { container } = await mountEditor();
    type(container, '!');

    const prevented = ctrlS(document.body);

    expect(prevented).toBe(false);
    expect(api.write).not.toHaveBeenCalled();
  });

  it('Ctrl+S repetido enquanto grava não grava duas vezes', async () => {
    let finish: (version: FileVersionDto) => void = () => undefined;
    api.write.mockReturnValue(
      new Promise((resolve) => {
        finish = (data) => resolve({ ok: true, data });
      }),
    );
    const { container } = await mountEditor();
    type(container, '!');
    const content = shadowOf(container).querySelector('.cm-content')!;

    ctrlS(content);
    ctrlS(content);
    await act(async () => finish(NEXT_VERSION));

    expect(api.write).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state().dirty).toBe(false));
  });

  it('o que se digita durante a gravação continua não salvo', async () => {
    let finish: (version: FileVersionDto) => void = () => undefined;
    api.write.mockReturnValue(
      new Promise((resolve) => {
        finish = (data) => resolve({ ok: true, data });
      }),
    );
    const { container } = await mountEditor();
    type(container, '1');
    ctrlS(shadowOf(container).querySelector('.cm-content')!);

    type(container, '2');
    await act(async () => finish(NEXT_VERSION));

    // O disco ficou com o texto que foi enviado; o que veio depois ainda não foi.
    await waitFor(() => expect(state().saved).toBe('texto1'));
    expect(state().dirty).toBe(true);
    expect(saveButton()).toBeEnabled();
  });

  it('falha na gravação mostra a mensagem do processo principal e mantém o texto', async () => {
    api.write.mockResolvedValue({
      ok: false,
      error: {
        code: 'FILE_CHANGED_ON_DISK',
        message: 'O arquivo mudou no disco depois de aberto.',
        retryable: false,
      },
    });
    const { container } = await mountEditor();
    type(container, '!');

    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O arquivo mudou no disco depois de aberto.',
    );
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
    expect(state()).toEqual({ dirty: true, saved: 'texto' });
    expect(saveButton()).toBeEnabled();
  });

  it('a falha por exceção também mostra um alerta e mantém o texto', async () => {
    api.write.mockRejectedValue(new Error('boom'));
    const { container } = await mountEditor();
    type(container, '!');

    await userEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível salvar o arquivo.',
    );
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
  });

  it('gravar com sucesso depois de uma falha tira o alerta', async () => {
    api.write.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Disco cheio.', retryable: false },
    });
    const { container } = await mountEditor();
    type(container, '!');
    await userEvent.click(saveButton());
    await screen.findByRole('alert');

    await userEvent.click(saveButton());

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('o "Salvar" ao fechar a janela que falhou mostra o motivo na aba e mantém o texto', async () => {
    api.write.mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Disco cheio.', retryable: false },
    });
    const { container } = await mountEditor();
    type(container, '!');

    await act(async () => {
      expect(await saveAllDirty()).toBe(false);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Disco cheio.');
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
    expect(state()).toEqual({ dirty: true, saved: 'texto' });
  });

  it('arquivo com fins de linha misturados abre somente leitura, com a faixa, e não deixa salvar', async () => {
    api.read.mockResolvedValue({ ok: true, data: content({ text: 'a\nb', eol: 'mixed' }) });
    const { container } = await mountEditor();

    expect(
      screen.getByText('Este arquivo mistura fins de linha; edite no seu editor'),
    ).toBeInTheDocument();
    expect(viewOf(container).state.readOnly).toBe(true);
    expect(saveButton()).toBeDisabled();
    const prevented = ctrlS(shadowOf(container).querySelector('.cm-content')!);
    expect(prevented).toBe(true);
    expect(api.write).not.toHaveBeenCalled();
  });

  it('um arquivo que não é de texto mostra o aviso e abre no programa padrão', async () => {
    api.read.mockResolvedValue({
      ok: false,
      error: {
        code: 'FILE_NOT_TEXT',
        message: 'O arquivo não é de texto e não abre no editor.',
        retryable: false,
      },
    });
    render(<Harness path="img/logo.png" />);
    act(() => openFile('p1', 'img/logo.png'));

    expect(await screen.findByText('Este arquivo não pode ser editado aqui')).toBeInTheDocument();
    expect(screen.getByText('O arquivo não é de texto e não abre no editor.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Abrir no programa padrão' }));

    expect(api.openDefault).toHaveBeenCalledWith('p1', 'img/logo.png');
  });

  it('um arquivo grande demais mostra o mesmo aviso', async () => {
    api.read.mockResolvedValue({
      ok: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'O arquivo passa de 2 MiB e não abre no editor.',
        retryable: false,
      },
    });
    render(<Harness path="dados.json" />);
    act(() => openFile('p1', 'dados.json'));

    expect(await screen.findByText('Este arquivo não pode ser editado aqui')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir no programa padrão' })).toBeInTheDocument();
  });

  it('falha ao abrir no programa padrão mostra a mensagem', async () => {
    api.read.mockResolvedValue({
      ok: false,
      error: {
        code: 'FILE_NOT_TEXT',
        message: 'O arquivo não é de texto e não abre no editor.',
        retryable: false,
      },
    });
    api.openDefault.mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Nenhum programa abre este arquivo.', retryable: false },
    });
    render(<Harness path="img/logo.png" />);
    act(() => openFile('p1', 'img/logo.png'));

    await userEvent.click(await screen.findByRole('button', { name: 'Abrir no programa padrão' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nenhum programa abre este arquivo.',
    );
  });

  it('uma edição de fora do editor (recarga do disco) aparece no editor sem virar edição da pessoa', async () => {
    const { container } = await mountEditor();

    act(() => updateText('p1', 'src/a.ts', 'texto novo'));

    await waitFor(() => expect(viewOf(container).state.doc.toString()).toBe('texto novo'));
  });
});
