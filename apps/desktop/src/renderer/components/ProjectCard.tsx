import type { ProjectSummary } from '@project-hub/contracts';

/** Um projeto na listagem: nome, caminho e tipo de repositório. Pasta que sumiu sai com aviso. */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article className="project-card">
      <h2>{project.name}</h2>
      <p className="project-path">{project.path}</p>
      <p>{project.repositoryKind === 'git' ? 'Repositório Git' : 'Sem Git'}</p>
      {project.available ? null : <p className="project-unavailable">Pasta indisponível</p>}
    </article>
  );
}
