import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { openDatabase } from '@project-hub/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectServices, platformOf, type ProjectServices } from '../src/main/composition';
import { handleAddProject, handleListProjects } from '../src/main/ipc/projects';

// Fluxo real: SQLite num arquivo temporário e pastas de verdade. Só o seletor de pasta fica de fora.

let dir: string;
let folder: string;
let services: ProjectServices;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-flow-'));
  // Espaços e acentos no nome, como a pasta real do projeto.
  folder = join(dir, 'Claude Code Projetos', 'Ação Hub');
  mkdirSync(folder, { recursive: true });
  services = createProjectServices({
    dbFile: join(dir, 'database', 'project-hub.sqlite'),
    platform: platformOf(process.platform),
  });
});

afterEach(() => {
  services.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('cadastro e listagem com banco e pastas reais', () => {
  it('cadastra uma pasta real e a listagem a mostra disponível, sem campos internos', async () => {
    const added = await handleAddProject(services, { path: folder });

    expect(added).toEqual({
      ok: true,
      data: {
        id: expect.any(String),
        name: 'Ação Hub',
        path: folder,
        // O detector de Git é um stub até a Tarefa 7 (R3): toda pasta entra como sem Git.
        repositoryKind: 'none',
        available: true,
      },
    });
    expect(await handleListProjects(services)).toEqual({
      ok: true,
      data: [expect.objectContaining({ name: 'Ação Hub', path: folder, available: true })],
    });
  });

  it('a mesma pasta com barra final é recusada como já cadastrada', async () => {
    await handleAddProject(services, { path: folder });

    const again = await handleAddProject(services, { path: folder + sep });

    expect(again).toMatchObject({ ok: false, error: { code: 'PROJECT_ALREADY_EXISTS' } });
  });

  it('caminho relativo é recusado antes de qualquer gravação', async () => {
    const result = await handleAddProject(services, { path: 'Ação Hub' });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(await handleListProjects(services)).toEqual({ ok: true, data: [] });
  });

  it('pasta que some do disco continua na lista, como indisponível', async () => {
    await handleAddProject(services, { path: folder });
    rmSync(folder, { recursive: true, force: true });

    expect(await handleListProjects(services)).toEqual({
      ok: true,
      data: [expect.objectContaining({ name: 'Ação Hub', available: false })],
    });
  });

  it('migração que falha fecha o banco, e a pasta do arquivo pode ser removida depois', () => {
    const legacyDir = join(dir, 'legado');
    mkdirSync(legacyDir, { recursive: true });
    const legacyFile = join(legacyDir, 'project-hub.sqlite');
    // Banco de uma versão anterior, com um índice do mesmo nome que a migração cria: a migração falha.
    const legacy = openDatabase(legacyFile);
    legacy.$client.exec(
      'CREATE TABLE legado (x TEXT); CREATE INDEX projects_normalized_path_unique ON legado (x);',
    );
    legacy.$client.close();

    expect(() =>
      createProjectServices({ dbFile: legacyFile, platform: platformOf(process.platform) }),
    ).toThrow(/CREATE UNIQUE INDEX/);
    // No Windows, um arquivo com handle aberto não pode ser apagado: a remoção só passa se o banco fechou.
    // Esta asserção só distingue o fechamento no Windows: em Linux e macOS, apagar arquivo aberto passa de qualquer jeito.
    expect(() => rmSync(legacyDir, { recursive: true, force: true })).not.toThrow();
    expect(existsSync(legacyDir)).toBe(false);
  });

  it('projeto removido volta pelo mesmo registro quando a pasta é cadastrada de novo', async () => {
    const first = await handleAddProject(services, { path: folder });
    if (!first.ok) throw new Error('o cadastro inicial deveria dar certo');
    services.repo.markRemoved(first.data.id, '2026-10-19T13:00:00.000Z');
    expect(await handleListProjects(services)).toEqual({ ok: true, data: [] });

    const second = await handleAddProject(services, { path: folder });

    expect(second).toMatchObject({ ok: true, data: { id: first.data.id } });
    expect(await handleListProjects(services)).toEqual({
      ok: true,
      data: [expect.objectContaining({ id: first.data.id })],
    });
  });
});
