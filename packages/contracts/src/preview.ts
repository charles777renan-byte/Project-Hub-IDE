import { z } from 'zod';
import { BROWSER_ADDRESS_MAX } from './browser';

/**
 * Nome de script do `package.json` que o preview aceita. O nome vai para a linha de comando do terminal, e o
 * `package.json` é conteúdo do repositório: só letras, números e `: _ . -`, começando por letra ou número.
 */
export const PREVIEW_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;

/** Quanto do texto de um script a tela mostra. O resto vira reticências. */
export const PREVIEW_BODY_SHOWN_MAX = 200;

const ID_MAX = 200;
const idSchema = z.string().min(1).max(ID_MAX);

export const PREVIEW_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export const previewPackageManagerSchema = z.enum(PREVIEW_PACKAGE_MANAGERS);
export type PreviewPackageManager = z.infer<typeof previewPackageManagerSchema>;

/** Um script do `package.json`. `body` é o texto dele, já cortado em `PREVIEW_BODY_SHOWN_MAX`. */
export const previewScriptSchema = z.object({ name: z.string(), body: z.string() });
export type PreviewScriptDto = z.infer<typeof previewScriptSchema>;

/**
 * O que o projeto oferece: `server` (há um script sugerido ou aprovado), `static` (só um `index.html` na raiz) ou
 * `none`. `scripts` traz todos os válidos, para "Outro script".
 */
export const previewDetectionSchema = z.object({
  kind: z.enum(['server', 'static', 'none']),
  packageManager: previewPackageManagerSchema,
  scripts: z.array(previewScriptSchema),
  suggested: z.string().nullable(),
});
export type PreviewDetectionDto = z.infer<typeof previewDetectionSchema>;

/**
 * O que a pessoa aprovou no projeto. Em `script`, `changed` diz que o `package.json` de agora não é mais o que ela
 * viu (gerenciador, script ou texto diferentes): o automático para até ela aprovar de novo.
 */
export const previewApprovalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('script'),
    packageManager: previewPackageManagerSchema,
    script: z.string(),
    body: z.string(),
    changed: z.boolean(),
  }),
  z.object({ kind: z.literal('address'), url: z.string() }),
]);
export type PreviewApprovalDto = z.infer<typeof previewApprovalSchema>;

/**
 * Situação do preview: `idle` (parado), `starting` (o painel subiu e o endereço ainda não veio), `running` (o
 * endereço responde), `no-address` (o limite de espera passou), `exited` (o comando terminou antes de anunciar),
 * `stale-terminal` (o terminal do preview está vivo e o servidor não responde) e `no-room` (o workspace está no
 * limite de painéis).
 */
export const PREVIEW_STATUSES = [
  'idle',
  'starting',
  'running',
  'no-address',
  'exited',
  'stale-terminal',
  'no-room',
] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

/** O preview de um projeto. Resposta dos canais de pedido e payload de `preview:changed:v1`. */
export const previewStateSchema = z.object({
  projectId: z.string(),
  detection: previewDetectionSchema,
  approval: previewApprovalSchema,
  status: z.enum(PREVIEW_STATUSES),
  /** O endereço do preview: o último conhecido, ou o fixo. */
  url: z.string().nullable(),
  /** O terminal do servidor, para "Ver terminal". */
  terminalId: z.string().nullable(),
});
export type PreviewStateDto = z.infer<typeof previewStateSchema>;

/** Entrada dos canais que só precisam do projeto. */
export const previewProjectInputSchema = z.object({ projectId: idSchema });
export type PreviewProjectInput = z.infer<typeof previewProjectInputSchema>;

/**
 * Entrada de `preview:approve:v1`. Só o nome do script: o comando é montado no processo principal. `shownBody` é o
 * texto que a tela mostrou, para recusar a aprovação de um script que mudou nesse meio-tempo.
 */
export const previewApproveInputSchema = z.object({
  projectId: idSchema,
  script: z.string().regex(PREVIEW_SCRIPT_NAME),
  shownBody: z.string().max(PREVIEW_BODY_SHOWN_MAX),
});
export type PreviewApproveInput = z.infer<typeof previewApproveInputSchema>;

/** Entrada de `preview:set-address:v1`: o texto do endereço local, que o processo principal interpreta. */
export const previewAddressInputSchema = z.object({
  projectId: idSchema,
  text: z.string().min(1).max(BROWSER_ADDRESS_MAX),
});
export type PreviewAddressInput = z.infer<typeof previewAddressInputSchema>;

/** Entrada de `preview:start:v1`. `tabId` é a aba de página que navega quando o endereço chegar. */
export const previewStartInputSchema = z.object({
  projectId: idSchema,
  tabId: idSchema,
  /** Fecha o terminal do preview que ficou aberto sem servidor e sobe outro. */
  restart: z.boolean().optional(),
});
export type PreviewStartInput = z.infer<typeof previewStartInputSchema>;

/** Textos fixos das recusas do preview: seguros para exibir, sem caminho nem texto do repositório. */
export const PREVIEW_MESSAGES = {
  scriptChanged: 'O comando do preview mudou. Confira o comando de novo antes de usar.',
  scriptUnknown: 'Este script não existe no package.json do projeto.',
  addressNotLocal: 'O preview só abre endereço local, como localhost:3000.',
  noWorkspace: 'Abra o projeto para subir o servidor do preview.',
  notApproved: 'O preview deste projeto ainda não foi aprovado.',
} as const;
