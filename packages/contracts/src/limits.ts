import { z } from 'zod';

/**
 * Limites da assinatura de um programa de IA, como o cartão de uso do Início os mostra. Cada programa tem
 * as suas janelas (o Claude tem a de 5 horas e a semanal). O programa que ainda não tem fonte de dados não
 * entra na lista: a tela mostra "em breve" para ele.
 */
export const LIMIT_PROVIDER_VALUES = ['claude', 'codex'] as const;
export type LimitProviderId = (typeof LIMIT_PROVIDER_VALUES)[number];

/**
 * Por que não há número para o programa. `not-installed`: o executável não foi achado. `not-logged-in`: o
 * programa pediu login. `no-limits`: a conta não tem limite de uso por janela (chave de API, por exemplo).
 * `no-data`: o programa existe, mas ainda não há leitura do limite (o Codex só grava o limite depois de
 * uma resposta). `failed`: a leitura falhou ou veio fora do formato (a mensagem do programa não sai do
 * processo principal).
 */
export const LIMIT_PROBLEM_VALUES = [
  'not-installed',
  'not-logged-in',
  'no-limits',
  'no-data',
  'failed',
] as const;
export type LimitProblem = (typeof LIMIT_PROBLEM_VALUES)[number];

/**
 * Uma janela de uso. `id` é o nome da janela no programa (`five_hour`, `seven_day`...): a tela dá o rótulo
 * às que conhece e mostra as outras pelo nome. `usedPercent` vai de 0 a 100 e `resetsAt` é um instante ISO.
 */
export const limitWindowDtoSchema = z.object({
  id: z.string().min(1).max(64),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string(),
  /** Duração da janela em minutos, quando o programa a informa (o Codex). Falta no `limits.json` antigo. */
  durationMinutes: z.number().int().positive().max(527040).optional(),
});
export type LimitWindowDto = z.infer<typeof limitWindowDtoSchema>;

export const providerLimitsDtoSchema = z.object({
  provider: z.enum(LIMIT_PROVIDER_VALUES),
  /** As janelas da última leitura boa, mesmo que a leitura de agora tenha falhado. Vazio sem nenhuma leitura. */
  windows: z.array(limitWindowDtoSchema),
  /** Instante ISO da última leitura boa. Falta enquanto não houve nenhuma. */
  capturedAt: z.string().optional(),
  /** Há uma leitura em andamento. */
  refreshing: z.boolean(),
  /** Problema da leitura mais recente. Falta quando ela deu certo. */
  problem: z.enum(LIMIT_PROBLEM_VALUES).optional(),
});
export type ProviderLimitsDto = z.infer<typeof providerLimitsDtoSchema>;

export const limitsDtoSchema = z.object({
  providers: z.array(providerLimitsDtoSchema),
});
export type LimitsDto = z.infer<typeof limitsDtoSchema>;
