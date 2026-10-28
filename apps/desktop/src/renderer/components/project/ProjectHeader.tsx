import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { AppResult, ProjectSummary } from '@project-hub/contracts';
import { PROJECT_TEXT } from '../../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../../projects-events';
import {
  parseProjectView,
  PROJECT_VIEWS,
  projectPanelId,
  VIEW_PARAM,
  type ProjectView,
} from '../../project-views';
import { projectViewPath, ROUTE_PATHS } from '../../routes';
import { ConfirmInline } from '../ConfirmButton';
import { MenuAcoes } from '../MenuAcoes';
import { Tabs, type TabItem } from '../Tabs';

const VIEW_TABS: readonly TabItem<ProjectView>[] = PROJECT_VIEWS.map((view) => ({
  id: view,
  label: PROJECT_TEXT.viewLabel[view],
}));

/** Ação do projeto que espera a confirmação da pessoa. */
type Pending = 'archive' | 'remove';

/**
 * Cabeçalho da aba do projeto, numa linha só: o nome (e o apelido, se houver), a barra de visões, o botão
 * Nova missão e o menu Mais ações (arquivar e remover da lista, ambos com confirmação). A visão ativa vem de
 * `?visao=` na rota; escolher uma aba troca só esse parâmetro. O painel da visão é do chamador: as abas apontam
 * para o `project-panel-<visão>` de cada visão. Arquivar ou remover só sai da tela quando a ação dá certo: falha fica aqui, com a
 * mensagem da API, e o projeto segue como estava.
 */
export function ProjectHeader({
  project,
  onNewMission,
}: {
  project: ProjectSummary;
  onNewMission: () => void;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const view = parseProjectView(params.get(VIEW_PARAM));
  const [pending, setPending] = useState<Pending | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Arquiva ou remove o projeto e volta ao Início, avisando a barra lateral. */
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
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    navigate(ROUTE_PATHS.home);
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
          onChange={(next) => navigate(projectViewPath(project.id, next))}
        />
        <div className="project-header__actions">
          <button type="button" className="btn-primary" onClick={onNewMission}>
            {PROJECT_TEXT.newMission}
          </button>
          <MenuAcoes
            rotulo={PROJECT_TEXT.moreActions}
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
            ]}
          />
        </div>
      </div>
      {pending === 'archive' ? (
        <ConfirmInline
          focusBack
          question={PROJECT_TEXT.archiveQuestion}
          confirmLabel={PROJECT_TEXT.archiveConfirm}
          disabled={leaving}
          onConfirm={() => void leaveList(() => window.projectHub.projects.archive(project.id))}
          onCancel={() => setPending(null)}
        />
      ) : null}
      {pending === 'remove' ? (
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
