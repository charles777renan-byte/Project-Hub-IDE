import { describe, expect, it, vi } from 'vitest';
import { createIsDirectory } from '../src/main/filesystem';

const isDirectoryStat = (directory: boolean) => () =>
  Promise.resolve({ isDirectory: () => directory });

function failing(code: string) {
  return () => Promise.reject(Object.assign(new Error(`${code}: teste`), { code }));
}

describe('createIsDirectory', () => {
  it('diretório existente dá true, e arquivo dá false', async () => {
    await expect(createIsDirectory(isDirectoryStat(true))('C:\\Projetos')).resolves.toBe(true);
    await expect(createIsDirectory(isDirectoryStat(false))('C:\\Projetos\\a.txt')).resolves.toBe(
      false,
    );
  });

  it.each(['ENOENT', 'ENOTDIR'])(
    '%s quer dizer que a pasta não está lá: false, sem registro de erro',
    async (code) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(createIsDirectory(failing(code))('C:\\sumiu')).resolves.toBe(false);

      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    },
  );

  it('outro erro, como permissão negada, é registrado e propagado, e não vira "não existe"', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = Object.assign(new Error('EACCES: permissão negada'), { code: 'EACCES' });

    await expect(createIsDirectory(() => Promise.reject(error))('C:\\bloqueada')).rejects.toBe(
      error,
    );

    expect(log).toHaveBeenCalledWith(expect.stringContaining('C:\\bloqueada'), error);
    log.mockRestore();
  });
});
