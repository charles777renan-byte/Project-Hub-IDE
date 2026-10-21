import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  archiveProject,
  listArchivedProjects,
  removeProject,
  unarchiveProject,
} from '@project-hub/application';
import { openDatabase } from '@project-hub/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppServices, platformOf, type AppServices } from '../src/main/composition';
import {
  handleAddProject,
  handleListProjects,
  handleProjectLifecycle,
} from '../src/main/ipc/projects';

// Fluxo real: SQLite num arquivo temporário, pastas de verdade e o Git do sistema. Só o seletor de
// pasta fica de fora.

let dir: string;
let folder: string;
let services: AppServices;

/** Torna a pasta um repositório Git, sem commits: basta para a detecção. */
function gitInit(path: string): void {
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: path, stdio: 'ignore' });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-flow-'));
  // Espaços e acentos no nome, como a pasta real do projeto.
  folder = join(dir, 'Claude Code Projetos', 'Ação Hub');
  mkdirSync(folder, { recursive: true });
  services = createAppServices({
    dbFile: join(dir, 'database', 'project-hub.sqlite'),
    platform: platformOf(process.platform),
    worktreesRoot: join(dir, 'worktrees'),
    publishMissionEvent: () => undefined,
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
        // Pasta comum, na pasta temporária do sistema e fora de qualquer repositório: sem Git.
        repositoryKind: 'none',
        available: true,
      },
    });
    expect(await handleListProjects(services)).toEqual({
      ok: true,
      data: [expect.objectContaining({ name: 'Ação Hub', path: folder, available: true })],
    });
  });

  it('pasta com Git entra como git, e a branch padrão fica no registro', async () => {
    gitInit(folder);

    const added = await handleAddProject(services, { path: folder });

    expect(added).toMatchObject({ ok: true, data: { name: 'Ação Hub', repositoryKind: 'git' } });
    if (!added.ok) throw new Error('o cadastro deveria dar certo');
    expect(services.repo.get(added.data.id)).toMatchObject({
      repositoryKind: 'git',
      defaultBranch: 'main',
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
      createAppServices({
        dbFile: legacyFile,
        platform: platformOf(process.platform),
        worktreesRoot: join(dir, 'worktrees'),
        publishMissionEvent: () => undefined,
      }),
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

  it('projeto removido volta como git quando a pasta ganhou Git enquanto estava fora', async () => {
    const first = await handleAddProject(services, { path: folder });
    if (!first.ok) throw new Error('o cadastro inicial deveria dar certo');
    expect(first.data.repositoryKind).toBe('none');
    services.repo.markRemoved(first.data.id, '2026-10-19T13:00:00.000Z');
    gitInit(folder);

    const second = await handleAddProject(services, { path: folder });

    expect(second).toMatchObject({ ok: true, data: { id: first.data.id, repositoryKind: 'git' } });
    expect(services.repo.get(first.data.id)).toMatchObject({
      repositoryKind: 'git',
      defaultBranch: 'main',
    });
    expect(services.repo.get(first.data.id)).not.toHaveProperty('removedAt');
  });
});

describe('arquivar, desarquivar e remover com banco e pastas reais', () => {
  it('arquiva, lista os arquivados e desarquiva; a pasta segue no disco o tempo todo', async () => {
    const added = await handleAddProject(services, { path: folder });
    if (!added.ok) throw new Error('o cadastro deveria dar certo');
    const { id } = added.data;

    expect(handleProjectLifecycle(archiveProject, services.lifecycle, { projectId: id })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await handleListProjects(services)).toEqual({ ok: true, data: [] });
    expect(await listArchivedProjects(services.lifecycle)).toEqual({
      ok: true,
      data: [expect.objectContaining({ id, available: true })],
    });
    expect(existsSync(folder)).toBe(true);

    expect(handleProjectLifecycle(unarchiveProject, services.lifecycle, { projectId: id })).toEqual(
      { ok: true, data: undefined },
    );
    expect(await handleListProjects(services)).toEqual({
      ok: true,
      data: [expect.objectContaining({ id })],
    });
  });

  it('projeto com missão na fila não é arquivado, e a missão segue no banco', async () => {
    const added = await handleAddProject(services, { path: folder });
    if (!added.ok) throw new Error('o cadastro deveria dar certo');
    const { id } = added.data;
    const now = '2026-10-21T09:00:00.000Z';
    services.missions.createDeps.repo.insertMission({
      id: 'm-fila',
      projectId: id,
      title: 'Na fila',
      objective: 'Objetivo',
      acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Critério' }],
      status: 'queued',
      priority: 'normal',
      agentProfileId: 'simulado',
      executionProfileId: 'padrao',
      altersCode: false,
      createdAt: now,
      updatedAt: now,
    });

    expect(
      handleProjectLifecycle(archiveProject, services.lifecycle, { projectId: id }),
    ).toMatchObject({ ok: false, error: { code: 'MISSION_INVALID_STATE' } });
    expect(await handleListProjects(services)).toMatchObject({
      ok: true,
      data: [expect.objectContaining({ id })],
    });
    expect(services.missions.queryDeps.repo.getMission('m-fila')).toMatchObject({
      status: 'queued',
    });
  });

  it('remover tira o projeto da lista e dos arquivados sem apagar a pasta; cadastrar de novo traz o mesmo', async () => {
    const added = await handleAddProject(services, { path: folder });
    if (!added.ok) throw new Error('o cadastro deveria dar certo');
    const { id } = added.data;
    handleProjectLifecycle(archiveProject, services.lifecycle, { projectId: id });

    expect(handleProjectLifecycle(removeProject, services.lifecycle, { projectId: id })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await handleListProjects(services)).toEqual({ ok: true, data: [] });
    expect(await listArchivedProjects(services.lifecycle)).toEqual({ ok: true, data: [] });
    expect(existsSync(folder)).toBe(true);

    expect(await handleAddProject(services, { path: folder })).toMatchObject({
      ok: true,
      data: { id },
    });
  });
});
