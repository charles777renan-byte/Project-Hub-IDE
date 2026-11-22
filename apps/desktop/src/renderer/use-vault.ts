import { useEffect, useRef, useState } from 'react';
import type { VaultDto } from '@project-hub/contracts';

/**
 * O estado do cofre das chaves de API: lido ao montar e acompanhado pelos avisos do processo principal. A senha nunca
 * passa por aqui. `onChange` é chamado a cada aviso de mudança (destrancado, trancado, redefinido), para quem mostra
 * o estado das chaves reler a lista. Sem a ponte do app (testes da janela inteira), fica em `null`.
 */
export function useVault(onChange?: () => void): VaultDto | null {
  const [vault, setVault] = useState<VaultDto | null>(null);
  const latest = useRef(onChange);

  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const api = window.projectHub?.vault;
    if (api === undefined) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.subscribe((next) => {
        if (!alive) return;
        setVault(next);
        latest.current?.();
      });
    } catch {
      // Sem o aviso, a leitura inicial ainda mostra o estado.
    }
    try {
      api.get().then(
        (result) => {
          if (alive && result.ok) setVault((current) => current ?? result.data);
        },
        () => undefined,
      );
    } catch {
      // Sem leitura, a barra do cofre não aparece e a opção de chave de API fica desligada.
    }
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  return vault;
}
