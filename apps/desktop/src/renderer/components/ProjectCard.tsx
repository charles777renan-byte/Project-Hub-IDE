import { Link } from 'react-router';
import type { ProjectSummary } from '@project-hub/contracts';
import { projectPath } from '../routes';
import { PathText } from './PathText';

/**
 * Um projeto na listagem: nome (que abre o detalhe), caminho e tipo de repositório. Pasta que sumiu
 * sai com aviso.
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <article className="project-card">
      <h2>
        <Link to={projectPath(project.id)}>{project.name}</Link>
      </h2>
      <p className="project-path">
        <PathText path={project.path} />
      </p>
      <p>{project.repositoryKind === 'git' ? 'Repositório Git' : 'Sem Git'}</p>
      {project.defaultBranch === undefined ? null : (
        <p className="muted">Branch padrão: {project.defaultBranch}</p>
      )}
      {project.available ? null : <p className="project-unavailable">Pasta indisponível</p>}
    </article>
  );
}
