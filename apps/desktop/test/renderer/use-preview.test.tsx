import type { AppResult, PreviewStateDto } from '@project-hub/contracts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreview } from '../../src/renderer/use-preview';
import {
  DEV_APPROVAL,
  installBrowserApi,
  previewState,
  SERVER_DETECTION,
} from './browser-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

const APPROVED = previewState({ detection: SERVER_DETECTION, approval: DEV_APPROVAL });
const refusal = (message: string): AppResult<PreviewStateDto> => ({
  ok: false,
  error: { code: 'VALIDATION_FAILED', message, retryable: false },
});

async function mount(projectId = 'p1') {
  const view = renderHook(({ id }) => usePreview(id), { initialProps: { id: projectId } });
  await waitFor(() => expect(view.result.current.state).not.toBeNull());
  return view;
}

describe('usePreview', () => {
  it('lê o estado do projeto ao montar', async () => {
    const { preview } = installBrowserApi(undefined, APPROVED);
    const { result } = await mount();
    expect(preview.state).toHaveBeenCalledExactlyOnceWith('p1');
    expect(result.current.state).toEqual(APPROVED);
    expect(result.current.error).toBeNull();
  });

  it('acompanha os eventos do mesmo projeto e ignora os de outro', async () => {
    const { emitPreview } = installBrowserApi();
    const { result } = await mount();

    act(() => emitPreview({ ...APPROVED, status: 'starting' }));
    expect(result.current.state?.status).toBe('starting');

    act(() => emitPreview({ ...APPROVED, projectId: 'p2', status: 'exited' }));
    expect(result.current.state?.status).toBe('starting');
  });

  it('cancela a assinatura ao desmontar', async () => {
    const { previewListeners } = installBrowserApi();
    const { unmount } = await mount();
    expect(previewListeners()).toBe(1);
    unmount();
    expect(previewListeners()).toBe(0);
  });

  it('ao trocar de projeto, lê o novo e descarta a resposta atrasada do antigo', async () => {
    const { preview } = installBrowserApi();
    let answerOld: (result: AppResult<PreviewStateDto>) => void = () => undefined;
    preview.state.mockImplementationOnce(
      () => new Promise<AppResult<PreviewStateDto>>((resolve) => (answerOld = resolve)),
    );
    const view = renderHook(({ id }) => usePreview(id), { initialProps: { id: 'p1' } });

    view.rerender({ id: 'p2' });
    await waitFor(() => expect(preview.state).toHaveBeenLastCalledWith('p2'));
    await act(async () => {
      answerOld({ ok: true, data: { ...APPROVED, status: 'exited' } });
      await Promise.resolve();
    });

    expect(view.result.current.state?.status).not.toBe('exited');
  });

  it('cada pedido chama o canal certo e adota o estado que volta', async () => {
    const { preview } = installBrowserApi();
    const { result } = await mount();
    preview.approve.mockResolvedValueOnce({ ok: true, data: APPROVED });

    let done = false;
    await act(async () => {
      done = await result.current.approve('dev', 'vite');
    });
    expect(done).toBe(true);
    expect(preview.approve).toHaveBeenCalledExactlyOnceWith('p1', 'dev', 'vite');
    expect(result.current.state).toEqual(APPROVED);

    await act(async () => {
      await result.current.setAddress('localhost:3000');
      await result.current.start('t1');
      await result.current.start('t1', { restart: true });
      await result.current.forget();
    });
    expect(preview.setAddress).toHaveBeenCalledExactlyOnceWith('p1', 'localhost:3000');
    expect(preview.start).toHaveBeenNthCalledWith(1, 'p1', 't1');
    expect(preview.start).toHaveBeenNthCalledWith(2, 'p1', 't1', { restart: true });
    expect(preview.forget).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('pedido recusado: guarda a mensagem, relê o estado e devolve falso', async () => {
    const { preview } = installBrowserApi();
    const { result } = await mount();
    preview.approve.mockResolvedValueOnce(refusal('O comando do preview mudou.'));
    preview.state.mockResolvedValueOnce({
      ok: true,
      data: { ...APPROVED, approval: { ...DEV_APPROVAL, changed: true } },
    });

    let done = true;
    await act(async () => {
      done = await result.current.approve('dev', 'vite');
    });

    expect(done).toBe(false);
    expect(result.current.error).toBe('O comando do preview mudou.');
    expect(preview.state).toHaveBeenCalledTimes(2);
    expect(result.current.state?.approval).toMatchObject({ changed: true });
  });

  it('o pedido seguinte que dá certo tira a mensagem', async () => {
    const { preview } = installBrowserApi();
    const { result } = await mount();
    preview.start.mockResolvedValueOnce(
      refusal('Abra o projeto para subir o servidor do preview.'),
    );

    await act(async () => {
      await result.current.start('t1');
    });
    expect(result.current.error).toBe('Abra o projeto para subir o servidor do preview.');

    await act(async () => {
      await result.current.start('t1');
    });
    expect(result.current.error).toBeNull();
  });

  it('se o canal quebra, mostra uma mensagem fixa e devolve falso', async () => {
    const { preview } = installBrowserApi();
    const { result } = await mount();
    preview.forget.mockRejectedValueOnce(new Error('pipe'));

    let done = true;
    await act(async () => {
      done = await result.current.forget();
    });

    expect(done).toBe(false);
    expect(result.current.error).toBe('Não foi possível falar com o preview.');
  });
});
