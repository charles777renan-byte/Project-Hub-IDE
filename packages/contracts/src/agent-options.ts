// Sem dependências: o renderer importa este arquivo direto, sem puxar o zod dos esquemas para o bundle
// (o zod sonda `Function('')` ao carregar, e a CSP do renderer reporta isso como violação).

/** O id do perfil embutido: não tem linha no banco, não se edita e não passa opção nenhuma. */
export const BUILT_IN_PROFILE_ID = 'padrao';

/** As opções que um perfil pode fixar. São as que o Claude Code aceita; as que tiram a pessoa do controle ficam fora. */
export const PROFILE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export const PROFILE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const PROFILE_PERMISSION_MODES = ['manual', 'acceptEdits', 'auto'] as const;
export type ProfileModel = (typeof PROFILE_MODELS)[number];
export type ProfileEffort = (typeof PROFILE_EFFORTS)[number];
export type ProfilePermissionMode = (typeof PROFILE_PERMISSION_MODES)[number];
