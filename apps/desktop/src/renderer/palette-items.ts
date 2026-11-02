import type { NavigateFunction } from 'react-router';
import type { ProjectSummary } from '@project-hub/contracts';
import {
  CircleDot,
  Folder,
  FolderPlus,
  House,
  PanelLeft,
  PanelRight,
  Plus,
  UserPen,
} from './components/Icon';
import type { ItemComando } from './components/PaletaComandos';
import { boardStatusLabel, statusTone } from './mission-text';
import type { SidebarData } from './overview-data';
import { ADD_PROJECT_REQUEST_EVENT } from './projects-events';
import { TOGGLE_RIGHT_PANEL_EVENT } from './right-panel-events';
import { EDIT_NAME_PARAM, missionPath, projectPath, ROUTE_PATHS } from './routes';
import { TOGGLE_SIDEBAR_EVENT } from './sidebar-events';

/** "1 missão", "3 missões"; sem missão, nada. */
function contagemDeMissoes(total: number): string | null {
  if (total === 0) return null;
  return total === 1 ? '1 missão' : `${total} missões`;
}

/** O motivo de o projeto não poder receber missão, ou `undefined` quando pode. */
function motivoSemMissao(project: ProjectSummary): string | undefined {
  if (!project.available) return 'Pasta indisponível: ela pode ter sido movida ou apagada.';
  if (project.repositoryKind !== 'git') {
    return 'Sem Git: missões precisam de um repositório. Rode git init na pasta.';
  }
  return undefined;
}

/**
 * Itens da paleta de comandos (Ctrl+K), a partir da barra lateral: cada projeto, cada missão e as ações (Ir
 * para Início, Alterar meu nome, Adicionar projeto e Nova missão). Os itens só levam a telas ou pedem o fluxo
 * que a tela já tem (o seletor de pasta da lateral, o formulário de missão do projeto) e não mudam dado
 * nenhum: uma ação de missão daqui pularia a confirmação e as aprovações que as telas já pedem.
 *
 * "Nova missão…" é um passo: escolhê-lo troca a lista pelos projetos. Buscando, cada "Nova missão em
 * {projeto}" também aparece direto, para quem já digitou o nome do projeto.
 */
export function buildPaletteItems(sidebar: SidebarData, navigate: NavigateFunction): ItemComando[] {
  const novaMissaoEm = (project: ProjectSummary) => () =>
    navigate(projectPath(project.id), { state: { newMission: true } });

  const projetos: ItemComando[] = sidebar.projects.map((project) => {
    const total = (sidebar.missionsByProject[project.id] ?? []).length;
    const partes = ['Projeto', project.defaultBranch, contagemDeMissoes(total)].filter(
      (parte): parte is string => parte !== undefined && parte !== null,
    );
    return {
      id: `projeto:${project.id}`,
      rotulo: project.name,
      grupo: 'Projetos',
      icone: Folder,
      tipo: 'projeto',
      detalhe: partes.join(' · '),
      executar: () => navigate(projectPath(project.id)),
    };
  });

  const missoes: ItemComando[] = sidebar.projects.flatMap((project) =>
    (sidebar.missionsByProject[project.id] ?? []).map((mission) => ({
      id: `missao:${mission.id}`,
      rotulo: mission.title,
      grupo: 'Missões' as const,
      icone: CircleDot,
      tipo: 'missao' as const,
      detalhe: `Missão · ${project.name}`,
      estado: { rotulo: boardStatusLabel(mission.status), tom: statusTone(mission.status) },
      atualizadoEm: mission.updatedAt,
      executar: () => navigate(missionPath(project.id, mission.id)),
    })),
  );

  const escolhaDeProjeto: ItemComando[] = sidebar.projects.map((project) => {
    const motivo = motivoSemMissao(project);
    const total = (sidebar.missionsByProject[project.id] ?? []).length;
    return {
      id: `passo-nova-missao:${project.id}`,
      rotulo: project.name,
      grupo: 'Projetos',
      icone: Folder,
      tipo: 'projeto',
      detalhe:
        motivo ??
        [project.defaultBranch, contagemDeMissoes(total) ?? 'nenhuma missão ainda']
          .filter((parte): parte is string => parte !== undefined)
          .join(' · '),
      ...(motivo === undefined ? {} : { indisponivel: motivo }),
      executar: novaMissaoEm(project),
    };
  });

  const novasMissoes: ItemComando[] = sidebar.projects
    .filter((project) => motivoSemMissao(project) === undefined)
    .map((project) => ({
      id: `nova-missao:${project.id}`,
      rotulo: `Nova missão em ${project.name}`,
      grupo: 'Ações',
      icone: Plus,
      tipo: 'principal',
      detalhe: 'Cria um rascunho, sem gastar cota',
      so: 'buscando',
      executar: novaMissaoEm(project),
    }));

  const acoes: ItemComando[] = [
    ...(sidebar.projects.length === 0
      ? []
      : [
          {
            id: 'acao:nova-missao',
            rotulo: 'Nova missão…',
            grupo: 'Ações' as const,
            icone: Plus,
            tipo: 'principal' as const,
            detalhe: 'Escolha o projeto em seguida',
            passo: {
              rotulo: 'Nova missão',
              placeholder: 'Em qual projeto?',
              itens: escolhaDeProjeto,
            },
            executar: () => {},
          },
        ]),
    {
      id: 'acao:adicionar-projeto',
      rotulo: 'Adicionar projeto',
      grupo: 'Ações',
      icone: FolderPlus,
      tipo: 'acao',
      executar: () => window.dispatchEvent(new Event(ADD_PROJECT_REQUEST_EVENT)),
    },
    {
      id: 'acao:alternar-lateral',
      rotulo: 'Mostrar ou ocultar a barra lateral',
      grupo: 'Ações',
      icone: PanelLeft,
      tipo: 'acao',
      atalho: 'Ctrl B',
      executar: () => window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT)),
    },
    {
      id: 'acao:alternar-painel-direito',
      rotulo: 'Mostrar/Esconder painel direito',
      grupo: 'Ações',
      icone: PanelRight,
      tipo: 'acao',
      atalho: 'Ctrl Alt B',
      executar: () => window.dispatchEvent(new Event(TOGGLE_RIGHT_PANEL_EVENT)),
    },
    {
      id: 'acao:inicio',
      rotulo: 'Ir para Início',
      grupo: 'Ações',
      icone: House,
      tipo: 'acao',
      executar: () => navigate(ROUTE_PATHS.home),
    },
    {
      id: 'acao:alterar-nome',
      rotulo: 'Alterar meu nome',
      grupo: 'Ações',
      icone: UserPen,
      tipo: 'acao',
      executar: () => navigate(`${ROUTE_PATHS.home}?${EDIT_NAME_PARAM}=1`),
    },
    ...novasMissoes,
  ];

  return [...projetos, ...missoes, ...acoes];
}
