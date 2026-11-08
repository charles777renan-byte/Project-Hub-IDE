import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { AppResult, ProjectSummary } from '@project-hub/contracts';
import { PROJECT_TEXT } from '../../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../../projects-events';
import {
  PROJECT_VIEWS,
  projectPanelId,
  projectViewFromParams,
  type ProjectView,
} from '../../project-views';
import { projectViewPath, ROUTE_PATHS } from '../../routes';
import { WORKSPACES_CHANGED_EVENT } from '../../workspaces-events';
import { requestCloseAll, usePaneCount } from '../../workspace/close-all';
import { ConfirmInline } from '../ConfirmButton';
import { MenuAcoes } from '../MenuAcoes';
import { Tabs, type TabItem } from '../Tabs';

const VIEW_TABS: readonly TabItem<ProjectView>[] = PROJECT_VIEWS.map((view) => ({
  id: view,
  label: PROJECT_TEXT.viewLabel[view],
}));

/** Ação do projeto que espera a confirmação da pessoa. */
type Pending = 'archive' | 'remove';

/** Id do aviso de pasta indisponível, que fica na WorkspacePage. Nova missão aponta para ele quando está desabilitado. */
export const PROJECT_UNAVAILABLE_NOTICE_ID = 'aviso-pasta-indisponivel';
/**
 * Id do aviso de projeto sem Git, que fica na visão Missões (ProjectMissions), não na página. Sem Git não há
 * worktree, então não há missão. Fora da visão Missões o botão desabilitado explica pelo título (tooltip).
 */
export const PROJECT_NO_GIT_NOTICE_ID = 'aviso-sem-git';

/**
 * Fecha a aba do workspace do projeto, se ela estiver aberta, para nenhuma aba nem sessão ficar apontando para um
 * projeto que saiu da lista. É o mesmo fechamento da barra superior (`workspaces.close`), seguido do aviso de que a
 * lista de abas mudou. Uma falha aqui não impede o projeto de sair: a aba que sobrar cai no "projeto não encontrado".
 */
async function closeProjectWorkspace(projectId: string) {
  try {
    const listed = await window.projectHub.workspaces.list();
    if (!listed.ok) return;
    const workspace = listed.data.find((item) => item.projectId === projectId);
    if (workspace === undefined) return;
    await window.projectHub.workspaces.close(workspace.id);
    window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT));
  } catch {
    // Sem a API (ou com o canal fora do ar), o projeto sai assim mesmo.
  }
}

/**
 * Cabeçalho da aba do projeto, numa linha só: o nome (e o apelido, se houver), a barra de visões, o botão
 * Nova missão e o menu Mais ações (arquivar e remover da lista, ambos com confirmação, e fechar todos os terminais, que
 * leva ao workspace); com uma missão aberta, os dois somem (a missão tem os seus controles). A visão ativa vem de
 * `?visao=` na rota; escolher uma aba troca só esse parâmetro, substituindo a entrada do histórico (cada seta de
 * aba não empilha um passo). O painel da visão é do chamador: as abas apontam para o `project-panel-<visão>` de cada
 * visão. Arquivar ou remover só sai da tela quando a ação dá certo, e então fecha também a aba do workspace do
 * projeto: falha fica aqui, com a mensagem da API, e o projeto segue como estava. Com a pasta indisponível
 * (`available` false), Nova missão fica desabilitado e aponta para o aviso da WorkspacePage.
 */
export function ProjectHeader({
  project,
  onNewMission,
  missionOpen = false,
}: {
  project: ProjectSummary;
  onNewMission: () => void;
  /** Com uma missão aberta no centro, a visão ativa é Missões, e escolhê-la de novo volta à lista. */
  missionOpen?: boolean;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const view = missionOpen ? 'missoes' : projectViewFromParams(params);
  const unavailable = project.available === false;
  const noGit = project.repositoryKind !== 'git';
  const [pending, setPending] = useState<Pending | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paneCount = usePaneCount(project.id);
  // Fechar todos leva o foco à pergunta do workspace: o menu não o devolve ao botão ao fechar.
  const focusGoesToWorkspace = useRef(false);

  /** Arquiva ou remove o projeto, fecha a aba dele e volta ao Início, avisando a barra lateral. */
  async function leaveList(action: () => Promise<AppResult<unknown>>) {
    setLeaving(true);
    setError(null);
    let ok = false;
    try {
      const result = await action();
      if (result.ok) ok = true;
      else setError(result.error.message);
    } catch {
      setError(PROJECT_TEXT.genericError);
    }
    if (!ok) {
      setLeaving(false);
      return;
    }
    await closeProjectWorkspace(project.id);
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    navigate(ROUTE_PATHS.home);
  }

  /** Leva à visão Terminais, se outra estiver ativa, e pede ao workspace a pergunta de fechar todos. */
  function closeAllTerminals() {
    focusGoesToWorkspace.current = true;
    requestCloseAll(project.id);
    if (view !== 'terminais') navigate(projectViewPath(project.id, 'terminais'), { replace: true });
  }

  return (
    <header className="project-header">
      <div className="project-header__row">
        <div className="project-header__title">
          <h1 title={project.name}>{project.nickname ?? project.name}</h1>
          {project.nickname === undefined ? null : (
            <span className="project-header__name">{project.name}</span>
          )}
        </div>
        <Tabs
          label={PROJECT_TEXT.viewsLabel}
          tabs={VIEW_TABS}
          active={view}
          panelId={projectPanelId}
          onChange={(next) => navigate(projectViewPath(project.id, next), { replace: true })}
          {...(missionOpen
            ? {
                onReselect: (next: ProjectView) =>
                  navigate(projectViewPath(project.id, next), { replace: true }),
              }
            : {})}
        />
        {missionOpen ? null : (
          <div className="project-header__actions">
            <button
              type="button"
              className="btn-primary"
              disabled={unavailable || noGit}
              title={noGit ? PROJECT_TEXT.noGitNotice : undefined}
              aria-describedby={
                unavailable
                  ? PROJECT_UNAVAILABLE_NOTICE_ID
                  : noGit && view === 'missoes'
                    ? PROJECT_NO_GIT_NOTICE_ID
                    : undefined
              }
              onClick={onNewMission}
            >
              {PROJECT_TEXT.newMission}
            </button>
            <MenuAcoes
              rotulo={PROJECT_TEXT.moreActions}
              aoFecharDevolverFoco={(event) => {
                if (!focusGoesToWorkspace.current) return;
                focusGoesToWorkspace.current = false;
                event.preventDefault();
              }}
              acoes={[
                {
                  rotulo: PROJECT_TEXT.archive,
                  desabilitada: leaving,
                  onSelecionar: () => setPending('archive'),
                },
                {
                  rotulo: PROJECT_TEXT.remove,
                  perigosa: true,
                  desabilitada: leaving,
                  onSelecionar: () => setPending('remove'),
                },
                {
                  rotulo: PROJECT_TEXT.closeAllTerminals,
                  perigosa: true,
                  desabilitada: paneCount === 0,
                  ...(paneCount === 0 ? { dica: PROJECT_TEXT.noTerminalOpen } : {}),
                  onSelecionar: closeAllTerminals,
                },
              ]}
            />
          </div>
        )}
      </div>
      {!missionOpen && pending === 'archive' ? (
        <ConfirmInline
          focusBack
          question={PROJECT_TEXT.archiveQuestion}
          confirmLabel={PROJECT_TEXT.archiveConfirm}
          disabled={leaving}
          onConfirm={() => void leaveList(() => window.projectHub.projects.archive(project.id))}
          onCancel={() => setPending(null)}
        />
      ) : null}
      {!missionOpen && pending === 'remove' ? (
        <ConfirmInline
          focusBack
          question={PROJECT_TEXT.removeQuestion}
          confirmLabel={PROJECT_TEXT.removeConfirm}
          disabled={leaving}
          onConfirm={() => void leaveList(() => window.projectHub.projects.remove(project.id))}
          onCancel={() => setPending(null)}
        />
      ) : null}
      {error === null ? null : (
        <p role="alert" className="page-alert">
          {error}
        </p>
      )}
    </header>
  );
}
