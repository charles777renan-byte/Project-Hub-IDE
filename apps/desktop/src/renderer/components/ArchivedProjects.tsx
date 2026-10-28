import { useId, useState, type Ref } from 'react';
import type { ProjectSummary } from '@project-hub/contracts';
import { ChevronRight, ICON_PROPS } from './Icon';

/**
 * Seção recolhível "Arquivados", no fim da barra lateral: cada projeto arquivado com o aviso de pasta
 * indisponível, quando for o caso, e o botão Restaurar (o nome do projeto vai no nome acessível). Começa
 * recolhida e, sem arquivados, nem existe. O caminho inteiro fica na dica do nome. `toggleRef` dá ao dono da
 * barra o botão da seção, para devolver o foco a ele depois de um Restaurar.
 */
export function ArchivedProjects({
  projects,
  onRestore,
  toggleRef,
}: {
  projects: readonly ProjectSummary[];
  onRestore: (projectId: string) => void;
  toggleRef?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (projects.length === 0) return null;
  return (
    <section className="sidebar__archived">
      <button
        ref={toggleRef}
        type="button"
        className="sidebar__archived-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" className="sidebar__chevron">
          <ChevronRight {...ICON_PROPS} />
        </span>
        Arquivados
        <span className="sidebar__count">{projects.length}</span>
      </button>
      {open ? (
        <ul id={listId} aria-label="Projetos arquivados" className="sidebar__archived-list">
          {projects.map((project) => (
            <li key={project.id} className="sidebar__archived-item">
              <span className="sidebar__archived-text">
                <span className="sidebar__name" title={project.path}>
                  {project.name}
                </span>
                {project.available ? null : <small>Pasta indisponível</small>}
              </span>
              <button
                type="button"
                className="sidebar__archived-restore"
                aria-label={`Restaurar ${project.name}`}
                onClick={() => onRestore(project.id)}
              >
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
