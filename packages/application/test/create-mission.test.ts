import { describe, expect, it } from 'vitest';
import { createMission, type CreateMissionDeps } from '../src/missions/create-mission';
import { fakeRepository } from './fakes';
import { fakeMissionRepository, type FakeMissionRepository } from './fakes-missions';

const T0 = '2026-10-20T09:00:00.000Z';

function harness(): { repo: FakeMissionRepository; deps: CreateMissionDeps } {
  const repo = fakeMissionRepository();
  const projects = fakeRepository();
  projects.insert({
    id: 'p1',
    name: 'app',
    path: 'C:\\dev\\app',
    normalizedPath: 'c:/dev/app',
    repositoryKind: 'git',
    defaultBranch: 'main',
    createdAt: T0,
  });
  let ids = 0;
  return {
    repo,
    deps: {
      repo,
      projects,
      now: () => T0,
      newId: () => `id-${++ids}`,
    },
  };
}

const VALID = {
  projectId: 'p1',
  title: '  Ajustar login  ',
  objective: 'Corrigir o login',
  acceptanceCriteria: ['Login funciona', '  ', 'Testes passam'],
  altersCode: true,
};

describe('createMission', () => {
  it('cria a missão em draft, com os critérios em ordem e sem linhas vazias', async () => {
    const { repo, deps } = harness();

    const result = await createMission(deps, VALID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('deveria criar');
    expect(result.data).toMatchObject({
      projectId: 'p1',
      title: 'Ajustar login',
      objective: 'Corrigir o login',
      status: 'draft',
      altersCode: true,
      priority: 'normal',
    });
    expect(result.data.acceptanceCriteria.map((c) => [c.position, c.text])).toEqual([
      [1, 'Login funciona'],
      [2, 'Testes passam'],
    ]);
    expect(repo.getMission(result.data.id)?.status).toBe('draft');
  });

  it('grava a auditoria de criação da missão', async () => {
    const { repo, deps } = harness();

    const result = await createMission(deps, VALID);

    if (!result.ok) throw new Error('deveria criar');
    expect(repo.audit()).toEqual([
      expect.objectContaining({
        aggregateType: 'mission',
        aggregateId: result.data.id,
        eventType: 'mission.created',
        actor: 'user',
      }),
    ]);
  });

  it('sem critério de aceite útil, recusa com VALIDATION_FAILED e não grava nada', async () => {
    const { repo, deps } = harness();

    const result = await createMission(deps, { ...VALID, acceptanceCriteria: ['  '] });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(repo.audit()).toHaveLength(0);
  });

  it('título vazio é recusado com VALIDATION_FAILED', async () => {
    const { deps } = harness();

    const result = await createMission(deps, { ...VALID, title: '   ' });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('projeto inexistente retorna PROJECT_NOT_FOUND', async () => {
    const { deps } = harness();

    const result = await createMission(deps, { ...VALID, projectId: 'nao-existe' });

    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
  });
});
