import { useCallback, useEffect, useState } from 'react';
import type { ProjectSummary } from '@project-hub/contracts';
import { PathText } from '../components/PathText';
import { ProjectCard } from '../components/ProjectCard';
import { PROJECTS_CHANGED_EVENT } from '../projects-events';

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; projects: ProjectSummary[]; archived: ProjectSummary[] }
  | { status: 'error'; message: string };

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

/**
 * Catálogo de projetos (seção 10.4): lista os cadastrados, adiciona uma pasta pelo seletor e mostra os
 * arquivados, que voltam para a lista com "Restaurar". Toda falha vem como mensagem da API ou, se a
 * chamada ao processo principal quebrar, como mensagem geral.
 */
export function ProjectsPage() {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // A lista vem sempre do processo principal: depois de cada cadastro, a página pede tudo de novo.
  const loadProjects = useCallback(async () => {
    try {
      const [active, archived] = await Promise.all([
        window.projectHub.projects.list(),
        window.projectHub.projects.listArchived(),
      ]);
      if (!active.ok) {
        setList({ status: 'error', message: active.error.message });
        return;
      }
      if (!archived.ok) {
        setList({ status: 'error', message: archived.error.message });
        return;
      }
      setList({ status: 'ready', projects: active.data, archived: archived.data });
    } catch {
      setList({ status: 'error', message: GENERIC_ERROR });
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function addFolder() {
    setAdding(true);
    setActionError(null);
    try {
      const chosen = await window.projectHub.projects.chooseDirectory();
      if (!chosen.ok) {
        setActionError(chosen.error.message);
        return;
      }
      if (chosen.data === null) return;

      const added = await window.projectHub.projects.add({ path: chosen.data.path });
      if (!added.ok) {
        setActionError(added.error.message);
        return;
      }
      await loadProjects();
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    } catch {
      setActionError(GENERIC_ERROR);
    } finally {
      setAdding(false);
    }
  }

  async function restoreProject(projectId: string) {
    setActionError(null);
    try {
      const result = await window.projectHub.projects.unarchive(projectId);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
    } catch {
      setActionError(GENERIC_ERROR);
      return;
    }
    await loadProjects();
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  }

  return (
    <>
      <h1>Projetos</h1>
      <p>
        <button type="button" onClick={() => void addFolder()} disabled={adding}>
          Adicionar projeto
        </button>
      </p>
      {actionError === null ? null : (
        <p role="alert" className="page-alert">
          {actionError}
        </p>
      )}
      {renderList(list, (projectId) => void restoreProject(projectId))}
    </>
  );
}

function renderList(list: ListState, onRestore: (projectId: string) => void) {
  if (list.status === 'loading') {
    return <p role="status">Carregando projetos…</p>;
  }
  if (list.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {list.message}
      </p>
    );
  }
  return (
    <>
      {list.projects.length === 0 ? (
        <p>Nenhum projeto ainda. Adicione uma pasta para começar.</p>
      ) : (
        <ul aria-label="Projetos cadastrados" className="project-list">
          {list.projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
      {list.archived.length === 0 ? null : (
        <section className="archived-projects" aria-labelledby="archived-projects-title">
          <h2 id="archived-projects-title">Arquivados</h2>
          <ul aria-label="Projetos arquivados" className="archived-list">
            {list.archived.map((project) => (
              <li key={project.id}>
                <span className="archived-list__name">{project.name}</span>
                <span className="project-path">
                  <PathText path={project.path} />
                </span>
                {project.available ? null : (
                  <span className="project-unavailable">Pasta indisponível</span>
                )}
                <button
                  type="button"
                  aria-label={`Restaurar ${project.name}`}
                  onClick={() => onRestore(project.id)}
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
