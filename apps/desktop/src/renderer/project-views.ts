/*
 * As visões da aba do projeto (`/workspaces/:projectId?visao=...`). Ficam fora de `routes.tsx` porque o cabeçalho
 * e os textos precisam delas ao carregar o módulo, e `routes.tsx` importa as páginas (um ciclo de importação).
 */

/** Parâmetro da aba do projeto (`/workspaces/p1?visao=worktrees`) que diz qual visão aparece. */
export const VIEW_PARAM = 'visao';

/** As visões da aba do projeto, na ordem da barra. */
export const PROJECT_VIEWS = [
  'terminais',
  'missoes',
  'progresso',
  'worktrees',
  'configuracoes',
] as const;

export type ProjectView = (typeof PROJECT_VIEWS)[number];

/** A visão padrão da aba do projeto: os terminais. */
export const DEFAULT_PROJECT_VIEW: ProjectView = 'terminais';

/** O valor de `?visao=` como visão; valor desconhecido (ou ausente) vale como a visão padrão. */
export function parseProjectView(value: string | null): ProjectView {
  return PROJECT_VIEWS.find((view) => view === value) ?? DEFAULT_PROJECT_VIEW;
}

/**
 * A visão que a rota pede: `?visao=`, ou Missões quando a rota traz `?nova-missao=1` (o formulário vive nela), mesmo sem
 * `?visao=`. Valor desconhecido vale como a visão padrão.
 */
export function projectViewFromParams(params: URLSearchParams): ProjectView {
  if (params.get(NEW_MISSION_PARAM) === '1') return 'missoes';
  return parseProjectView(params.get(VIEW_PARAM));
}

/** O id do painel de uma visão: o `aria-controls` da aba dela e o `id` do `role="tabpanel"`. */
export function projectPanelId(view: ProjectView): string {
  return `project-panel-${view}`;
}

/** Parâmetro da aba do projeto (`?visao=missoes&nova-missao=1`) que abre o formulário Nova missão. */
export const NEW_MISSION_PARAM = 'nova-missao';
