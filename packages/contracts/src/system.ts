import { z } from 'zod';

/**
 * Uso do computador, lido do próprio sistema, para o cabeçalho do app. `cpuPercent` é o uso do processador em
 * todo o computador (0 a 100) desde a leitura anterior, e `null` quando ainda não houve intervalo para medir.
 * A memória vem em bytes: `memoryUsedBytes` é o total menos o livre.
 */
export const systemUsageDtoSchema = z.object({
  cpuPercent: z.number().min(0).max(100).nullable(),
  memoryUsedBytes: z.number().nonnegative(),
  memoryTotalBytes: z.number().positive(),
});

export type SystemUsageDto = z.infer<typeof systemUsageDtoSchema>;
