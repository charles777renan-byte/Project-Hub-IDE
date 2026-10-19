export { addProject, type AddProjectDeps } from './projects/add-project';
export { listProjects, toProjectSummary, type ListProjectsDeps } from './projects/list-projects';
export { normalizePath, type Platform } from './projects/normalize-path';
export type { FileSystemPort, GitDetector, ProjectRepository } from './ports';
export { failure } from './result';
