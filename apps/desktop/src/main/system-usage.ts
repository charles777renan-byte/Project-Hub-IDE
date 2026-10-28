import os from 'node:os';
import type { SystemUsageDto } from '@project-hub/contracts';

/** A parte do módulo `os` que a leitura usa, para os testes trocarem por números conhecidos. */
export type OsReader = {
  cpus(): { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[];
  totalmem(): number;
  freemem(): number;
};

/** Tempo total e tempo ocioso de todos os núcleos, somados desde que o computador ligou. */
function cpuTotals(reader: OsReader): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const core of reader.cpus()) {
    const { user, nice, sys, idle: free, irq } = core.times;
    idle += free;
    total += user + nice + sys + free + irq;
  }
  return { idle, total };
}

/**
 * Leitor do uso do computador. O processador só tem sentido entre duas leituras: o uso é a fatia do tempo que
 * não foi ociosa desde a leitura anterior (a primeira conta desde que o leitor foi criado). Sem tempo
 * decorrido, `cpuPercent` é `null` em vez de um zero que pareceria uma medida.
 */
export function createSystemUsageSampler(reader: OsReader = os): () => SystemUsageDto {
  let previous = cpuTotals(reader);
  return () => {
    const now = cpuTotals(reader);
    const total = now.total - previous.total;
    const idle = now.idle - previous.idle;
    previous = now;
    const totalMemory = reader.totalmem();
    return {
      cpuPercent:
        total > 0 ? Math.min(100, Math.max(0, Math.round((1 - idle / total) * 100))) : null,
      memoryUsedBytes: Math.max(0, totalMemory - reader.freemem()),
      memoryTotalBytes: totalMemory,
    };
  };
}
