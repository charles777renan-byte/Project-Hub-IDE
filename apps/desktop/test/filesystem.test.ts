import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIsDirectory, createIsInsideProject } from '../src/main/filesystem';

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

describe('createIsInsideProject', () => {
  let base: string;
  let project: string;
  let outside: string;
  const isInside = createIsInsideProject();

  beforeEach(async () => {
    // O `realpath` do diretório temporário evita falso negativo em pastas que são links (como o /tmp do macOS).
    base = await realpath(await mkdtemp(join(tmpdir(), 'ph-inside-')));
    project = join(base, 'projeto');
    outside = join(base, 'fora');
    await mkdir(join(project, 'src'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(project, 'src', 'a.ts'), 'a');
    await writeFile(join(outside, 'segredo.txt'), 's');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('arquivo existente dentro da pasta: true', async () => {
    await expect(isInside(project, 'src/a.ts')).resolves.toBe(true);
  });

  it('arquivo que não existe mais (apagado) vale pelo ancestral existente: true', async () => {
    await expect(isInside(project, 'src/apagado.ts')).resolves.toBe(true);
    await expect(isInside(project, 'pasta/nova/funda/x.ts')).resolves.toBe(true);
  });

  it('a própria pasta do projeto não conta como arquivo dentro dela', async () => {
    await expect(isInside(project, '.')).resolves.toBe(false);
  });

  it('caminho que sobe da pasta: false', async () => {
    await expect(isInside(project, '../fora/segredo.txt')).resolves.toBe(false);
    await expect(isInside(project, 'src/../../fora/segredo.txt')).resolves.toBe(false);
  });

  it('caminho absoluto: false', async () => {
    await expect(isInside(project, join(outside, 'segredo.txt'))).resolves.toBe(false);
  });

  it('link simbólico que aponta para fora: false, também para arquivo que não existe lá', async ({
    skip,
  }) => {
    try {
      // `junction` não pede privilégio de administrador no Windows; nos outros sistemas vira link comum.
      await symlink(outside, join(project, 'atalho'), 'junction');
    } catch {
      // Sem permissão para criar link neste ambiente: o teste vira "pulado" no relatório, em vez de passar em
      // branco. O teste com o `realpath` injetado, mais abaixo, cobre a lógica.
      skip('sem permissão para criar link neste ambiente');
    }

    await expect(isInside(project, 'atalho/segredo.txt')).resolves.toBe(false);
    await expect(isInside(project, 'atalho/novo.txt')).resolves.toBe(false);
  });

  it('link simbólico que aponta para dentro da pasta: true', async ({ skip }) => {
    try {
      await symlink(join(project, 'src'), join(project, 'apelido'), 'junction');
    } catch {
      skip('sem permissão para criar link neste ambiente');
    }

    await expect(isInside(project, 'apelido/a.ts')).resolves.toBe(true);
  });

  it('com o realpath injetado: o link resolvido para fora é recusado', async () => {
    const fake = createIsInsideProject((path) =>
      path.endsWith('atalho') ? Promise.resolve('/fora/destino') : Promise.resolve(path),
    );

    await expect(fake('/raiz/projeto', 'atalho')).resolves.toBe(false);
    await expect(fake('/raiz/projeto', 'src')).resolves.toBe(true);
  });

  it('erro que não é "não existe" (permissão) é registrado e conta como fora', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const denied = createIsInsideProject(() =>
      Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
    );

    await expect(denied('/raiz/projeto', 'a.ts')).resolves.toBe(false);

    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
