import { z } from 'zod';
import { CHANNELS } from './channels';
import { projectSummarySchema } from './project';
import {
  executionDtoSchema,
  missionDtoSchema,
  missionPlanDtoSchema,
  missionViewSchema,
} from './mission';
import { appResultSchema } from './result';

/**
 * Schema da resposta de cada canal de pedido e resposta (seção 13.1 e R28). O preload confere o que
 * volta do processo principal e devolve VALIDATION_FAILED quando a resposta não bate. Canal novo
 * entra aqui também. `missions:event:v1` não tem resposta: o preload confere cada evento à parte.
 */
export const responseSchemas = {
  [CHANNELS.appPing]: appResultSchema(z.string()),
  [CHANNELS.projectsList]: appResultSchema(z.array(projectSummarySchema)),
  [CHANNELS.projectsAdd]: appResultSchema(projectSummarySchema),
  [CHANNELS.projectsChooseDirectory]: appResultSchema(z.object({ path: z.string() }).nullable()),
  [CHANNELS.missionsCreate]: appResultSchema(missionDtoSchema),
  [CHANNELS.missionsList]: appResultSchema(z.array(missionDtoSchema)),
  [CHANNELS.missionsGet]: appResultSchema(missionViewSchema),
  [CHANNELS.missionsPlan]: appResultSchema(missionPlanDtoSchema),
  [CHANNELS.missionsApprovePlan]: appResultSchema(z.undefined()),
  [CHANNELS.missionsStart]: appResultSchema(executionDtoSchema),
  [CHANNELS.missionsCancel]: appResultSchema(z.undefined()),
  [CHANNELS.missionsPause]: appResultSchema(z.undefined()),
  [CHANNELS.missionsResume]: appResultSchema(z.undefined()),
  [CHANNELS.missionsRetry]: appResultSchema(executionDtoSchema),
  [CHANNELS.missionsProvideInput]: appResultSchema(z.undefined()),
  [CHANNELS.approvalsDecide]: appResultSchema(z.undefined()),
} as const;
