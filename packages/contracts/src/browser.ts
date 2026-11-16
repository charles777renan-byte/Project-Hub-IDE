import { z } from 'zod';

/** Máximo de abas de página no navegador de um projeto. */
export const BROWSER_TAB_LIMIT = 8;

/** Máximo de abas de agente no navegador de um projeto, somando os terminais. */
export const BROWSER_AGENT_TAB_LIMIT = 4;

/** De quem é uma aba: da pessoa, ou do agente de um terminal. */
export const BROWSER_TAB_OWNERS = ['person', 'agent'] as const;
export type BrowserTabOwner = (typeof BROWSER_TAB_OWNERS)[number];

/** Maior texto que a barra de endereço aceita. */
export const BROWSER_ADDRESS_MAX = 2048;

const ID_MAX = 200;
const idSchema = z.string().min(1).max(ID_MAX);

/** Por que a página não carregou. O texto de cada código está em `BROWSER_ERROR_MESSAGES`. */
export const BROWSER_LOAD_ERROR_CODES = [
  'OFFLINE',
  'REFUSED',
  'NOT_FOUND',
  'CERTIFICATE',
  'CRASHED',
  'UNKNOWN',
] as const;
export type BrowserLoadErrorCode = (typeof BROWSER_LOAD_ERROR_CODES)[number];

/** Texto de cada falha de carregamento: fixo e seguro para exibir, sem endereço nem mensagem do sistema. */
export const BROWSER_ERROR_MESSAGES: Record<BrowserLoadErrorCode, string> = {
  OFFLINE: 'Sem conexão com a internet.',
  REFUSED: 'O servidor recusou a conexão. Se for o seu servidor local, veja se ele está rodando.',
  NOT_FOUND: 'Este endereço não foi encontrado.',
  CERTIFICATE: 'O certificado de segurança deste site não é válido.',
  CRASHED: 'A página parou de responder e foi encerrada.',
  UNKNOWN: 'Não foi possível abrir esta página.',
};

export const BROWSER_ADDRESS_BLOCKED = 'Este tipo de endereço não abre aqui.';
export const BROWSER_TAB_LIMIT_MESSAGE = 'O limite é de 8 abas por projeto.';
/** Resposta ao agente que pede a quinta aba. É ele quem lê: diz como sair do limite. */
export const BROWSER_AGENT_TAB_LIMIT_MESSAGE =
  'Limite de 4 abas do agente neste projeto. Feche uma com browser_close.';
export const BROWSER_EXTERNAL_HTTPS_ONLY = 'Só endereços https abrem no navegador do sistema.';

/** Uma aba de página. `url` vazia é a aba nova, sem endereço; `title` vazio é a página que ainda não disse o título. */
export const browserTabSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  error: z.object({ code: z.enum(BROWSER_LOAD_ERROR_CODES), message: z.string() }).nullable(),
  /** `agent`: a aba é do agente de um terminal, vive numa sessão separada e não é guardada no banco. */
  owner: z.enum(BROWSER_TAB_OWNERS),
  /** Título do terminal dono da aba. Só a aba de agente tem. */
  terminalTitle: z.string().optional(),
});
export type BrowserTabDto = z.infer<typeof browserTabSchema>;

/** O navegador de um projeto: as abas, na ordem, e qual está ativa. Resposta de vários canais e payload de `browser:changed:v1`. */
export const browserStateSchema = z.object({
  projectId: z.string(),
  tabs: z.array(browserTabSchema),
  activeTabId: z.string().nullable(),
});
export type BrowserStateDto = z.infer<typeof browserStateSchema>;

/** Retângulo da área da página, em pixels de CSS da janela do app. */
export const browserBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export type BrowserBounds = z.infer<typeof browserBoundsSchema>;

/** Entrada dos canais que só precisam do projeto. */
export const browserProjectInputSchema = z.object({ projectId: idSchema });
export type BrowserProjectInput = z.infer<typeof browserProjectInputSchema>;

/** Entrada dos canais que agem numa aba de página. */
export const browserTabInputSchema = z.object({ projectId: idSchema, tabId: idSchema });
export type BrowserTabInput = z.infer<typeof browserTabInputSchema>;

/** Entrada de `browser:navigate:v1`: o texto digitado na barra, que o processo principal interpreta. */
export const browserNavigateInputSchema = z.object({
  projectId: idSchema,
  tabId: idSchema,
  text: z.string().max(BROWSER_ADDRESS_MAX),
});
export type BrowserNavigateInput = z.infer<typeof browserNavigateInputSchema>;

/** Entrada de `browser:set-bounds:v1`. `null` esconde a página. */
export const browserBoundsInputSchema = z.object({
  projectId: idSchema,
  bounds: browserBoundsSchema.nullable(),
});
export type BrowserBoundsInput = z.infer<typeof browserBoundsInputSchema>;

/** Atalhos que a página devolve ao app, porque quem age é o renderer. */
export const BROWSER_SHORTCUT_ACTIONS = [
  'toggle-right-panel',
  'focus-address',
  'focus-toolbar',
] as const;
export type BrowserShortcutAction = (typeof BROWSER_SHORTCUT_ACTIONS)[number];

/** Payload de `browser:shortcut:v1` (do processo principal ao renderer). */
export const browserShortcutEventSchema = z.object({
  projectId: z.string(),
  action: z.enum(BROWSER_SHORTCUT_ACTIONS),
});
export type BrowserShortcutEvent = z.infer<typeof browserShortcutEventSchema>;

/**
 * Resposta de `browser:agent-access:v1`: quais programas de agente alcançam o navegador. Só rótulos e sim ou não;
 * o endereço do servidor de ferramentas e o token nunca passam por um canal.
 */
export const browserAgentAccessSchema = z.object({
  /** Falso no sistema em que o recurso ainda não existe. */
  supported: z.boolean(),
  programs: z.array(z.object({ label: z.string(), access: z.boolean() })),
});
export type BrowserAgentAccessDto = z.infer<typeof browserAgentAccessSchema>;
