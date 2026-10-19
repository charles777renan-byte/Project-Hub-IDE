import { z } from 'zod';
import { CHANNELS } from './channels';
import { projectSummarySchema } from './project';
import { appResultSchema } from './result';

/**
 * Schema da resposta de cada canal (seção 13.1 e R28). O preload confere o que volta do processo
 * principal e devolve VALIDATION_FAILED quando a resposta não bate. Canal novo entra aqui também.
 */
export const responseSchemas = {
  [CHANNELS.appPing]: appResultSchema(z.string()),
  [CHANNELS.projectsList]: appResultSchema(z.array(projectSummarySchema)),
  [CHANNELS.projectsAdd]: appResultSchema(projectSummarySchema),
  [CHANNELS.projectsChooseDirectory]: appResultSchema(z.object({ path: z.string() }).nullable()),
} as const;
