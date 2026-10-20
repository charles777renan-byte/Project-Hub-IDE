import { describe, expect, it, vi } from 'vitest';
import { handleStartupFailure, handleWindowLoadFailure } from '../src/main/startup-failure';

describe('handleStartupFailure', () => {
  it('registra a causa, mostra o motivo numa caixa e encerra com código 1, nessa ordem', () => {
    const io = { log: vi.fn(), showError: vi.fn(), exit: vi.fn() };
    const cause = new Error('database disk image is malformed');

    handleStartupFailure(cause, io);

    expect(io.log).toHaveBeenCalledWith(cause);
    expect(io.showError).toHaveBeenCalledWith(
      expect.stringContaining('database disk image is malformed'),
    );
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(io.exit.mock.invocationCallOrder[0]).toBeGreaterThan(
      io.showError.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('se a caixa falhar ao abrir, a saída com código 1 acontece mesmo assim', () => {
    const io = {
      log: vi.fn(),
      showError: vi.fn(() => {
        throw new Error('caixa indisponível');
      }),
      exit: vi.fn(),
    };

    expect(() => handleStartupFailure(new Error('banco ilegível'), io)).toThrow(
      'caixa indisponível',
    );
    expect(io.exit).toHaveBeenCalledWith(1);
  });

  it('um erro que não é Error também aparece como texto legível na caixa', () => {
    const io = { log: vi.fn(), showError: vi.fn(), exit: vi.fn() };

    handleStartupFailure('falha sem objeto de erro', io);

    expect(io.showError).toHaveBeenCalledWith(expect.stringContaining('falha sem objeto de erro'));
    expect(io.exit).toHaveBeenCalledWith(1);
  });
});

describe('handleWindowLoadFailure', () => {
  const makeIo = () => ({
    log: vi.fn(),
    logIgnored: vi.fn(),
    showError: vi.fn(),
    exit: vi.fn(),
  });
  const chromiumError = (code: string, errno: number, message: string) =>
    Object.assign(new Error(message), { code, errno });

  it.each([
    [
      'ERR_FAILED, o código observado ao fechar',
      chromiumError('ERR_FAILED', -2, 'ERR_FAILED (-2) loading'),
    ],
    [
      'ERR_ABORTED, de uma navegação cancelada',
      chromiumError('ERR_ABORTED', -3, 'ERR_ABORTED (-3) loading'),
    ],
    [
      'arquivo não encontrado, que sozinho seria falha real',
      chromiumError('ERR_FILE_NOT_FOUND', -6, 'ERR_FILE_NOT_FOUND (-6) loading'),
    ],
  ])('fechando, a rejeição %s só é registrada: sem caixa e sem saída forçada', (_name, error) => {
    const io = makeIo();

    handleWindowLoadFailure(error, { closing: true }, io);

    expect(io.logIgnored).toHaveBeenCalledTimes(1);
    expect(io.logIgnored).toHaveBeenCalledWith(expect.stringContaining(`code=${error.code}`));
    expect(io.logIgnored).toHaveBeenCalledWith(expect.stringContaining(`errno=${error.errno}`));
    expect(io.showError).not.toHaveBeenCalled();
    expect(io.exit).not.toHaveBeenCalled();
    expect(io.log).not.toHaveBeenCalled();
  });

  it('fechando, um erro sem código nem objeto também só é registrado', () => {
    const io = makeIo();

    handleWindowLoadFailure('falha sem objeto', { closing: true }, io);

    expect(io.logIgnored).toHaveBeenCalledWith(expect.stringContaining('falha sem objeto'));
    expect(io.showError).not.toHaveBeenCalled();
    expect(io.exit).not.toHaveBeenCalled();
  });

  it('sem fechar, uma rejeição parecida com cancelamento continua sendo falha: caixa e saída 1', () => {
    const io = makeIo();

    handleWindowLoadFailure(
      chromiumError('ERR_ABORTED', -3, 'ERR_ABORTED (-3) loading'),
      { closing: false },
      io,
    );

    expect(io.showError).toHaveBeenCalledWith(expect.stringContaining('ERR_ABORTED'));
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(io.logIgnored).not.toHaveBeenCalled();
  });

  it('sem fechar, ERR_FAILED também é falha: caixa e saída 1', () => {
    const io = makeIo();

    handleWindowLoadFailure(
      chromiumError('ERR_FAILED', -2, 'ERR_FAILED (-2) loading'),
      { closing: false },
      io,
    );

    expect(io.showError).toHaveBeenCalledWith(expect.stringContaining('ERR_FAILED'));
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(io.logIgnored).not.toHaveBeenCalled();
  });

  it('sem fechar, um arquivo que não existe mostra a caixa, registra a causa e sai com 1', () => {
    const io = makeIo();
    const cause = chromiumError(
      'ERR_FILE_NOT_FOUND',
      -6,
      'ERR_FILE_NOT_FOUND (-6) loading index.html',
    );

    handleWindowLoadFailure(cause, { closing: false }, io);

    expect(io.log).toHaveBeenCalledWith(cause);
    expect(io.showError).toHaveBeenCalledWith(expect.stringContaining('index.html'));
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(io.logIgnored).not.toHaveBeenCalled();
  });
});
