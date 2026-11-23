import type {
  ExecutionProfileDto,
  ProfileEffort,
  ProfileModel,
  ProfilePermissionMode,
} from '@project-hub/contracts';

/** Os nomes das opções de um perfil de execução, como a tela os mostra. */
export const MODEL_LABELS: Record<ProfileModel, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

export const EFFORT_LABELS: Record<ProfileEffort, string> = {
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Extra alto',
  max: 'Máximo',
};

export const PERMISSION_MODE_LABELS: Record<ProfilePermissionMode, string> = {
  manual: 'Perguntar tudo',
  acceptEdits: 'Aceitar edições',
  auto: 'Automático',
};

/** A opção que não fixa nada: o programa decide. */
export const PROGRAM_DEFAULT_LABEL = 'Padrão';

export const NO_OPTIONS_SUMMARY = 'O Claude Code abre com as opções dele, sem nada fixado.';

/** O resumo de um perfil numa linha: só as opções que ele fixa. */
export function profileSummary(
  profile: Pick<ExecutionProfileDto, 'model' | 'effort' | 'permissionMode'>,
): string {
  const parts = [
    profile.model === undefined ? null : MODEL_LABELS[profile.model],
    profile.effort === undefined
      ? null
      : `esforço ${EFFORT_LABELS[profile.effort].toLocaleLowerCase('pt-BR')}`,
    profile.permissionMode === undefined ? null : PERMISSION_MODE_LABELS[profile.permissionMode],
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? NO_OPTIONS_SUMMARY : parts.join(' · ');
}
