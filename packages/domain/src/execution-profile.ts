/**
 * Perfil de execução: como o Claude Code de uma missão abre. Cada campo ausente quer dizer "padrão do programa":
 * nenhuma opção é passada. Os valores são os que o Claude Code aceita em `--model`, `--effort` e
 * `--permission-mode`; `bypassPermissions`, `dontAsk` e `plan` ficam de fora de propósito.
 */

/** O id do perfil embutido, que não tem linha no banco e não passa opção nenhuma. */
export const DEFAULT_EXECUTION_PROFILE_ID = 'padrao';

export const PROFILE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export const PROFILE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const PROFILE_PERMISSION_MODES = ['manual', 'acceptEdits', 'auto'] as const;

export type ProfileModel = (typeof PROFILE_MODELS)[number];
export type ProfileEffort = (typeof PROFILE_EFFORTS)[number];
export type ProfilePermissionMode = (typeof PROFILE_PERMISSION_MODES)[number];

/** As opções de um perfil. Campo ausente: o padrão do programa. */
export type ExecutionOptions = {
  model?: ProfileModel;
  effort?: ProfileEffort;
  permissionMode?: ProfilePermissionMode;
};

export type ExecutionProfile = ExecutionOptions & {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
