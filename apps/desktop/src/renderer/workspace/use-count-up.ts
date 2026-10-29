import { useEffect, useRef, useState } from 'react';
import { paneMotionOff } from './pane-motion';

/** Duração da contagem: quase uma leitura da lista dos terminais (a cada 2 s), para o número subir quase sem parar. */
export const COUNT_UP_MS = 1_500;

/** Desacelera no fim (saída cúbica): o número corre no começo e assenta devagar no valor real. */
function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * O valor a mostrar para um contador que cresce: quando `target` sobe, o número sobe até ele em vez de pular
 * (`counting` fica verdadeiro durante a subida, para a tela poder destacá-lo). Um novo alvo no meio da subida
 * continua do número que já está na tela. Sem animação, o número vai direto ao alvo: na primeira aparição (um
 * painel que abre já com gasto não conta de zero), quando o alvo cai ou não existe, e com "reduzir movimento".
 * Nunca passa do alvo, então o número mostrado não ultrapassa o gasto real.
 */
export function useCountUp(
  target: number | undefined,
  durationMs: number = COUNT_UP_MS,
): { value: number | undefined; counting: boolean } {
  const [value, setValue] = useState(target);
  const [counting, setCounting] = useState(false);
  const shown = useRef(target);

  useEffect(() => {
    const from = shown.current;
    if (target === undefined || from === undefined || target <= from || paneMotionOff()) {
      shown.current = target;
      setValue(target);
      setCounting(false);
      return;
    }
    const start = performance.now();
    let frame = 0;
    setCounting(true);
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next =
        progress >= 1 ? target : Math.floor(from + (target - from) * easeOutCubic(progress));
      shown.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setCounting(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return { value, counting };
}
