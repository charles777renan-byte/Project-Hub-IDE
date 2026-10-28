import autoAnimate, { type AutoAnimationPlugin } from '@formkit/auto-animate';
import { useCallback } from 'react';

/**
 * Movimento das listas que mudam sozinhas (missões, "Precisa de você", projetos e sessões da lateral), com o
 * AutoAnimate (decisão em brain/decisoes/decisao-animacao-de-listas.md). O item que entra sobe 4px e aparece, o
 * que sai se apaga, e o que muda de lugar desliza até o lugar novo.
 *
 * O plugin é nosso, e não o efeito padrão da biblioteca, por dois motivos. O padrão anima largura e altura,
 * que refazem o layout a cada quadro; aqui só `opacity` e `transform` se animam, como em styles/motion.css.
 * E o tempo e a curva vêm dos tokens (--dur, --dur-fast e --ease), para a lista andar no mesmo ritmo das abas.
 *
 * A biblioteca escreve estilo só pelo CSSOM (`element.style`), que a CSP aceita, e anima pelo
 * `element.animate`; não injeta `<style>`. Plugin desliga o cuidado dela com "reduzir movimento", então ele é
 * feito aqui: sem animação na montagem e duração zero se a preferência mudar com a lista já montada.
 */

/** Tempos de reserva, iguais aos de tokens.css, para quando a folha ainda não carregou (e no jsdom). */
const FALLBACK = { dur: 180, durFast: 120, ease: 'cubic-bezier(0.2, 0.7, 0.2, 1)' } as const;

type MotionTokens = { dur: number; durFast: number; ease: string };

/** Lê `--dur`, `--dur-fast` e `--ease` do `:root`; o que faltar ou vier estranho fica com a reserva. */
export function readMotionTokens(root: Element = document.documentElement): MotionTokens {
  const style = getComputedStyle(root);
  const ms = (name: string, fallback: number) => {
    const match = /^(\d+(?:\.\d+)?)ms$/.exec(style.getPropertyValue(name).trim());
    return match?.[1] === undefined ? fallback : Number(match[1]);
  };
  const ease = style.getPropertyValue('--ease').trim();
  return {
    dur: ms('--dur', FALLBACK.dur),
    durFast: ms('--dur-fast', FALLBACK.durFast),
    ease: ease === '' ? FALLBACK.ease : ease,
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Box = { top: number; left: number };

/** Os quadros e o tempo de cada movimento. Função pura, para o teste conferir que só opacidade e transform mudam. */
export function listKeyframes(
  action: 'add' | 'remove' | 'remain',
  tokens: MotionTokens,
  next?: Box,
  previous?: Box,
): { keyframes: Keyframe[]; options: KeyframeEffectOptions } {
  if (action === 'add') {
    return {
      keyframes: [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      options: { duration: tokens.dur, easing: tokens.ease },
    };
  }
  if (action === 'remove') {
    return {
      keyframes: [{ opacity: 1 }, { opacity: 0 }],
      options: { duration: tokens.durFast, easing: tokens.ease },
    };
  }
  const dx = (previous?.left ?? 0) - (next?.left ?? 0);
  const dy = (previous?.top ?? 0) - (next?.top ?? 0);
  // Só mudou de tamanho (o texto de um cartão cresceu): nada a animar, e o tamanho nunca se anima.
  if (dx === 0 && dy === 0) return { keyframes: [], options: { duration: 0 } };
  return {
    keyframes: [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
    options: { duration: tokens.dur, easing: tokens.ease },
  };
}

const listPlugin = ((element: Element, action, next, previous) => {
  const { keyframes, options } = listKeyframes(action, readMotionTokens(), next, previous);
  return new KeyframeEffect(
    element,
    keyframes,
    prefersReducedMotion() ? { ...options, duration: 0 } : options,
  );
}) as AutoAnimationPlugin;

/** Se esta janela anima: precisa da Web Animations API e de nenhum pedido para reduzir movimento. */
function canAnimate(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    typeof KeyframeEffect === 'function' &&
    typeof Element.prototype.animate === 'function' &&
    !prefersReducedMotion()
  );
}

/**
 * Ref para o contêiner de uma lista (`<ul ref={useListMotion()}>`): os filhos diretos ganham o movimento. Sem a
 * Web Animations API (jsdom) ou com "reduzir movimento", não faz nada. A limpeza do ref (React 19) desliga a
 * biblioteca quando o contêiner sai.
 */
export function useListMotion<T extends HTMLElement>(): (node: T | null) => (() => void) | void {
  return useCallback((node: T | null) => {
    if (node === null || !canAnimate()) return;
    const controller = autoAnimate(node, listPlugin);
    return () => controller.destroy?.();
  }, []);
}
