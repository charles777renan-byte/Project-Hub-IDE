import { z } from 'zod';
import { ACCOUNT_NAME_MAX } from './account-name';
import {
  BUILT_IN_PROFILE_ID,
  PROFILE_EFFORTS,
  PROFILE_MODELS,
  PROFILE_PERMISSION_MODES,
  type ProfileEffort,
  type ProfileModel,
  type ProfilePermissionMode,
} from './agent-options';

/** Os programas de agente que o app sabe abrir. O shell não é um agente e fica de fora. */
export const AGENT_PROGRAMS = ['claude', 'codex', 'antigravity', 'opencode', 'freebuff'] as const;
export const agentProgramIdSchema = z.enum(AGENT_PROGRAMS);
export type AgentProgramId = (typeof AGENT_PROGRAMS)[number];

/** O que o programa faz no app: roda missões e painéis, ou só painéis. */
export const AGENT_PROGRAM_ROLES = ['missions', 'panels'] as const;

export const agentProgramDtoSchema = z.strictObject({
  provider: agentProgramIdSchema,
  label: z.string().min(1).max(40),
  installed: z.boolean(),
  role: z.enum(AGENT_PROGRAM_ROLES),
});
export type AgentProgramDto = z.infer<typeof agentProgramDtoSchema>;

export {
  BUILT_IN_PROFILE_ID,
  PROFILE_EFFORTS,
  PROFILE_MODELS,
  PROFILE_PERMISSION_MODES,
  type ProfileEffort,
  type ProfileModel,
  type ProfilePermissionMode,
};

/** Um perfil criado pela pessoa tem id gerado pelo processo principal; o embutido tem o id fixo. */
export const customProfileIdSchema = z.uuid();
export const profileIdSchema = z.union([z.literal(BUILT_IN_PROFILE_ID), customProfileIdSchema]);

const profileOptions = {
  /** Ausente: o padrão do programa. */
  model: z.enum(PROFILE_MODELS).optional(),
  effort: z.enum(PROFILE_EFFORTS).optional(),
  permissionMode: z.enum(PROFILE_PERMISSION_MODES).optional(),
};

/** Um perfil de execução na tela. Estrito: nenhum argumento de linha de comando passa por aqui. */
export const executionProfileDtoSchema = z.strictObject({
  id: profileIdSchema,
  name: z.string().min(1).max(ACCOUNT_NAME_MAX),
  builtIn: z.boolean(),
  /** O perfil com que as missões novas nascem. */
  isDefault: z.boolean(),
  ...profileOptions,
});
export type ExecutionProfileDto = z.infer<typeof executionProfileDtoSchema>;

export const agentsDtoSchema = z.strictObject({
  programs: z.array(agentProgramDtoSchema),
  /** O embutido vem primeiro; depois, os da pessoa, do mais antigo para o mais novo. */
  profiles: z.array(executionProfileDtoSchema),
});
export type AgentsDto = z.infer<typeof agentsDtoSchema>;

const profileNameSchema = z.string().trim().min(1).max(ACCOUNT_NAME_MAX);

/** Entrada de `agents:add-profile:v1`. */
export const addProfileInputSchema = z.strictObject({ name: profileNameSchema, ...profileOptions });
export type AddProfileInput = z.infer<typeof addProfileInputSchema>;

/** Entrada de `agents:update-profile:v1`. Opção que não vem volta ao padrão do programa. */
export const updateProfileInputSchema = z.strictObject({
  id: customProfileIdSchema,
  name: profileNameSchema,
  ...profileOptions,
});
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

/** Entrada de `agents:remove-profile:v1`. O embutido não se remove. */
export const removeProfileInputSchema = z.strictObject({ id: customProfileIdSchema });
export type RemoveProfileInput = z.infer<typeof removeProfileInputSchema>;

/** Entrada de `agents:set-default-profile:v1`. */
export const setDefaultProfileInputSchema = z.strictObject({ id: profileIdSchema });
export type SetDefaultProfileInput = z.infer<typeof setDefaultProfileInputSchema>;

/** Entrada de `agents:test-program:v1`: só o programa. O comando nasce no processo principal. */
export const testProgramInputSchema = z.strictObject({ provider: agentProgramIdSchema });
export type TestProgramInput = z.infer<typeof testProgramInputSchema>;

/** O tamanho máximo da versão que o teste devolve: a primeira linha da saída, aparada. */
export const PROGRAM_VERSION_MAX = 80;

/** A resposta do teste: a versão que o programa informou. A falha vem como erro do canal. */
export const programTestDtoSchema = z.strictObject({
  version: z.string().min(1).max(PROGRAM_VERSION_MAX),
});
export type ProgramTestDto = z.infer<typeof programTestDtoSchema>;
