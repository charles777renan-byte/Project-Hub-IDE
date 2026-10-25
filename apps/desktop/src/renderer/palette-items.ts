import type { NavigateFunction } from 'react-router';
import type { ItemComando } from './components/PaletaComandos';
import type { SidebarData } from './overview-data';
import { missionPath, NAV_ITEMS, projectPath } from './routes';

/**
 * Itens da paleta de comandos (Ctrl+K), a partir da barra lateral: cada projeto, cada missão e a navegação
 * principal. Os itens só levam a telas e não mudam dado nenhum: uma ação de missão daqui pularia a
 * confirmação e as aprovações que as telas já pedem.
 */
export function buildPaletteItems(sidebar: SidebarData, navigate: NavigateFunction): ItemComando[] {
  const projetos: ItemComando[] = sidebar.projects.map((project) => ({
    id: `projeto:${project.id}`,
    rotulo: project.name,
    grupo: 'Projetos',
    executar: () => navigate(projectPath(project.id)),
  }));

  const missoes: ItemComando[] = sidebar.projects.flatMap((project) =>
    (sidebar.missionsByProject[project.id] ?? []).map((mission) => ({
      id: `missao:${mission.id}`,
      rotulo: mission.title,
      grupo: 'Missões',
      executar: () => navigate(missionPath(project.id, mission.id)),
    })),
  );

  const acoes: ItemComando[] = NAV_ITEMS.map((item) => ({
    id: `acao:${item.to}`,
    rotulo: `Ir para ${item.label}`,
    grupo: 'Ações',
    executar: () => navigate(item.to),
  }));

  return [...projetos, ...missoes, ...acoes];
}
