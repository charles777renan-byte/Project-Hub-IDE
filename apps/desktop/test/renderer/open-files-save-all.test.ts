import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  AppResult,
  FileContentDto,
  FileVersionDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkFileOnDisk,
  hasDirtyFiles,
  listenForSaveAllRequests,
  openFile,
  resetOpenFilesForTests,
  saveAllDirty,
  updateText,
  useOpenFiles,
} from '../../src/renderer/open-files';

/**
 * "Salvar" ao fechar a janela: grava todo arquivo sujo de todo projeto e diz se a janela pode fechar. Só pode
 * quando, depois das gravações, nada ficou sujo: uma gravação que falha, um arquivo em conflito e o que se digitou
 * durante a gravação mantêm a janela aberta, com o texto.
 */

const HASH = 'a'.repeat(64);
const version = (n: number, hash = HASH): FileVersionDto => ({ size: n, mtimeMs: n, hash });

function content(text: string, hash = HASH): FileContentDto {
  return { text, eol: 'lf', bom: false, version: version(text.length, hash) };
}

type Write = ProjectHubApi['files']['write'];
type Stat = ProjectHubApi['files']['stat'];
type Read = ProjectHubApi['files']['read'];
let write: ReturnType<typeof vi.fn<Write>>;
let stat: ReturnType<typeof vi.fn<Stat>>;
let read: ReturnType<typeof vi.fn<Read>>;
let views: Record<string, ReturnType<typeof renderHook<ReturnType<typeof useOpenFiles>, unknown>>>;

beforeEach(() => {
  window.localStorage.clear();
  resetOpenFilesForTests();
  write = vi.fn<Write>((input) => Promise.resolve({ ok: true, data: version(input.text.length) }));
  stat = vi.fn<Stat>(() => new Promise(() => undefined));
  read = vi.fn<Read>((_projectId, path) =>
    Promise.resolve({ ok: true, data: content(`texto de ${path}`) }),
  );
  window.projectHub = { files: { read, write, stat } } as unknown as typeof window.projectHub;
  views = {
    p1: renderHook(() => useOpenFiles('p1')),
    p2: renderHook(() => useOpenFiles('p2')),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const buffer = (projectId: string, path: string) =>
  views[projectId]?.result.current.files.find((file) => file.path === path);

async function openDirty(projectId: string, path: string, text: string): Promise<void> {
  act(() => openFile(projectId, path));
  await waitFor(() => expect(buffer(projectId, path)?.load).toBe('ready'));
  act(() => updateText(projectId, path, text));
}

describe('saveAllDirty', () => {
  it('sem arquivo sujo não grava nada e libera a janela', async () => {
    expect(await saveAllDirty()).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('grava todo arquivo sujo, de todo projeto, e libera a janela quando nada fica sujo', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    await openDirty('p1', 'b.ts', 'novo b');
    await openDirty('p2', 'c.ts', 'novo c');
    act(() => openFile('p2', 'limpo.ts'));
    await waitFor(() => expect(buffer('p2', 'limpo.ts')?.load).toBe('ready'));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await saveAllDirty();
    });

    expect(saved).toBe(true);
    expect(write.mock.calls.map(([input]) => [input.projectId, input.path, input.text])).toEqual([
      ['p1', 'a.ts', 'novo a'],
      ['p1', 'b.ts', 'novo b'],
      ['p2', 'c.ts', 'novo c'],
    ]);
    expect(hasDirtyFiles()).toBe(false);
  });

  it('uma gravação que falha mantém a janela aberta, o texto no editor e mostra o motivo na aba', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    await openDirty('p1', 'b.ts', 'novo b');
    write.mockImplementation((input) =>
      Promise.resolve(
        input.path === 'a.ts'
          ? ({
              ok: false,
              error: {
                code: 'PERMISSION_DENIED',
                message: 'Sem permissão para gravar.',
                retryable: false,
              },
            } satisfies AppResult<FileVersionDto>)
          : { ok: true, data: version(input.text.length) },
      ),
    );

    let saved: boolean | undefined;
    await act(async () => {
      saved = await saveAllDirty();
    });

    expect(saved).toBe(false);
    // A que gravou ficou limpa; a que falhou conserva o texto, segue suja e mostra a mensagem.
    expect(buffer('p1', 'b.ts')).toMatchObject({ dirty: false });
    expect(buffer('p1', 'a.ts')).toMatchObject({
      text: 'novo a',
      dirty: true,
      saveProblem: 'Sem permissão para gravar.',
    });
    // A ativa era b.ts (a última aberta): a aba que falhou vem para a frente, para a pessoa ver o motivo.
    expect(views['p1']?.result.current.active).toBe('a.ts');
  });

  it('uma exceção na gravação também mantém a janela aberta, com o texto', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    write.mockRejectedValue(new Error('IPC caiu'));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await saveAllDirty();
    });

    expect(saved).toBe(false);
    expect(buffer('p1', 'a.ts')).toMatchObject({ text: 'novo a', dirty: true });
    expect(buffer('p1', 'a.ts')?.saveProblem).toBe('Não foi possível salvar o arquivo.');
  });

  it('o que se digitou durante a gravação mantém a janela aberta', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    write.mockImplementation((input) => {
      // A pessoa digita enquanto a gravação está em andamento.
      updateText('p1', 'a.ts', `${input.text} + mais`);
      return Promise.resolve({ ok: true, data: version(input.text.length) });
    });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await saveAllDirty();
    });

    expect(saved).toBe(false);
    expect(buffer('p1', 'a.ts')).toMatchObject({ text: 'novo a + mais', dirty: true });
    expect(hasDirtyFiles()).toBe(true);
  });

  it('arquivo mudado no disco (conflito) não é gravado por cima: a janela fica aberta', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    // A conferência do disco acha outra versão: abre o conflito, sem tocar no texto da pessoa.
    stat.mockResolvedValue({
      ok: true,
      data: { exists: true, version: version(99, 'b'.repeat(64)) },
    });
    read.mockResolvedValue({ ok: true, data: content('do disco', 'b'.repeat(64)) });
    await act(async () => {
      await checkFileOnDisk('p1', 'a.ts');
    });
    expect(buffer('p1', 'a.ts')?.notice).toBe('changed-on-disk');

    let saved: boolean | undefined;
    await act(async () => {
      saved = await saveAllDirty();
    });

    expect(saved).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(buffer('p1', 'a.ts')).toMatchObject({ text: 'novo a', dirty: true });
  });

  it('pedidos ao mesmo tempo dividem uma execução só: cada arquivo é gravado uma vez', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    let release: (() => void) | undefined;
    write.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, data: version(input.text.length) });
        }),
    );

    const first = saveAllDirty();
    const second = saveAllDirty();
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => {
      release?.();
      await Promise.all([first, second]);
    });

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a mensagem de falha some quando o arquivo é gravado depois', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    write.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Disco cheio.', retryable: false },
    });
    await act(async () => {
      expect(await saveAllDirty()).toBe(false);
    });
    expect(buffer('p1', 'a.ts')?.saveProblem).toBe('Disco cheio.');

    await act(async () => {
      expect(await saveAllDirty()).toBe(true);
    });

    expect(buffer('p1', 'a.ts')?.saveProblem).toBeUndefined();
  });
});

describe('listenForSaveAllRequests', () => {
  it('assina o pedido do processo principal e responde com o resultado do salvamento', async () => {
    await openDirty('p1', 'a.ts', 'novo a');
    const unsubscribe = vi.fn();
    let handler: (() => Promise<boolean>) | undefined;
    const onSaveAllRequest = vi.fn((listener: () => Promise<boolean>) => {
      handler = listener;
      return unsubscribe;
    });
    window.projectHub = {
      files: { read, write, stat, onSaveAllRequest },
    } as unknown as typeof window.projectHub;

    const stop = listenForSaveAllRequests();

    expect(onSaveAllRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await handler?.()).toBe(true);
    });
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sem a API do preload (telas montadas sem ela), não assina nada e não falha', () => {
    Reflect.deleteProperty(window, 'projectHub');

    expect(() => listenForSaveAllRequests()()).not.toThrow();
  });
});
