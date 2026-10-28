import type { NavigateFunction } from 'react-router';
import type { ItemComando } from './components/PaletaComandos';
import type { SidebarData } from './overview-data';
import { ADD_PROJECT_REQUEST_EVENT } from './projects-events';
import { missionPath, projectPath, ROUTE_PATHS } from './routes';

/**
 * Itens da paleta de comandos (Ctrl+K), a partir da barra lateral: cada projeto, cada missão e as ações (Ir
 * para Início, Adicionar projeto e Nova missão em cada projeto). Os itens só levam a telas ou pedem o fluxo
 * que a tela já tem (o seletor de pasta da lateral, o formulário de missão do projeto) e não mudam dado
 * nenhum: uma ação de missão daqui pularia a confirmação e as aprovações que as telas já pedem.
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

  const novasMissoes: ItemComando[] = sidebar.projects.map((project) => ({
    id: `nova-missao:${project.id}`,
    rotulo: `Nova missão em ${project.name}`,
    grupo: 'Ações',
    executar: () => navigate(projectPath(project.id), { state: { newMission: true } }),
  }));

  const acoes: ItemComando[] = [
    {
      id: 'acao:inicio',
      rotulo: 'Ir para Início',
      grupo: 'Ações',
      executar: () => navigate(ROUTE_PATHS.home),
    },
    {
      id: 'acao:adicionar-projeto',
      rotulo: 'Adicionar projeto',
      grupo: 'Ações',
      executar: () => window.dispatchEvent(new Event(ADD_PROJECT_REQUEST_EVENT)),
    },
    ...novasMissoes,
  ];

  return [...projetos, ...missoes, ...acoes];
}
