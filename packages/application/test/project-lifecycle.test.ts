import { describe, expect, it } from 'vitest';
import type { Mission } from '@project-hub/domain';
import { addProject } from '../src/projects/add-project';
import {
  archiveProject,
  listArchivedProjects,
  removeProject,
  setProjectGroup,
  setProjectNickname,
  unarchiveProject,
  type ProjectLifecycleDeps,
} from '../src/projects/project-lifecycle';
import { listProjects } from '../src/projects/list-projects';
import { fakeFileSystem, fakeGit, fakeRepository } from './fakes';
import { fakeMissionRepository, type FakeMissionRepository } from './fakes-missions';

const T0 = '2026-10-19T10:00:00.000Z';
const NOW = '2026-10-21T09:00:00.000Z';
const APP_PATH = 'C:\\Projetos\\app';

function mission(status: Mission['status']): Mission {
  return {
    id: `m-${status}`,
    projectId: 'p1',
    title: 'Missão',
    objective: 'Objetivo',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Critério' }],
    status,
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: true,
    createdAt: T0,
    updatedAt: T0,
  };
}

function harness(directories: readonly string[] = [APP_PATH]): {
  repo: ReturnType<typeof fakeRepository>;
  missions: FakeMissionRepository;
  fs: ReturnType<typeof fakeFileSystem>;
  deps: ProjectLifecycleDeps;
} {
  const repo = fakeRepository();
  const missions = fakeMissionRepository();
  repo.insert({
    id: 'p1',
    name: 'app',
    path: APP_PATH,
    normalizedPath: 'c:\\projetos\\app',
    repositoryKind: 'git',
    createdAt: T0,
  });
  const fs = fakeFileSystem(directories, { caseInsensitive: true });
  return { repo, missions, fs, deps: { repo, missions, fs, now: () => NOW } };
}

describe('archiveProject', () => {
  it('arquiva: o projeto sai da lista e vai para os arquivados, com a pasta intacta', async () => {
    const { deps, fs } = harness();

    expect(archiveProject(deps, { projectId: 'p1' })).toEqual({ ok: true, data: undefined });

    expect(await listProjects({ repo: deps.repo, fs })).toEqual({ ok: true, data: [] });
    expect(await listArchivedProjects({ repo: deps.repo, fs })).toEqual({
      ok: true,
      data: [expect.objectContaining({ id: 'p1', available: true })],
    });
    expect(await fs.isDirectory(APP_PATH)).toBe(true);
  });

  it('projeto inexistente ou já arquivado rejeita com PROJECT_NOT_FOUND', () => {
    const { deps } = harness();
    archiveProject(deps, { projectId: 'p1' });

    expect(archiveProject(deps, { projectId: 'p1' })).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
    expect(archiveProject(deps, { projectId: 'nao-existe' })).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });

  it.each(['queued', 'running', 'waiting_approval', 'waiting_input', 'paused'] as const)(
    'missão em %s bloqueia o arquivamento e o projeto continua na lista',
    async (status) => {
      const { deps, missions, fs } = harness();
      missions.insertMission(mission(status));

      expect(archiveProject(deps, { projectId: 'p1' })).toMatchObject({
        ok: false,
        error: { code: 'MISSION_INVALID_STATE' },
      });
      expect(await listProjects({ repo: deps.repo, fs })).toMatchObject({
        ok: true,
        data: [expect.objectContaining({ id: 'p1' })],
      });
    },
  );

  it.each(['draft', 'planned', 'succeeded', 'failed', 'cancelled'] as const)(
    'missão em %s não bloqueia o arquivamento',
    (status) => {
      const { deps, missions } = harness();
      missions.insertMission(mission(status));

      expect(archiveProject(deps, { projectId: 'p1' })).toEqual({ ok: true, data: undefined });
    },
  );
});

describe('unarchiveProject', () => {
  it('desarquiva: o projeto volta para a lista principal', async () => {
    const { deps, fs } = harness();
    archiveProject(deps, { projectId: 'p1' });

    expect(unarchiveProject(deps, { projectId: 'p1' })).toEqual({ ok: true, data: undefined });

    expect(await listProjects({ repo: deps.repo, fs })).toMatchObject({
      ok: true,
      data: [expect.objectContaining({ id: 'p1' })],
    });
    expect(await listArchivedProjects({ repo: deps.repo, fs })).toEqual({ ok: true, data: [] });
  });

  it('projeto que não está arquivado rejeita com PROJECT_NOT_FOUND', () => {
    const { deps } = harness();

    expect(unarchiveProject(deps, { projectId: 'p1' })).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });
});

describe('removeProject', () => {
  it('remove da lista sem tocar na pasta', async () => {
    const { deps, fs } = harness();

    expect(removeProject(deps, { projectId: 'p1' })).toEqual({ ok: true, data: undefined });

    expect(await listProjects({ repo: deps.repo, fs })).toEqual({ ok: true, data: [] });
    expect(await fs.isDirectory(APP_PATH)).toBe(true);
  });

  it('projeto arquivado também pode ser removido, e então some dos arquivados', async () => {
    const { deps, fs } = harness();
    archiveProject(deps, { projectId: 'p1' });

    expect(removeProject(deps, { projectId: 'p1' })).toEqual({ ok: true, data: undefined });

    expect(await listArchivedProjects({ repo: deps.repo, fs })).toEqual({ ok: true, data: [] });
    expect(deps.repo.get('p1')?.removedAt).toBe(NOW);
  });

  it('missão em andamento bloqueia a remoção', () => {
    const { deps, missions } = harness();
    missions.insertMission(mission('running'));

    expect(removeProject(deps, { projectId: 'p1' })).toMatchObject({
      ok: false,
      error: { code: 'MISSION_INVALID_STATE' },
    });
  });

  it('projeto já removido rejeita com PROJECT_NOT_FOUND', () => {
    const { deps } = harness();
    removeProject(deps, { projectId: 'p1' });

    expect(removeProject(deps, { projectId: 'p1' })).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });
});

describe('listArchivedProjects', () => {
  it('pasta sumida aparece arquivada e indisponível', async () => {
    const { deps } = harness([]);
    archiveProject(deps, { projectId: 'p1' });

    expect(await listArchivedProjects({ repo: deps.repo, fs: deps.fs })).toEqual({
      ok: true,
      data: [expect.objectContaining({ id: 'p1', available: false })],
    });
  });
});

describe('cadastro de pasta arquivada', () => {
  it('cadastrar a mesma pasta de novo traz o projeto de volta, sem inserir outro registro', async () => {
    const { repo, deps, fs } = harness();
    archiveProject(deps, { projectId: 'p1' });

    const result = await addProject(
      {
        repo,
        git: fakeGit({ kind: 'git', defaultBranch: 'main' }),
        fs,
        platform: 'win32',
        now: () => NOW,
        newId: () => 'id-novo',
      },
      { path: APP_PATH },
    );

    expect(result).toMatchObject({ ok: true, data: { id: 'p1' } });
    expect(repo.records()).toHaveLength(1);
    expect(await listProjects({ repo: deps.repo, fs })).toMatchObject({
      ok: true,
      data: [expect.objectContaining({ id: 'p1' })],
    });
    expect(await listArchivedProjects({ repo: deps.repo, fs })).toEqual({ ok: true, data: [] });
  });
});

describe('setProjectGroup', () => {
  it('põe o projeto no grupo, com o nome aparado, e o resumo traz o grupo', async () => {
    const { deps, repo, fs } = harness();

    expect(setProjectGroup(deps, { projectId: 'p1', group: '  Trabalho  ' })).toEqual({
      ok: true,
      data: undefined,
    });

    expect(repo.get('p1')).toMatchObject({ groupName: 'Trabalho', updatedAt: NOW });
    const listed = await listProjects({ repo, fs });
    expect(listed).toMatchObject({ ok: true, data: [{ id: 'p1', group: 'Trabalho' }] });
  });

  it('null ou texto vazio tira o projeto do grupo', () => {
    const { deps, repo } = harness();
    setProjectGroup(deps, { projectId: 'p1', group: 'Pessoal' });

    setProjectGroup(deps, { projectId: 'p1', group: '   ' });

    expect(repo.get('p1')?.groupName).toBeUndefined();
    setProjectGroup(deps, { projectId: 'p1', group: 'Pessoal' });
    setProjectGroup(deps, { projectId: 'p1', group: null });
    expect(repo.get('p1')?.groupName).toBeUndefined();
  });

  it('recusa nome com mais de 40 caracteres e projeto que não está na lista', () => {
    const { deps, repo } = harness();

    expect(setProjectGroup(deps, { projectId: 'p1', group: 'x'.repeat(41) })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(setProjectGroup(deps, { projectId: 'nao-existe', group: 'Trabalho' })).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
    expect(repo.get('p1')?.groupName).toBeUndefined();
  });
});

describe('setProjectNickname', () => {
  it('dá o apelido ao projeto, com o texto aparado, e o resumo traz o apelido', async () => {
    const { deps, repo, fs } = harness();

    expect(setProjectNickname(deps, { projectId: 'p1', nickname: '  Hub  ' })).toEqual({
      ok: true,
      data: undefined,
    });

    expect(repo.get('p1')).toMatchObject({ nickname: 'Hub', updatedAt: NOW });
    const listed = await listProjects({ repo, fs });
    expect(listed).toMatchObject({ ok: true, data: [{ id: 'p1', nickname: 'Hub' }] });
  });

  it('aceita 24 caracteres e recusa 25', () => {
    const { deps, repo } = harness();

    expect(setProjectNickname(deps, { projectId: 'p1', nickname: 'x'.repeat(24) })).toMatchObject({
      ok: true,
    });
    expect(setProjectNickname(deps, { projectId: 'p1', nickname: 'y'.repeat(25) })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O apelido pode ter até 24 caracteres.' },
    });
    expect(repo.get('p1')?.nickname).toBe('x'.repeat(24));
  });

  it('null ou texto vazio remove o apelido', () => {
    const { deps, repo } = harness();
    setProjectNickname(deps, { projectId: 'p1', nickname: 'Hub' });

    setProjectNickname(deps, { projectId: 'p1', nickname: '   ' });

    expect(repo.get('p1')?.nickname).toBeUndefined();
    setProjectNickname(deps, { projectId: 'p1', nickname: 'Hub' });
    setProjectNickname(deps, { projectId: 'p1', nickname: null });
    expect(repo.get('p1')?.nickname).toBeUndefined();
  });

  it('recusa projeto que não está na lista', () => {
    const { deps } = harness();

    expect(setProjectNickname(deps, { projectId: 'nao-existe', nickname: 'Hub' })).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });
});
