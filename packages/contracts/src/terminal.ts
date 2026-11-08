import { z } from 'zod';
import { tokenCount, usageSummaryDtoSchema } from './mission';
import { providerIdSchema } from './workspace';

/** Tipos de terminal dos terminais: o de um agente (uma missão) ou um shell comum de um projeto. */
export const TERMINAL_KIND_VALUES = ['agent', 'shell'] as const;

/** Estado mostrado na lista: rodando, aguardando o usuário, ou já encerrado. */
export const TERMINAL_STATE_VALUES = ['running', 'waiting', 'exited'] as const;

/** Um terminal da lista lateral. O renderer só conhece o id; o caminho e o comando ficam no processo principal. */
export const terminalSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(TERMINAL_KIND_VALUES),
  title: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  missionId: z.string().optional(),
  state: z.enum(TERMINAL_STATE_VALUES),
  provider: providerIdSchema,
  /** `recovered`: a sessão já estava viva quando o app abriu, e o terminal só se reconectou a ela. */
  origin: z.enum(['new', 'recovered']),
  /** Último trecho do caminho do worktree, quando o terminal roda num. O caminho inteiro não sai do processo principal. */
  worktreeName: z.string().optional(),
  /** Quando a sessão foi aberta (ISO). Só as sessões avulsas têm; a de missão mostra a missão, não a hora. */
  startedAt: z.string().optional(),
  /** Total de bytes que o terminal já produziu: a barra lateral compara leituras para desenhar a atividade recente. */
  outputBytes: z.number().int().nonnegative().optional(),
  /** Arquivos com alteração na pasta da sessão (o worktree, na missão). Sem Git nessa pasta, não vem. */
  changedFiles: z.number().int().nonnegative().optional(),
  /**
   * Tokens que o Claude Code deste terminal já gastou (`outputTokens` é o número do cabeçalho do painel; o resto
   * vai na dica). Só o Claude informa: os outros programas e o shell não têm o campo, e sem ele não há número
   * (não é zero). No terminal de agente de missão, vem da tentativa em curso.
   */
  usage: usageSummaryDtoSchema.optional(),
  /** Modelo da resposta mais recente do Claude Code deste terminal. Só o Claude informa; sem resposta, não vem. */
  model: z.string().optional(),
  /**
   * Quanto da janela de contexto a resposta mais recente ocupa (`usedTokens`) e o tamanho da janela do modelo
   * (`windowTokens`). Só o painel avulso do Claude informa; sem resposta, não vem (não é zero).
   */
  context: z.object({ usedTokens: tokenCount, windowTokens: tokenCount }).optional(),
});
export type TerminalSummary = z.infer<typeof terminalSummarySchema>;

/** Entrada dos canais que agem num terminal só. */
export const terminalIdInputSchema = z.object({ terminalId: z.string().min(1).max(128) });

/** Digitação: texto limitado, para caber numa linha do pipe do processo de terminais. */
export const terminalWriteInputSchema = z.object({
  terminalId: z.string().min(1).max(128),
  data: z.string().max(16_384),
});

export const terminalResizeInputSchema = z.object({
  terminalId: z.string().min(1).max(128),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
});

/** Evento de um terminal assinado, do processo principal para o renderer. `restart` pede para limpar a tela. */
export const terminalEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('data'), terminalId: z.string(), data: z.string() }),
  z.object({ type: z.literal('exit'), terminalId: z.string(), exitCode: z.number() }),
  z.object({ type: z.literal('restart'), terminalId: z.string() }),
]);
export type TerminalEvent = z.infer<typeof terminalEventSchema>;
