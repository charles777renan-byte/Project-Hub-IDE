import { z } from 'zod';

/** Projeto como o renderer o recebe na listagem. `defaultBranch` vem só para pasta com Git. */
export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  repositoryKind: 'git' | 'none';
  available: boolean;
  defaultBranch?: string | undefined;
};

/** Schema de `ProjectSummary`, para conferir a resposta que vem do processo principal. */
export const projectSummarySchema: z.ZodType<ProjectSummary> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  repositoryKind: z.enum(['git', 'none']),
  available: z.boolean(),
  defaultBranch: z.string().optional(),
});

/** Entrada de `projects:add:v1`: o caminho da pasta do projeto. */
export const addProjectInputSchema = z.object({ path: z.string().min(1) });

export type AddProjectInput = z.infer<typeof addProjectInputSchema>;
