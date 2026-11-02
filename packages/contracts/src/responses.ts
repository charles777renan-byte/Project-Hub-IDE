import { z } from 'zod';
import { agentActivityResponseSchema } from './agent-activity';
import { CHANNELS } from './channels';
import { limitsDtoSchema } from './limits';
import { profileDtoSchema } from './profile';
import { systemUsageDtoSchema } from './system';
import { projectSummarySchema } from './project';
import {
  MISSION_STATUS_VALUES,
  executionDtoSchema,
  missionDiffDtoSchema,
  missionDtoSchema,
  missionPlanDtoSchema,
  missionViewSchema,
} from './mission';
import { appResultSchema } from './result';
import { terminalSummarySchema } from './terminal';
import { providerInfoSchema, workspaceDtoSchema } from './workspace';

/** Entrada de `worktrees:list:v1`. */
export const listWorktreesInputSchema = z.object({ projectId: z.string().min(1) });

/** Entrada de `worktrees:remove:v1`: o worktree é o da missão. */
export const removeWorktreeInputSchema = z.object({ missionId: z.string().min(1) });

/** Um worktree do projeto, como a aba Worktrees o mostra. A branch some se a auditoria não a guardou. */
export const worktreeDtoSchema = z.object({
  missionId: z.string(),
  missionTitle: z.string(),
  status: z.enum(MISSION_STATUS_VALUES),
  path: z.string(),
  branch: z.string().optional(),
});
export type WorktreeDto = z.infer<typeof worktreeDtoSchema>;

/**
 * Schema da resposta de cada canal de pedido e resposta (seção 13.1 e R28). O preload confere o que
 * volta do processo principal e devolve VALIDATION_FAILED quando a resposta não bate. Canal novo
 * entra aqui também. `missions:event:v1` não tem resposta: o preload confere cada evento à parte.
 */
export const responseSchemas = {
  [CHANNELS.appPing]: appResultSchema(z.string()),
  [CHANNELS.terminalsList]: appResultSchema(z.array(terminalSummarySchema)),
  [CHANNELS.terminalsWrite]: appResultSchema(z.undefined()),
  [CHANNELS.terminalsResize]: appResultSchema(z.undefined()),
  [CHANNELS.terminalsSubscribe]: appResultSchema(z.undefined()),
  [CHANNELS.terminalsUnsubscribe]: appResultSchema(z.undefined()),
  [CHANNELS.workspacesList]: appResultSchema(z.array(workspaceDtoSchema)),
  [CHANNELS.workspacesOpen]: appResultSchema(workspaceDtoSchema),
  [CHANNELS.workspacesClose]: appResultSchema(z.undefined()),
  [CHANNELS.workspacesSaveLayout]: appResultSchema(z.undefined()),
  [CHANNELS.workspacesStartSession]: appResultSchema(workspaceDtoSchema),
  [CHANNELS.workspacesEndSession]: appResultSchema(workspaceDtoSchema),
  [CHANNELS.workspacesAddPane]: appResultSchema(workspaceDtoSchema),
  [CHANNELS.workspacesRemovePane]: appResultSchema(workspaceDtoSchema),
  [CHANNELS.workspacesReorder]: appResultSchema(z.undefined()),
  [CHANNELS.providersList]: appResultSchema(z.array(providerInfoSchema)),
  [CHANNELS.projectsList]: appResultSchema(z.array(projectSummarySchema)),
  [CHANNELS.projectsAdd]: appResultSchema(projectSummarySchema),
  [CHANNELS.projectsChooseDirectory]: appResultSchema(z.object({ path: z.string() }).nullable()),
  [CHANNELS.projectsListArchived]: appResultSchema(z.array(projectSummarySchema)),
  [CHANNELS.projectsArchive]: appResultSchema(z.undefined()),
  [CHANNELS.projectsUnarchive]: appResultSchema(z.undefined()),
  [CHANNELS.projectsRemove]: appResultSchema(z.undefined()),
  [CHANNELS.projectsOpenFolder]: appResultSchema(z.undefined()),
  [CHANNELS.projectsSetGroup]: appResultSchema(z.undefined()),
  [CHANNELS.projectsSetNickname]: appResultSchema(z.undefined()),
  [CHANNELS.missionsCreate]: appResultSchema(missionDtoSchema),
  [CHANNELS.missionsList]: appResultSchema(z.array(missionDtoSchema)),
  [CHANNELS.missionsGet]: appResultSchema(missionViewSchema),
  [CHANNELS.missionsDiff]: appResultSchema(missionDiffDtoSchema),
  [CHANNELS.missionsPlan]: appResultSchema(missionPlanDtoSchema),
  [CHANNELS.missionsEditPlan]: appResultSchema(missionPlanDtoSchema),
  [CHANNELS.missionsApprovePlan]: appResultSchema(z.undefined()),
  [CHANNELS.missionsStart]: appResultSchema(executionDtoSchema),
  [CHANNELS.missionsCancel]: appResultSchema(z.undefined()),
  [CHANNELS.missionsPause]: appResultSchema(z.undefined()),
  [CHANNELS.missionsResume]: appResultSchema(z.undefined()),
  [CHANNELS.missionsRetry]: appResultSchema(executionDtoSchema),
  [CHANNELS.missionsDelete]: appResultSchema(z.undefined()),
  [CHANNELS.missionsProvideInput]: appResultSchema(z.undefined()),
  [CHANNELS.missionsApproveReview]: appResultSchema(z.undefined()),
  [CHANNELS.missionsRequestChanges]: appResultSchema(executionDtoSchema),
  [CHANNELS.approvalsDecide]: appResultSchema(z.undefined()),
  [CHANNELS.worktreesList]: appResultSchema(z.array(worktreeDtoSchema)),
  [CHANNELS.worktreesRemove]: appResultSchema(z.undefined()),
  [CHANNELS.activityAgents]: appResultSchema(agentActivityResponseSchema),
  [CHANNELS.profileGet]: appResultSchema(profileDtoSchema),
  [CHANNELS.profileSetDisplayName]: appResultSchema(z.undefined()),
  [CHANNELS.systemUsage]: appResultSchema(systemUsageDtoSchema),
  [CHANNELS.limitsGet]: appResultSchema(limitsDtoSchema),
  [CHANNELS.limitsRefresh]: appResultSchema(limitsDtoSchema),
} as const;
