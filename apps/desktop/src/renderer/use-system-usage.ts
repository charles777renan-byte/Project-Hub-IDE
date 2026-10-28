import { useEffect, useState } from 'react';
import type { SystemUsageDto } from '@project-hub/contracts';

/** De quanto em quanto tempo o cabeçalho lê o uso do computador. */
export const USAGE_POLL_MS = 3000;

/**
 * Uso do processador e da memória do computador, lido do processo principal a cada `USAGE_POLL_MS`. É `null`
 * antes da primeira leitura e se a leitura falhar (ou se não houver API do preload, nos testes): o cabeçalho mostra
 * um traço, nunca um zero que pareceria uma medida. A leitura para quando o cabeçalho sai da tela.
 */
export function useSystemUsage(): SystemUsageDto | null {
  const [usage, setUsage] = useState<SystemUsageDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const result = await window.projectHub.system.usage();
        if (!cancelled && result.ok) setUsage(result.data);
      } catch {
        // Sem leitura, o traço continua. O cabeçalho não pode quebrar por causa dela.
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), USAGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return usage;
}
