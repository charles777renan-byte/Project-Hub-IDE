import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { listKeyframes, readMotionTokens, useListMotion } from '../../src/renderer/list-motion';

const TOKENS = { dur: 180, durFast: 120, ease: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };

/** As propriedades animadas de um conjunto de quadros (fora `offset`, `easing` e `composite`). */
function animated(keyframes: Keyframe[]): string[] {
  return [
    ...new Set(
      keyframes.flatMap((frame) =>
        Object.keys(frame).filter((key) => !['offset', 'easing', 'composite'].includes(key)),
      ),
    ),
  ].sort();
}

describe('listKeyframes', () => {
  it('o item que entra sobe 4px e aparece, no tempo --dur', () => {
    const { keyframes, options } = listKeyframes('add', TOKENS);
    expect(keyframes[0]).toEqual({ opacity: 0, transform: 'translateY(4px)' });
    expect(animated(keyframes)).toEqual(['opacity', 'transform']);
    expect(options).toEqual({ duration: 180, easing: TOKENS.ease });
  });

  it('o item que sai só se apaga, no tempo curto', () => {
    const { keyframes, options } = listKeyframes('remove', TOKENS);
    expect(animated(keyframes)).toEqual(['opacity']);
    expect(options.duration).toBe(120);
  });

  it('o item que muda de lugar desliza do lugar antigo até o novo, só por transform', () => {
    const { keyframes, options } = listKeyframes(
      'remain',
      TOKENS,
      { top: 100, left: 0 },
      { top: 40, left: 0 },
    );
    expect(keyframes[0]).toEqual({ transform: 'translate(0px, -60px)' });
    expect(animated(keyframes)).toEqual(['transform']);
    expect(options.duration).toBe(180);
  });

  it('o item que só mudou de tamanho não anima nada (largura e altura nunca se animam)', () => {
    const { keyframes, options } = listKeyframes(
      'remain',
      TOKENS,
      { top: 10, left: 5 },
      { top: 10, left: 5 },
    );
    expect(keyframes).toEqual([]);
    expect(options.duration).toBe(0);
  });
});

describe('readMotionTokens', () => {
  it('lê os tempos e a curva das variáveis do elemento', () => {
    const root = document.createElement('div');
    root.style.setProperty('--dur', '200ms');
    root.style.setProperty('--dur-fast', '90ms');
    root.style.setProperty('--ease', 'linear');
    document.body.append(root);
    expect(readMotionTokens(root)).toEqual({ dur: 200, durFast: 90, ease: 'linear' });
    root.remove();
  });

  it('sem as variáveis (ou com valor estranho), usa os tempos de tokens.css', () => {
    const root = document.createElement('div');
    root.style.setProperty('--dur', '0.2s');
    document.body.append(root);
    expect(readMotionTokens(root)).toEqual(TOKENS);
    root.remove();
  });
});

describe('useListMotion', () => {
  function List({ items }: { items: string[] }) {
    const ref = useListMotion<HTMLUListElement>();
    return (
      <ul ref={ref}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  it('sem a Web Animations API (jsdom) não liga nada: a lista troca na hora e sem estilo escrito', () => {
    const { container, rerender } = render(<List items={['a', 'b']} />);
    rerender(<List items={['b', 'c']} />);
    const list = container.querySelector('ul');
    expect([...(list?.children ?? [])].map((item) => item.textContent)).toEqual(['b', 'c']);
    expect(list?.getAttribute('style')).toBeNull();
  });
});
