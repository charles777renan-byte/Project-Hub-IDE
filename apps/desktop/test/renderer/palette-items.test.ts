import type { MissionDto, ProjectSummary } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { SidebarData } from '../../src/renderer/overview-data';
import { buildPaletteItems } from '../../src/renderer/palette-items';
import { ADD_PROJECT_REQUEST_EVENT } from '../../src/renderer/projects-events';

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
  it('leva cada projeto à aba dele, na visão das missões, e cada missão à sua tela', () => {
    const navigate = vi.fn();
    const items = buildPaletteItems(COM_DADOS, navigate);

    itemNamed(items, 'app').executar();
    expect(navigate).toHaveBeenLastCalledWith('/workspaces/p1?visao=missoes');

    itemNamed(items, 'Ajustar login').executar();
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1/missions/m1');
  });

  it('põe cada item no grupo certo', () => {
    const items = buildPaletteItems(COM_DADOS, vi.fn());
    expect(itemNamed(items, 'app').grupo).toBe('Projetos');
    expect(itemNamed(items, 'Ajustar login').grupo).toBe('Missões');
    expect(itemNamed(items, 'Ir para Início').grupo).toBe('Ações');
  });

  it('Ir para Início leva à raiz, e não há mais "Ir para Projetos"', () => {
    const navigate = vi.fn();
    const items = buildPaletteItems(COM_DADOS, navigate);

    itemNamed(items, 'Ir para Início').executar();
    expect(navigate).toHaveBeenLastCalledWith('/');
    expect(items.some((item) => item.rotulo === 'Ir para Projetos')).toBe(false);
  });

  it('Alterar meu nome leva ao Início com o pedido de edição do nome', () => {
    const navigate = vi.fn();
    const items = buildPaletteItems(COM_DADOS, navigate);

    const item = itemNamed(items, 'Alterar meu nome');
    expect(item.grupo).toBe('Ações');
    item.executar();
    expect(navigate).toHaveBeenLastCalledWith('/?editar-nome=1');
  });

  it('Adicionar projeto pede à lateral que abra o seletor, sem navegar', () => {
    const navigate = vi.fn();
    const items = buildPaletteItems(COM_DADOS, navigate);
    const pedido = vi.fn();
    window.addEventListener(ADD_PROJECT_REQUEST_EVENT, pedido);
    try {
      const item = itemNamed(items, 'Adicionar projeto');
      expect(item.grupo).toBe('Ações');
      item.executar();
    } finally {
      window.removeEventListener(ADD_PROJECT_REQUEST_EVENT, pedido);
    }
    expect(pedido).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('tem "Nova missão em {projeto}" para cada projeto, levando ao projeto com o formulário pedido', () => {
    const navigate = vi.fn();
    const outro: ProjectSummary = { ...PROJETO, id: 'p2', name: 'site' };
    const items = buildPaletteItems(
      { ...COM_DADOS, projects: [PROJETO, outro], missionsByProject: {} },
      navigate,
    );

    const item = itemNamed(items, 'Nova missão em app');
    expect(item.grupo).toBe('Ações');
    item.executar();
    expect(navigate).toHaveBeenLastCalledWith('/workspaces/p1?visao=missoes', {
      state: { newMission: true },
    });

    itemNamed(items, 'Nova missão em site').executar();
    expect(navigate).toHaveBeenLastCalledWith('/workspaces/p2?visao=missoes', {
      state: { newMission: true },
    });
  });

  it('enquanto a barra carrega, sobram só as ações que não dependem de projeto', () => {
    const items = buildPaletteItems(
      { status: 'loading', projects: [], missionsByProject: {} },
      vi.fn(),
    );
    expect(items.map((item) => item.rotulo)).toEqual([
      'Ir para Início',
      'Alterar meu nome',
      'Adicionar projeto',
    ]);
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
