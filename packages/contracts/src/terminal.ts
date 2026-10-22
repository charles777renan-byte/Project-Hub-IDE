import { z } from 'zod';

/** Tipos de terminal da página Terminais: o de um agente (uma missão) ou um shell comum de um projeto. */
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
});
export type TerminalSummary = z.infer<typeof terminalSummarySchema>;

/** Entrada dos canais que agem num terminal só. */
export const terminalIdInputSchema = z.object({ terminalId: z.string().min(1).max(128) });

/** Entrada de `terminals:open-shell:v1`: o projeto, nunca um caminho (R29). */
export const openShellInputSchema = z.object({ projectId: z.string().min(1) });

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
