import { useCallback, useEffect, useState } from 'react';
import type { ProjectSummary } from '@project-hub/contracts';
import { ProjectCard } from '../components/ProjectCard';
import { PROJECTS_CHANGED_EVENT } from '../use-sidebar-data';

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; projects: ProjectSummary[] }
  | { status: 'error'; message: string };

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

/**
 * Catálogo de projetos (seção 10.4): lista os cadastrados e adiciona uma pasta pelo seletor. Toda
 * falha vem como mensagem da API ou, se a chamada ao processo principal quebrar, como mensagem geral.
 */
export function ProjectsPage() {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // A lista vem sempre do processo principal: depois de cada cadastro, a página pede tudo de novo.
  const loadProjects = useCallback(async () => {
    try {
      const result = await window.projectHub.projects.list();
      setList(
        result.ok
          ? { status: 'ready', projects: result.data }
          : { status: 'error', message: result.error.message },
      );
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
      {renderList(list)}
    </>
  );
}

function renderList(list: ListState) {
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
  if (list.projects.length === 0) {
    return <p>Nenhum projeto ainda. Adicione uma pasta para começar.</p>;
  }
  return (
    <ul aria-label="Projetos cadastrados" className="project-list">
      {list.projects.map((project) => (
        <li key={project.id}>
          <ProjectCard project={project} />
        </li>
      ))}
    </ul>
  );
}
