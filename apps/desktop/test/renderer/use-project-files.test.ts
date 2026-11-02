import { act, renderHook, waitFor } from '@testing-library/react';
import type { AppResult, FileEntryDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProjectFiles } from '../../src/renderer/components/right-panel/use-project-files';

/** Leitura da árvore de arquivos por pasta: carga ao expandir, cache, respostas velhas e recarga. */

function entry(path: string, kind: FileEntryDto['kind'] = 'file', ignored = false): FileEntryDto {
  return { name: path.split('/').pop() ?? path, path, kind, ignored };
}

const ROOT = [entry('src', 'directory'), entry('README.md')];
const SRC = [entry('src/main.ts'), entry('src/util.ts')];

type Listing = AppResult<FileEntryDto[]>;
type Deferred = { promise: Promise<Listing>; resolve: (value: Listing) => void };

function deferred(): Deferred {
  let resolve!: (value: Listing) => void;
  const promise = new Promise<Listing>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function ok(data: FileEntryDto[]): Listing {
  return { ok: true, data };
}

function fail(message: string): Listing {
  return { ok: false, error: { code: 'FILE_NOT_FOUND', message, retryable: false } };
}

/** Instala `files.list` com o tratador dado. */
function installApi(handler: (projectId: string, dir: string) => Promise<Listing>) {
  const list = vi.fn(handler);
  window.projectHub = { files: { list } } as unknown as ProjectHubApi;
  return list;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('useProjectFiles', () => {
  it('carrega a raiz ao montar e passa por "loading" até a resposta', async () => {
    const root = deferred();
    const list = installApi(() => root.promise);

    const { result } = renderHook(() => useProjectFiles('p1'));

    expect(list).toHaveBeenCalledWith('p1', '');
    expect(result.current.status('')).toBe('loading');
    expect(result.current.entries('')).toBeUndefined();

    await act(async () => root.resolve(ok(ROOT)));

    expect(result.current.status('')).toBe('idle');
    expect(result.current.entries('')).toEqual(ROOT);
    expect(result.current.error).toBeNull();
  });

  it('carrega a pasta só ao expandir, e recolher e reexpandir não repete a leitura nem duplica entradas', async () => {
    const list = installApi((_, dir) => Promise.resolve(ok(dir === '' ? ROOT : SRC)));
    const { result } = renderHook(() => useProjectFiles('p1'));
    await waitFor(() => expect(result.current.entries('')).toEqual(ROOT));
    expect(list).toHaveBeenCalledTimes(1);

    act(() => result.current.expand('src'));
    await waitFor(() => expect(result.current.entries('src')).toEqual(SRC));
    expect(list).toHaveBeenLastCalledWith('p1', 'src');
    expect(result.current.expanded.has('src')).toBe(true);

    act(() => result.current.collapse('src'));
    expect(result.current.expanded.has('src')).toBe(false);
    act(() => result.current.expand('src'));

    expect(result.current.entries('src')).toEqual(SRC);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('descarta a resposta de uma pasta que já foi recolhida', async () => {
    const src = deferred();
    installApi((_, dir) => (dir === '' ? Promise.resolve(ok(ROOT)) : src.promise));
    const { result } = renderHook(() => useProjectFiles('p1'));
    await waitFor(() => expect(result.current.entries('')).toEqual(ROOT));

    act(() => result.current.expand('src'));
    expect(result.current.status('src')).toBe('loading');
    act(() => result.current.collapse('src'));
    await act(async () => src.resolve(ok(SRC)));

    expect(result.current.entries('src')).toBeUndefined();
    expect(result.current.status('src')).toBe('idle');
  });

  it('descarta a resposta atrasada de um projeto anterior', async () => {
    const old = deferred();
    const next = [entry('novo.txt')];
    installApi((projectId) => (projectId === 'p1' ? old.promise : Promise.resolve(ok(next))));
    const { result, rerender } = renderHook(({ id }) => useProjectFiles(id), {
      initialProps: { id: 'p1' },
    });

    rerender({ id: 'p2' });
    await waitFor(() => expect(result.current.entries('')).toEqual(next));
    await act(async () => old.resolve(ok(ROOT)));

    expect(result.current.entries('')).toEqual(next);
  });

  it('ao trocar de projeto não mostra as entradas do anterior nem as pastas abertas', async () => {
    const second = deferred();
    installApi((projectId, dir) =>
      projectId === 'p1' ? Promise.resolve(ok(dir === '' ? ROOT : SRC)) : second.promise,
    );
    const { result, rerender } = renderHook(({ id }) => useProjectFiles(id), {
      initialProps: { id: 'p1' },
    });
    await waitFor(() => expect(result.current.entries('')).toEqual(ROOT));
    act(() => result.current.expand('src'));
    await waitFor(() => expect(result.current.entries('src')).toEqual(SRC));

    rerender({ id: 'p2' });

    expect(result.current.entries('')).toBeUndefined();
    expect(result.current.entries('src')).toBeUndefined();
    expect(result.current.expanded.size).toBe(0);
    await act(async () => second.resolve(ok([])));
  });

  it('refresh recarrega a raiz e as pastas abertas, e não as recolhidas', async () => {
    const list = installApi((_, dir) => Promise.resolve(ok(dir === '' ? ROOT : SRC)));
    const { result } = renderHook(() => useProjectFiles('p1'));
    await waitFor(() => expect(result.current.entries('')).toEqual(ROOT));
    act(() => result.current.expand('src'));
    await waitFor(() => expect(result.current.entries('src')).toEqual(SRC));
    act(() => result.current.expand('docs'));
    await waitFor(() => expect(list).toHaveBeenCalledWith('p1', 'docs'));
    act(() => result.current.collapse('docs'));
    list.mockClear();

    const changed = [entry('src/novo.ts')];
    list.mockImplementation((_, dir) => Promise.resolve(ok(dir === '' ? ROOT : changed)));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.entries('src')).toEqual(changed));
    expect(list.mock.calls.map(([, dir]) => dir).sort()).toEqual(['', 'src']);
  });

  it('refresh esquece as pastas recolhidas: ao reexpandir, a pasta é lida de novo', async () => {
    const list = installApi((_, dir) => Promise.resolve(ok(dir === '' ? ROOT : SRC)));
    const { result } = renderHook(() => useProjectFiles('p1'));
    await waitFor(() => expect(result.current.entries('')).toEqual(ROOT));
    act(() => result.current.expand('src'));
    await waitFor(() => expect(result.current.entries('src')).toEqual(SRC));
    act(() => result.current.collapse('src'));

    const changed = [entry('src/novo.ts')];
    list.mockImplementation((_, dir) => Promise.resolve(ok(dir === '' ? ROOT : changed)));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status('')).toBe('idle'));
    expect(result.current.entries('src')).toBeUndefined();

    act(() => result.current.expand('src'));

    await waitFor(() => expect(result.current.entries('src')).toEqual(changed));
  });

  it('durante a recarga as entradas antigas continuam à vista', async () => {
    const again = deferred();
    const list = installApi(() => Promise.resolve(ok(ROOT)));
    const { result } = renderHook(() => useProjectFiles('p1'));
    await waitFor(() => expect(result.current.entries('')).toEqual(ROOT));

    list.mockImplementation(() => again.promise);
    act(() => result.current.refresh());

    expect(result.current.status('')).toBe('loading');
    expect(result.current.entries('')).toEqual(ROOT);
    await act(async () => again.resolve(ok(ROOT)));
    expect(result.current.status('')).toBe('idle');
  });

  it('uma recarga mais nova vence a resposta mais antiga da mesma pasta', async () => {
    const first = deferred();
    const second = deferred();
    const list = installApi(() => first.promise);
    const { result } = renderHook(() => useProjectFiles('p1'));

    list.mockImplementation(() => second.promise);
    act(() => result.current.refresh());
    await act(async () => second.resolve(ok([entry('novo.txt')])));
    await act(async () => first.resolve(ok(ROOT)));

    expect(result.current.entries('')).toEqual([entry('novo.txt')]);
  });

  it('mostra a mensagem do processo principal quando a leitura falha', async () => {
    installApi(() => Promise.resolve(fail('O arquivo não existe mais no projeto.')));

    const { result } = renderHook(() => useProjectFiles('p1'));

    await waitFor(() => expect(result.current.status('')).toBe('error'));
    expect(result.current.error).toBe('O arquivo não existe mais no projeto.');
  });

  it('sem o preload ou com a chamada rejeitada, vira erro em vez de lançar', async () => {
    const { result } = renderHook(() => useProjectFiles('p1'));
    await waitFor(() => expect(result.current.status('')).toBe('error'));
    expect(result.current.error).toBe('Não foi possível listar os arquivos.');

    installApi(() => Promise.reject(new Error('IPC caiu')));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe('Não foi possível listar os arquivos.'));
  });

  it('uma pasta que falhou tenta de novo ao ser reexpandida', async () => {
    const list = installApi((_, dir) =>
      Promise.resolve(dir === '' ? ok(ROOT) : fail('Falhou ao ler a pasta.')),
    );
    const { result } = renderHook(() => useProjectFiles('p1'));
    await waitFor(() => expect(result.current.entries('')).toEqual(ROOT));
    act(() => result.current.expand('src'));
    await waitFor(() => expect(result.current.status('src')).toBe('error'));

    list.mockImplementation(() => Promise.resolve(ok(SRC)));
    act(() => result.current.collapse('src'));
    act(() => result.current.expand('src'));

    await waitFor(() => expect(result.current.entries('src')).toEqual(SRC));
    expect(result.current.error).toBeNull();
  });
});
