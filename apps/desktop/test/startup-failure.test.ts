import { describe, expect, it, vi } from 'vitest';
import { handleStartupFailure } from '../src/main/startup-failure';

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

  it('um erro que não é Error também aparece como texto legível na caixa', () => {
    const io = { log: vi.fn(), showError: vi.fn(), exit: vi.fn() };

    handleStartupFailure('falha sem objeto de erro', io);

    expect(io.showError).toHaveBeenCalledWith(expect.stringContaining('falha sem objeto de erro'));
    expect(io.exit).toHaveBeenCalledWith(1);
  });
});
