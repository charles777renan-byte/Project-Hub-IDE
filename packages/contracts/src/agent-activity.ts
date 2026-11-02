import { z } from 'zod';

/**
 * Entrada de `activity:agents:v1`. O canal não recebe parâmetro: aceita a chamada sem corpo ou com objeto
 * vazio; qualquer outra coisa é recusada.
 */
export const agentActivityInputSchema = z.union([z.undefined(), z.object({}).strict()]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Um agente da lista do bloco. Agente do registro sem leitor entra com as duas flags falsas; o chip
 * mostra "indisponível" nesse caso.
 */
export const agentActivityAgentSchema = z.object({
  id: z.string(),
  label: z.string(),
  messagesAvailable: z.boolean(),
  tokensAvailable: z.boolean(),
});
export type AgentActivityAgent = z.infer<typeof agentActivityAgentSchema>;

/**
 * Um dia de um agente, no dia local. `messages` e `tokens` são `null` quando o dado não existe (tokens do
 * Antigravity, por exemplo): falta de dado nunca vira zero.
 */
export const agentActivityDaySchema = z.object({
  date: dateSchema,
  agent: z.string(),
  messages: z.number().int().nonnegative().nullable(),
  tokens: z.number().int().nonnegative().nullable(),
});
export type AgentActivityDay = z.infer<typeof agentActivityDaySchema>;

/**
 * Resposta de `activity:agents:v1`. `since` é o dia mais antigo que o app conhece (o terminal ou a execução
 * mais antiga); `null` quando não há nenhum.
 */
export const agentActivityResponseSchema = z.object({
  agents: z.array(agentActivityAgentSchema),
  days: z.array(agentActivityDaySchema),
  since: dateSchema.nullable(),
});
export type AgentActivity = z.infer<typeof agentActivityResponseSchema>;
