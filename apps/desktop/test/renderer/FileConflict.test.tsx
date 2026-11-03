import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  FileContentDto,
  FileStatDto,
  FileVersionDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileEditorTab } from '../../src/renderer/components/project/FileEditorTab';
import {
  checkFileOnDisk,
  openFile,
  resetOpenFilesForTests,
  setActive,
  useOpenFiles,
} from '../../src/renderer/open-files';
import { shadowOf, stubLayoutForCodeMirror, viewOf } from './codemirror-jsdom';

/** Arquivo alterado no disco enquanto está aberto: recarga sem edição, faixa de conflito com edição, arquivo sumido. */

beforeAll(stubLayoutForCodeMirror);

const VERSION: FileVersionDto = { size: 5, mtimeMs: 10, hash: 'a'.repeat(64) };
const DISK_VERSION: FileVersionDto = { size: 9, mtimeMs: 20, hash: 'b'.repeat(64) };
const SAVED_VERSION: FileVersionDto = { size: 12, mtimeMs: 30, hash: 'c'.repeat(64) };

function content(overrides: Partial<FileContentDto> = {}): FileContentDto {
  return { text: 'texto', eol: 'lf', bom: false, version: VERSION, ...overrides };
}

const DISK = content({ text: 'texto do agente', version: DISK_VERSION });

type Api = {
  stat: ReturnType<typeof vi.fn<ProjectHubApi['files']['stat']>>;
  read: ReturnType<typeof vi.fn<ProjectHubApi['files']['read']>>;
  write: ReturnType<typeof vi.fn<ProjectHubApi['files']['write']>>;
};
let api: Api;

/** O disco passa a ter outra versão: `stat` a anuncia e `read` devolve o conteúdo dela. */
function diskChanged(disk: FileContentDto = DISK) {
  api.stat.mockResolvedValue({ ok: true, data: { exists: true, version: disk.version } });
  api.read.mockResolvedValue({ ok: true, data: disk });
}

function diskGone() {
  api.stat.mockResolvedValue({ ok: true, data: { exists: false } satisfies FileStatDto });
}

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  api = {
    stat: vi.fn<ProjectHubApi['files']['stat']>(() =>
      Promise.resolve({ ok: true, data: { exists: true, version: VERSION } }),
    ),
    read: vi.fn<ProjectHubApi['files']['read']>(() =>
      Promise.resolve({ ok: true, data: content() }),
    ),
    write: vi.fn<ProjectHubApi['files']['write']>(() =>
      Promise.resolve({ ok: true, data: SAVED_VERSION }),
    ),
  };
  window.projectHub = { files: api } as unknown as typeof window.projectHub;
});

afterEach(() => {
  vi.useRealTimers();
});

function Harness({ path = 'src/a.ts' }: { path?: string }) {
  const { files } = useOpenFiles('p1');
  const file = files.find((item) => item.path === path);
  return (
    <>
      <FileEditorTab projectId="p1" path={path} />
      <div data-testid="estado">
        {JSON.stringify({ dirty: file?.dirty, saved: file?.saved?.text, notice: file?.notice })}
      </div>
    </>
  );
}

/** A faixa de "Atualizado": a barra de status do editor também tem role=status, então se filtra pela faixa. */
function reloadedNotice(): HTMLElement | null {
  return (
    screen
      .queryAllByRole('status')
      .find((element) => element.classList.contains('file-conflict')) ?? null
  );
}

function state(): { dirty: boolean; saved: string | undefined; notice: string | undefined } {
  return JSON.parse(screen.getByTestId('estado').textContent ?? '{}') as ReturnType<typeof state>;
}

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
    { timeout: 10_000 },
  );
  // Abrir não consulta o disco: a leitura acabou de acontecer. Os testes contam só as consultas deles.
  api.stat.mockClear();
  api.read.mockClear();
  return view;
}

function type(container: HTMLElement, extra: string) {
  act(() => {
    const view = viewOf(container);
    view.dispatch({
      changes: { from: view.state.doc.length, insert: extra },
      userEvent: 'input.type',
    });
  });
}

const check = () => act(() => checkFileOnDisk('p1', 'src/a.ts'));

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

describe('arquivo alterado no disco, sem edições não salvas', () => {
  it('relê o arquivo, troca o texto e avisa que foi atualizado', async () => {
    const { container } = await mountEditor();
    diskChanged();

    await check();

    expect(await screen.findByText('Atualizado: o arquivo mudou no disco')).toHaveTextContent(
      'Atualizado: o arquivo mudou no disco',
    );
    await waitFor(() => expect(viewOf(container).state.doc.toString()).toBe('texto do agente'));
    expect(state()).toEqual({ dirty: false, saved: 'texto do agente', notice: 'reloaded' });
    expect(api.write).not.toHaveBeenCalled();
  });

  it('o aviso some sozinho em 5 s', async () => {
    await mountEditor();
    diskChanged();
    vi.useFakeTimers();

    await check();
    expect(reloadedNotice()).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(4_900));
    expect(reloadedNotice()).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(200));

    expect(reloadedNotice()).not.toBeInTheDocument();
    expect(state().notice).toBeUndefined();
  });

  it('só o mtime mudou (mesmo conteúdo): nada acontece', async () => {
    await mountEditor();
    api.stat.mockResolvedValue({
      ok: true,
      data: { exists: true, version: { ...VERSION, mtimeMs: 999 } },
    });

    await check();

    expect(api.read).not.toHaveBeenCalled();
    expect(reloadedNotice()).not.toBeInTheDocument();
    expect(state().notice).toBeUndefined();
  });

  it('se o stat falha, não há nada a relatar', async () => {
    await mountEditor();
    api.stat.mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Sem acesso.', retryable: false },
    });

    await check();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(state().notice).toBeUndefined();
  });

  it('o disco é conferido quando a aba é ativada e quando a janela ganha foco', async () => {
    await mountEditor();
    act(() => openFile('p1', 'src/b.ts'));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith('p1', 'src/b.ts'));
    api.stat.mockClear();

    act(() => setActive('p1', 'src/a.ts'));
    await waitFor(() => expect(api.stat).toHaveBeenCalledWith('p1', 'src/a.ts'));
    api.stat.mockClear();

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(api.stat).toHaveBeenCalledWith('p1', 'src/a.ts'));
  });
});

describe('arquivo alterado no disco, com edições não salvas', () => {
  it('abre a faixa de conflito, guarda o texto da pessoa e não grava nada', async () => {
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();

    await check();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O arquivo mudou no disco enquanto você editava',
    );
    expect(state()).toEqual({ dirty: true, saved: 'texto', notice: 'changed-on-disk' });
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
    expect(api.write).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Manter o meu e comparar' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Recarregar do disco (perde as minhas alterações)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver só a versão do disco' })).toBeInTheDocument();
    // O Salvar do editor não passa por cima: a decisão é da faixa.
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('Ctrl+S com a faixa aberta não grava por cima: a decisão é da faixa', async () => {
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();
    await check();
    await screen.findByRole('alert');

    const prevented = ctrlS(shadowOf(container).querySelector('.cm-content')!);

    expect(prevented).toBe(true);
    expect(api.write).not.toHaveBeenCalled();
    expect(state()).toEqual({ dirty: true, saved: 'texto', notice: 'changed-on-disk' });
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
  });

  it('Manter o meu e comparar mostra as duas versões lado a lado, em texto puro', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    type(container, '<b>x</b>');
    diskChanged(content({ text: '<i>disco</i>', version: DISK_VERSION }));
    await check();

    await user.click(await screen.findByRole('button', { name: 'Manter o meu e comparar' }));

    const mine = screen.getByRole('region', { name: 'A minha versão' });
    const disk = screen.getByRole('region', { name: 'Versão do disco' });
    expect(mine).toHaveTextContent('texto<b>x</b>');
    expect(disk).toHaveTextContent('<i>disco</i>');
    expect(disk.querySelector('i')).toBeNull();
    expect(mine.querySelector('b')).toBeNull();
  });

  it('Salvar por cima exige dois cliques e só então grava, com a versão do disco', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();
    await check();
    await user.click(await screen.findByRole('button', { name: 'Manter o meu e comparar' }));

    await user.click(await screen.findByRole('button', { name: 'Salvar por cima' }));

    expect(api.write).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar: salvar por cima' }));

    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
    expect(api.write).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'src/a.ts',
      text: 'texto!',
      eol: 'lf',
      bom: false,
      expected: DISK_VERSION,
    });
    await waitFor(() =>
      expect(state()).toEqual({ dirty: false, saved: 'texto!', notice: undefined }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Recarregar do disco troca o texto, zera o dirty e fecha a faixa', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();
    await check();

    await user.click(
      await screen.findByRole('button', {
        name: 'Recarregar do disco (perde as minhas alterações)',
      }),
    );

    await waitFor(() => expect(viewOf(container).state.doc.toString()).toBe('texto do agente'));
    expect(state()).toEqual({ dirty: false, saved: 'texto do agente', notice: undefined });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.write).not.toHaveBeenCalled();
  });

  it('Ver só a versão do disco mostra o texto dele e tem volta', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();
    await check();

    await user.click(await screen.findByRole('button', { name: 'Ver só a versão do disco' }));

    expect(screen.getByRole('region', { name: 'Versão do disco' })).toHaveTextContent(
      'texto do agente',
    );
    expect(screen.queryByRole('region', { name: 'A minha versão' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar ao meu texto' }));

    expect(screen.queryByRole('region', { name: 'Versão do disco' })).not.toBeInTheDocument();
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
    expect(state().notice).toBe('changed-on-disk');
  });

  it('gravação recusada com FILE_CHANGED_ON_DISK confere o disco e abre a faixa, sem alerta duplicado', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();
    api.write.mockResolvedValue({
      ok: false,
      error: {
        code: 'FILE_CHANGED_ON_DISK',
        message: 'O arquivo mudou no disco depois de aberto.',
        retryable: false,
      },
    });

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O arquivo mudou no disco enquanto você editava',
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(state()).toEqual({ dirty: true, saved: 'texto', notice: 'changed-on-disk' });
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
  });

  it('se o disco mudou de novo antes da decisão, o Salvar por cima usa a versão mais nova', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();
    await check();
    await screen.findByRole('alert');
    const newer = content({
      text: 'agente de novo',
      version: { ...DISK_VERSION, hash: 'd'.repeat(64) },
    });
    diskChanged(newer);
    await check();
    await user.click(await screen.findByRole('button', { name: 'Manter o meu e comparar' }));
    expect(screen.getByRole('region', { name: 'Versão do disco' })).toHaveTextContent(
      'agente de novo',
    );

    await user.click(screen.getByRole('button', { name: 'Salvar por cima' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar: salvar por cima' }));

    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
    expect(api.write.mock.calls[0]?.[0].expected).toEqual(newer.version);
  });

  it('o disco voltou ao que o editor tinha: a faixa some', async () => {
    const { container } = await mountEditor();
    type(container, '!');
    diskChanged();
    await check();
    await screen.findByRole('alert');
    api.stat.mockResolvedValue({ ok: true, data: { exists: true, version: VERSION } });

    await check();

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(state()).toEqual({ dirty: true, saved: 'texto', notice: undefined });
  });
});

describe('arquivo apagado do disco', () => {
  it('marca a aba como sem arquivo e mantém o texto', async () => {
    const { container } = await mountEditor();
    type(container, '!');
    diskGone();

    await check();

    expect(await screen.findByRole('alert')).toHaveTextContent('O arquivo não existe mais');
    expect(state()).toEqual({ dirty: true, saved: 'texto', notice: 'missing' });
    expect(viewOf(container).state.doc.toString()).toBe('texto!');
    expect(api.write).not.toHaveBeenCalled();
  });

  it('Salvar pede confirmação inline e só então recria o arquivo (expected nulo)', async () => {
    const user = userEvent.setup();
    const { container } = await mountEditor();
    type(container, '!');
    diskGone();
    await check();
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(api.write).not.toHaveBeenCalled();
    expect(screen.getByText('Criar o arquivo de novo com este texto?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Criar arquivo' }));

    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
    expect(api.write).toHaveBeenCalledWith({
      projectId: 'p1',
      path: 'src/a.ts',
      text: 'texto!',
      eol: 'lf',
      bom: false,
      expected: null,
    });
    await waitFor(() =>
      expect(state()).toEqual({ dirty: false, saved: 'texto!', notice: undefined }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem alteração nova, Salvar também vale: é o jeito de recriar o arquivo', async () => {
    const user = userEvent.setup();
    await mountEditor();
    diskGone();
    await check();
    await screen.findByRole('alert');

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(screen.getByRole('button', { name: 'Criar arquivo' }));

    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
    expect(api.write.mock.calls[0]?.[0]).toMatchObject({ text: 'texto', expected: null });
  });

  it('Voltar na confirmação não grava', async () => {
    const user = userEvent.setup();
    await mountEditor();
    diskGone();
    await check();
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const asking = screen.getByText('Criar o arquivo de novo com este texto?');
    await user.click(within(asking.parentElement!).getByRole('button', { name: 'Voltar' }));

    expect(screen.queryByText('Criar o arquivo de novo com este texto?')).not.toBeInTheDocument();
    expect(api.write).not.toHaveBeenCalled();
    expect(state().notice).toBe('missing');
  });

  it('o arquivo que reaparece igual ao que o editor tinha tira o aviso', async () => {
    await mountEditor();
    diskGone();
    await check();
    await screen.findByRole('alert');
    api.stat.mockResolvedValue({ ok: true, data: { exists: true, version: VERSION } });

    await check();

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
