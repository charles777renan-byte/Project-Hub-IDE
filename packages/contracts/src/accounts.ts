import { z } from 'zod';
import { ACCOUNT_NAME_MAX } from './account-name';
import { providerIdSchema } from './workspace';

/** Programas que aceitam mais de uma conta. O GitHub entra com a conta por projeto. */
export const ACCOUNT_PROVIDERS = ['claude', 'codex'] as const;
export const accountProviderSchema = z.enum(ACCOUNT_PROVIDERS);
export type AccountProviderId = (typeof ACCOUNT_PROVIDERS)[number];

/** Tamanho máximo do nome que a pessoa dá a uma conta, depois de aparado. */
export { ACCOUNT_NAME_MAX };
export const accountNameSchema = z.string().trim().min(1).max(ACCOUNT_NAME_MAX);

/** Id de uma conta extra: gerado pelo processo principal, e o único dado que a tela manda sobre ela. */
export const accountIdSchema = z.uuid();
/** Uma conta: o id da extra, ou `null` para a Principal (a pasta do programa na máquina). */
export const accountRefSchema = accountIdSchema.nullable();

/** `unknown`: o programa não respondeu, não está instalado ou respondeu algo que o app não reconhece. */
export const ACCOUNT_STATES = ['connected', 'signed-out', 'unknown'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/** Assinatura (login do programa) ou chave de API (no cofre do app). Não muda depois de criada. */
export const ACCOUNT_KINDS = ['subscription', 'api'] as const;
export const accountKindSchema = z.enum(ACCOUNT_KINDS);
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/**
 * A chave de uma conta API: guardada, ausente, ilegível (o cofre não a abre mais) ou trancada (o cofre está
 * trancado e o app não sabe se ela abre).
 */
export const KEY_STATES = ['stored', 'missing', 'unreadable', 'locked'] as const;
export type KeyState = (typeof KEY_STATES)[number];

/**
 * Uma conta na tela. `identity` (o e-mail) e `organization` vêm do comando de estado do programa, a cada leitura:
 * o app não os grava. Estrito: caminho de pasta ou qualquer outro dado não passa.
 */
export const accountDtoSchema = z
  .strictObject({
    id: accountRefSchema,
    provider: accountProviderSchema,
    name: z.string().min(1).max(ACCOUNT_NAME_MAX),
    isPrincipal: z.boolean(),
    isDefault: z.boolean(),
    state: z.enum(ACCOUNT_STATES),
    identity: z.string().max(254).optional(),
    organization: z.string().max(200).optional(),
    kind: accountKindSchema,
    /** Só na conta API: o estado da chave e os 4 últimos caracteres dela, nunca mais que isso. */
    keyState: z.enum(KEY_STATES).optional(),
    keyLast4: z.string().length(4).optional(),
    /** Até quando o limite de uso da conta está esgotado (ISO). Só na conta esgotada. */
    exhaustedUntil: z.string().max(40).optional(),
  })
  .refine(
    (account) =>
      account.kind === 'api' || (account.keyState === undefined && account.keyLast4 === undefined),
    { message: 'Só a conta API tem chave.' },
  );
export type AccountDto = z.infer<typeof accountDtoSchema>;

export const accountGroupDtoSchema = z.strictObject({
  provider: accountProviderSchema,
  installed: z.boolean(),
  accounts: z.array(accountDtoSchema),
  /** A troca automática de conta quando o limite acaba. `includeApi`: as contas por chave entram (só Claude Code). */
  autoSwitch: z.strictObject({ enabled: z.boolean(), includeApi: z.boolean() }),
  /** A conta que painel e missão novos marcam: a padrão, ou a próxima que serve quando a padrão está esgotada. */
  preferredId: accountRefSchema,
});
export type AccountGroupDto = z.infer<typeof accountGroupDtoSchema>;

/** Programa com uma conta só: a tela mostra apenas se está instalado. */
export const otherProgramDtoSchema = z.strictObject({
  provider: providerIdSchema,
  label: z.string().min(1).max(60),
  installed: z.boolean(),
});
export type OtherProgramDto = z.infer<typeof otherProgramDtoSchema>;

export const accountsDtoSchema = z.strictObject({
  groups: z.array(accountGroupDtoSchema),
  others: z.array(otherProgramDtoSchema),
});
export type AccountsDto = z.infer<typeof accountsDtoSchema>;

/** As opções da troca automática: ligar a troca, e incluir as contas por chave de API. */
export const AUTO_SWITCH_OPTIONS = ['enabled', 'includeApi'] as const;
export type AutoSwitchOption = (typeof AUTO_SWITCH_OPTIONS)[number];
export const setAutoSwitchInputSchema = z
  .strictObject({
    provider: accountProviderSchema,
    option: z.enum(AUTO_SWITCH_OPTIONS),
    value: z.boolean(),
  })
  .refine((input) => input.option !== 'includeApi' || input.provider === 'claude', {
    message: 'Só o Claude Code tem contas por chave de API.',
  });
export type SetAutoSwitchInput = z.infer<typeof setAutoSwitchInputSchema>;

/** Entrada de `accounts:add:v1`. A pasta e o id nascem no processo principal. */
export const addAccountInputSchema = z.strictObject({
  provider: accountProviderSchema,
  name: accountNameSchema,
  kind: accountKindSchema,
});
export type AddAccountInput = z.infer<typeof addAccountInputSchema>;

export const renameAccountInputSchema = z.strictObject({
  accountId: accountIdSchema,
  name: accountNameSchema,
});
export type RenameAccountInput = z.infer<typeof renameAccountInputSchema>;

/** Uma conta de um programa, a Principal inclusive: conta padrão, desconectar e iniciar o login. */
export const accountTargetInputSchema = z.strictObject({
  provider: accountProviderSchema,
  accountId: accountRefSchema,
});
export type AccountTargetInput = z.infer<typeof accountTargetInputSchema>;

/**
 * Entrada de colar e de remover a chave: o programa e a conta extra, nunca a Principal. A chave não vem da tela:
 * colar a lê da área de transferência no processo principal.
 */
export const apiKeyTargetInputSchema = z.strictObject({
  provider: accountProviderSchema,
  accountId: accountIdSchema,
});
export type ApiKeyTargetInput = z.infer<typeof apiKeyTargetInputSchema>;

/** Resposta de colar a chave: só os 4 últimos caracteres, para a pessoa conferir. A chave nunca volta. */
export const pasteKeyResultSchema = z.strictObject({ last4: z.string().length(4) });
export type PasteKeyResult = z.infer<typeof pasteKeyResultSchema>;

/** Só conta extra. `force`: apagar a pasta mesmo quando a saída pelo programa falhou. */
export const removeAccountInputSchema = z.strictObject({
  accountId: accountIdSchema,
  force: z.boolean(),
});
export type RemoveAccountInput = z.infer<typeof removeAccountInputSchema>;

export const LOGIN_PHASES = [
  'starting',
  'browser',
  'verifying',
  'confirm',
  'done',
  'failed',
  'cancelled',
  'timed-out',
] as const;
export type LoginPhase = (typeof LOGIN_PHASES)[number];

export const LOGIN_PROBLEMS = [
  'not-installed',
  'start-failed',
  'not-connected',
  'status-failed',
] as const;
export type LoginProblem = (typeof LOGIN_PROBLEMS)[number];

/**
 * O login em andamento. Não tem o endereço: a tela recebe só o servidor (`host`), e abrir ou copiar o endereço
 * é feito pelo processo principal. Estrito, para um campo a mais nunca passar.
 */
export const loginDtoSchema = z.strictObject({
  provider: accountProviderSchema,
  accountId: accountRefSchema,
  phase: z.enum(LOGIN_PHASES),
  host: z.string().min(1).max(253).optional(),
  identity: z.string().max(254).optional(),
  /** Nome de outra conta do mesmo programa com a mesma identidade. */
  duplicateOf: z.string().max(ACCOUNT_NAME_MAX).optional(),
  /** Quando o login expira (ISO). */
  expiresAt: z.string(),
  problem: z.enum(LOGIN_PROBLEMS).optional(),
});
export type LoginDto = z.infer<typeof loginDtoSchema>;

/** Evento de `accounts:login-event:v1`: o estado do login, ou um trecho da saída do terminal do programa. */
export const loginEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('state'), login: loginDtoSchema.nullable() }),
  z.strictObject({ type: z.literal('data'), data: z.string() }),
]);
export type LoginEvent = z.infer<typeof loginEventSchema>;

/** Digitação no terminal do login, com o mesmo teto da digitação dos terminais. */
export const loginWriteInputSchema = z.strictObject({ data: z.string().max(16_384) });
export const loginResizeInputSchema = z.strictObject({
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
});
