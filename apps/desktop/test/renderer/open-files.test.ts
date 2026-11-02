import { act, renderHook, waitFor } from '@testing-library/react';
import type { AppResult, ErrorCode, FileContentDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeFile,
  hasDirtyFiles,
  markSaved,
  openFile,
  resetOpenFilesForTests,
  setActive,
  updateText,
  useOpenFiles,
} from '../../src/renderer/open-files';

/** O store dos arquivos abertos: abrir, ativar, editar, fechar e lembrar só os caminhos. */

const KEY = (projectId: string) => `project-hub:open-files:v1:${projectId}`;

const HASH = 'a'.repeat(64);

function content(text: string): FileContentDto {
  return { text, eol: 'lf', bom: false, version: { size: text.length, mtimeMs: 1, hash: HASH } };
}

function failure(code: ErrorCode, message: string): AppResult<FileContentDto> {
  return { ok: false, error: { code, message, retryable: false } };
}

let read: ReturnType<typeof vi.fn<ProjectHubApi['files']['read']>>;

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  read = vi.fn<ProjectHubApi['files']['read']>((_projectId, path) =>
    Promise.resolve({ ok: true, data: content(`texto de ${path}`) }),
  );
  window.projectHub = { files: { read } } as unknown as typeof window.projectHub;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mount(projectId = 'p1') {
  return renderHook(() => useOpenFiles(projectId));
}

describe('open-files', () => {
  it('sem arquivo aberto, a lista é vazia, a aba ativa é a dos terminais e nada está sujo', () => {
    const { result } = mount();

    expect(result.current).toEqual({ files: [], active: 'terminals', anyDirty: false });
    expect(hasDirtyFiles()).toBe(false);
  });

  it('openFile carrega uma vez, ativa a aba e guarda o texto lido', async () => {
    const { result } = mount();

    act(() => openFile('p1', 'src/a.ts'));

    expect(result.current.active).toBe('src/a.ts');
    expect(result.current.files).toEqual([
      { path: 'src/a.ts', load: 'loading', text: '', dirty: false },
    ]);
    await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('p1', 'src/a.ts');
    expect(result.current.files[0]).toMatchObject({
      text: 'texto de src/a.ts',
      dirty: false,
      saved: content('texto de src/a.ts'),
    });
  });

  it('abrir de novo o mesmo caminho só ativa a aba, sem ler outra vez', async () => {
    const { result } = mount();
    act(() => openFile('p1', 'a.ts'));
    await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));
    act(() => openFile('p1', 'b.ts'));
    await waitFor(() => expect(result.current.files[1]?.load).toBe('ready'));
    expect(result.current.active).toBe('b.ts');

    act(() => openFile('p1', 'a.ts'));

    expect(result.current.active).toBe('a.ts');
    expect(result.current.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('updateText marca dirty quando o texto difere do salvo e desmarca quando volta a igualar', async () => {
    const { result } = mount();
    act(() => openFile('p1', 'a.ts'));
    await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));

    act(() => updateText('p1', 'a.ts', 'outro texto'));
    expect(result.current.files[0]).toMatchObject({ text: 'outro texto', dirty: true });
    expect(result.current.anyDirty).toBe(true);
    expect(hasDirtyFiles()).toBe(true);

    act(() => updateText('p1', 'a.ts', 'texto de a.ts'));
    expect(result.current.files[0]).toMatchObject({ text: 'texto de a.ts', dirty: false });
    expect(result.current.anyDirty).toBe(false);
    expect(hasDirtyFiles()).toBe(false);
  });

  it('hasDirtyFiles vale para qualquer projeto', async () => {
    const first = mount('p1');
    const second = mount('p2');
    act(() => openFile('p2', 'z.ts'));
    await waitFor(() => expect(second.result.current.files[0]?.load).toBe('ready'));

    act(() => updateText('p2', 'z.ts', 'mudou'));

    expect(first.result.current.anyDirty).toBe(false);
    expect(second.result.current.anyDirty).toBe(true);
    expect(hasDirtyFiles()).toBe(true);
  });

  it('updateText num arquivo ainda não carregado ou inexistente não faz nada', () => {
    const { result } = mount();
    act(() => openFile('p1', 'a.ts'));

    act(() => updateText('p1', 'a.ts', 'cedo demais'));
    act(() => updateText('p1', 'nao-aberto.ts', 'x'));

    expect(result.current.files).toEqual([
      { path: 'a.ts', load: 'loading', text: '', dirty: false },
    ]);
  });

  describe('markSaved', () => {
    const NEW_VERSION = { size: 7, mtimeMs: 2, hash: 'b'.repeat(64) };

    it('o que foi gravado vira o salvo e zera o dirty, sem mexer no texto do editor', async () => {
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));
      act(() => updateText('p1', 'a.ts', 'gravado'));
      expect(result.current.anyDirty).toBe(true);

      act(() =>
        markSaved('p1', 'a.ts', { text: 'gravado', eol: 'crlf', bom: true, version: NEW_VERSION }),
      );

      const file = result.current.files[0];
      expect(file?.saved).toEqual({
        text: 'gravado',
        eol: 'crlf',
        bom: true,
        version: NEW_VERSION,
      });
      expect(file?.text).toBe('gravado');
      expect(file?.dirty).toBe(false);
      expect(result.current.anyDirty).toBe(false);
      expect(hasDirtyFiles()).toBe(false);
    });

    it('o que se digitou durante a gravação continua não salvo', async () => {
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));
      act(() => updateText('p1', 'a.ts', 'enviado e mais'));

      act(() =>
        markSaved('p1', 'a.ts', { text: 'enviado', eol: 'lf', bom: false, version: NEW_VERSION }),
      );

      expect(result.current.files[0]?.saved?.text).toBe('enviado');
      expect(result.current.files[0]?.text).toBe('enviado e mais');
      expect(result.current.files[0]?.dirty).toBe(true);
      expect(result.current.anyDirty).toBe(true);
    });

    it('arquivo já fechado não volta à lista', async () => {
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));
      act(() => closeFile('p1', 'a.ts'));

      act(() =>
        markSaved('p1', 'a.ts', { text: 'x', eol: 'lf', bom: false, version: NEW_VERSION }),
      );

      expect(result.current.files).toEqual([]);
    });
  });

  it('closeFile ativa a aba vizinha: a que ocupa o lugar, ou a anterior se era a última', async () => {
    const { result } = mount();
    for (const path of ['a.ts', 'b.ts', 'c.ts']) act(() => openFile('p1', path));
    await waitFor(() =>
      expect(result.current.files.every((file) => file.load === 'ready')).toBe(true),
    );

    act(() => setActive('p1', 'b.ts'));
    act(() => closeFile('p1', 'b.ts'));
    expect(result.current.active).toBe('c.ts');

    act(() => closeFile('p1', 'c.ts'));
    expect(result.current.active).toBe('a.ts');
    expect(result.current.files.map((file) => file.path)).toEqual(['a.ts']);
  });

  it('fechar uma aba que não é a ativa mantém a ativa', async () => {
    const { result } = mount();
    for (const path of ['a.ts', 'b.ts']) act(() => openFile('p1', path));
    await waitFor(() =>
      expect(result.current.files.every((file) => file.load === 'ready')).toBe(true),
    );

    act(() => closeFile('p1', 'a.ts'));

    expect(result.current.active).toBe('b.ts');
  });

  it('fechar o último arquivo volta à aba Terminais', async () => {
    const { result } = mount();
    act(() => openFile('p1', 'a.ts'));
    await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));

    act(() => closeFile('p1', 'a.ts'));

    expect(result.current).toEqual({ files: [], active: 'terminals', anyDirty: false });
  });

  it('setActive troca para Terminais e para um arquivo aberto; um caminho desconhecido é ignorado', async () => {
    const { result } = mount();
    act(() => openFile('p1', 'a.ts'));
    await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));

    act(() => setActive('p1', 'terminals'));
    expect(result.current.active).toBe('terminals');
    act(() => setActive('p1', 'a.ts'));
    expect(result.current.active).toBe('a.ts');
    act(() => setActive('p1', 'fantasma.ts'));
    expect(result.current.active).toBe('a.ts');
  });

  it('fechar o arquivo enquanto a leitura corre descarta a resposta', async () => {
    let finish: (value: AppResult<FileContentDto>) => void = () => {};
    read.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const { result } = mount();
    act(() => openFile('p1', 'a.ts'));
    act(() => closeFile('p1', 'a.ts'));

    await act(async () => finish({ ok: true, data: content('tarde') }));

    expect(result.current.files).toEqual([]);
  });

  it('cada projeto tem a sua lista', async () => {
    const first = mount('p1');
    const second = mount('p2');
    act(() => openFile('p1', 'a.ts'));
    await waitFor(() => expect(first.result.current.files[0]?.load).toBe('ready'));

    expect(second.result.current.files).toEqual([]);
    expect(second.result.current.active).toBe('terminals');
  });

  describe('falhas de leitura', () => {
    it('FILE_NOT_TEXT vira not-text e FILE_TOO_LARGE vira too-large, com a mensagem do processo principal', async () => {
      read.mockImplementation((_projectId, path) =>
        Promise.resolve(
          path === 'logo.png'
            ? failure('FILE_NOT_TEXT', 'O arquivo não é de texto e não abre no editor.')
            : failure('FILE_TOO_LARGE', 'O arquivo passa de 2 MiB e não abre no editor.'),
        ),
      );
      const { result } = mount();

      act(() => openFile('p1', 'logo.png'));
      act(() => openFile('p1', 'dump.sql'));

      await waitFor(() =>
        expect(result.current.files.every((file) => file.load !== 'loading')).toBe(true),
      );
      expect(result.current.files).toEqual([
        {
          path: 'logo.png',
          load: 'not-text',
          message: 'O arquivo não é de texto e não abre no editor.',
          text: '',
          dirty: false,
        },
        {
          path: 'dump.sql',
          load: 'too-large',
          message: 'O arquivo passa de 2 MiB e não abre no editor.',
          text: '',
          dirty: false,
        },
      ]);
    });

    it('outro código vira error com a mensagem recebida', async () => {
      read.mockResolvedValue(failure('FILE_NOT_FOUND', 'O arquivo não existe mais no projeto.'));
      const { result } = mount();

      act(() => openFile('p1', 'sumiu.ts'));

      await waitFor(() => expect(result.current.files[0]?.load).toBe('error'));
      expect(result.current.files[0]?.message).toBe('O arquivo não existe mais no projeto.');
    });

    it('uma exceção na leitura vira error com o texto geral', async () => {
      read.mockRejectedValue(new Error('sem ponte'));
      const { result } = mount();

      act(() => openFile('p1', 'a.ts'));

      await waitFor(() => expect(result.current.files[0]?.load).toBe('error'));
      expect(result.current.files[0]?.message).toBe('Não foi possível abrir o arquivo.');
    });
  });

  describe('persistência', () => {
    it('guarda só os caminhos e a aba ativa, nunca o texto', async () => {
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      act(() => openFile('p1', 'b.ts'));
      await waitFor(() =>
        expect(result.current.files.every((file) => file.load === 'ready')).toBe(true),
      );
      act(() => updateText('p1', 'a.ts', 'SEGREDO digitado'));
      act(() => setActive('p1', 'a.ts'));

      const raw = window.localStorage.getItem(KEY('p1')) ?? '';
      expect(JSON.parse(raw)).toEqual({ files: ['a.ts', 'b.ts'], active: 'a.ts' });
      expect(raw).not.toContain('SEGREDO');
      expect(raw).not.toContain('texto de');
    });

    it('a lista volta do localStorage na primeira leitura do projeto, relendo cada arquivo', async () => {
      window.localStorage.setItem(
        KEY('p1'),
        JSON.stringify({ files: ['a.ts', 'dir/b.ts'], active: 'dir/b.ts' }),
      );

      const { result } = mount();

      expect(result.current.active).toBe('dir/b.ts');
      expect(result.current.files.map((file) => file.path)).toEqual(['a.ts', 'dir/b.ts']);
      await waitFor(() =>
        expect(result.current.files.every((file) => file.load === 'ready')).toBe(true),
      );
      expect(read).toHaveBeenCalledTimes(2);
      expect(result.current.files[1]?.text).toBe('texto de dir/b.ts');
    });

    it('o estado volta com a aba Terminais ativa se foi ela que ficou guardada', () => {
      window.localStorage.setItem(
        KEY('p1'),
        JSON.stringify({ files: ['a.ts'], active: 'terminals' }),
      );

      const { result } = mount();

      expect(result.current.active).toBe('terminals');
      expect(result.current.files).toHaveLength(1);
    });

    it('fechar o último arquivo apaga o que estava guardado', async () => {
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));
      expect(window.localStorage.getItem(KEY('p1'))).not.toBeNull();

      act(() => closeFile('p1', 'a.ts'));

      expect(window.localStorage.getItem(KEY('p1'))).toBeNull();
    });

    it.each([
      ['texto solto', 'lixo'],
      ['JSON de outro formato', JSON.stringify(['a.ts'])],
      ['caminhos que não são texto', JSON.stringify({ files: [1, null], active: 'terminals' })],
      ['sem a lista', JSON.stringify({ active: 'a.ts' })],
    ])('um valor estranho guardado (%s) vale como nenhum arquivo aberto', (_name, raw) => {
      window.localStorage.setItem(KEY('p1'), raw);

      const { result } = mount();

      expect(result.current).toEqual({ files: [], active: 'terminals', anyDirty: false });
    });

    it('uma aba ativa que não está na lista guardada vira Terminais', () => {
      window.localStorage.setItem(KEY('p1'), JSON.stringify({ files: ['a.ts'], active: 'x.ts' }));

      const { result } = mount();

      expect(result.current.active).toBe('terminals');
    });

    it('sem localStorage, tudo funciona só em memória', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('sem armazenamento');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('sem armazenamento');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('sem armazenamento');
      });
      const { result } = mount();

      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));
      act(() => closeFile('p1', 'a.ts'));

      expect(result.current.files).toEqual([]);
    });
  });

  describe('beforeunload', () => {
    /** Dispara o fechamento da janela; devolve se o renderer o bloqueou (a base do aviso do processo principal). */
    function closeWindow(): boolean {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('sem arquivo sujo, a janela fecha sem bloqueio', async () => {
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));

      expect(closeWindow()).toBe(false);
    });

    it('com arquivo sujo, bloqueia o fechamento; ao salvar ou fechar o arquivo, deixa de bloquear', async () => {
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));

      act(() => updateText('p1', 'a.ts', 'mudou'));
      expect(closeWindow()).toBe(true);

      act(() => markSaved('p1', 'a.ts', { ...content('mudou') }));
      expect(closeWindow()).toBe(false);

      act(() => updateText('p1', 'a.ts', 'mudou de novo'));
      expect(closeWindow()).toBe(true);
      act(() => closeFile('p1', 'a.ts'));
      expect(closeWindow()).toBe(false);
    });

    it('registra um ouvinte só, mesmo com várias edições', async () => {
      const add = vi.spyOn(window, 'addEventListener');
      const { result } = mount();
      act(() => openFile('p1', 'a.ts'));
      await waitFor(() => expect(result.current.files[0]?.load).toBe('ready'));

      act(() => updateText('p1', 'a.ts', 'um'));
      act(() => updateText('p1', 'a.ts', 'dois'));

      expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
    });
  });
});
