import type { MissionDto, ProjectSummary } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { SidebarData } from '../../src/renderer/overview-data';
import { buildPaletteItems } from '../../src/renderer/palette-items';

const PROJETO: ProjectSummary = {
  id: 'p1',
  name: 'app',
  path: 'C:\\app',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

const MISSAO: MissionDto = {
  id: 'm1',
  projectId: 'p1',
  title: 'Ajustar login',
  objective: 'Corrigir o login',
  status: 'planned',
  altersCode: false,
  acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
};

const COM_DADOS: SidebarData = {
  status: 'ready',
  projects: [PROJETO],
  missionsByProject: { p1: [MISSAO] },
};

function itemNamed(items: ReturnType<typeof buildPaletteItems>, rotulo: string) {
  const item = items.find((candidate) => candidate.rotulo === rotulo);
  if (item === undefined) throw new Error(`item "${rotulo}" não existe`);
  return item;
}

describe('buildPaletteItems', () => {
  it('leva cada projeto ao detalhe dele e cada missão à sua tela', () => {
    const navigate = vi.fn();
    const items = buildPaletteItems(COM_DADOS, navigate);

    itemNamed(items, 'app').executar();
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1');

    itemNamed(items, 'Ajustar login').executar();
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1/missions/m1');
  });

  it('põe cada item no grupo certo', () => {
    const items = buildPaletteItems(COM_DADOS, vi.fn());
    expect(itemNamed(items, 'app').grupo).toBe('Projetos');
    expect(itemNamed(items, 'Ajustar login').grupo).toBe('Missões');
    expect(itemNamed(items, 'Ir para Início').grupo).toBe('Ações');
  });

  it('as ações levam à navegação principal', () => {
    const navigate = vi.fn();
    const items = buildPaletteItems(COM_DADOS, navigate);

    itemNamed(items, 'Ir para Início').executar();
    expect(navigate).toHaveBeenLastCalledWith('/');

    itemNamed(items, 'Ir para Projetos').executar();
    expect(navigate).toHaveBeenLastCalledWith('/projects');
  });

  it('enquanto a barra carrega, sobram só as ações', () => {
    const items = buildPaletteItems({ status: 'loading', projects: [], missionsByProject: {} }, vi.fn());
    expect(items.map((item) => item.grupo)).toEqual(['Ações', 'Ações']);
  });

  it('dá um id único a cada item, mesmo quando um projeto e uma missão têm o mesmo nome', () => {
    const items = buildPaletteItems(
      {
        ...COM_DADOS,
        missionsByProject: { p1: [{ ...MISSAO, title: 'app' }] },
      },
      vi.fn(),
    );
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
