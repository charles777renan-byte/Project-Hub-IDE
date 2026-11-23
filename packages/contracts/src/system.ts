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

/** Informações do app para a seção Geral das Configurações. A pasta de dados é só para exibição. */
export const appInfoDtoSchema = z.strictObject({
  version: z.string().min(1).max(40),
  dataDir: z.string().min(1),
});

export type AppInfoDto = z.infer<typeof appInfoDtoSchema>;

/** Tamanho máximo da versão de um programa que a conferência do ambiente devolve. */
export const ENVIRONMENT_VERSION_MAX = 80;

/**
 * A conferência do ambiente da tela de boas-vindas: se o Git responde (e a primeira linha de `git --version`) e a
 * pasta das cópias de trabalho. Os caminhos são só para exibição; o caminho do executável do Git não vem.
 */
export const environmentDtoSchema = z.strictObject({
  git: z.strictObject({
    installed: z.boolean(),
    version: z.string().min(1).max(ENVIRONMENT_VERSION_MAX).optional(),
  }),
  worktreesRoot: z.string().min(1),
});

export type EnvironmentDto = z.infer<typeof environmentDtoSchema>;
