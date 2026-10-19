import { z } from 'zod';

/** Projeto como o renderer o recebe na listagem. */
export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  repositoryKind: 'git' | 'none';
  available: boolean;
};

/** Entrada de `projects:add:v1`: o caminho da pasta do projeto. */
export const addProjectInputSchema = z.object({ path: z.string().min(1) });
