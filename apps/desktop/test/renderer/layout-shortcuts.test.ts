import { describe, expect, it } from 'vitest';
import { layoutShortcut } from '../../src/renderer/workspace/layout-shortcuts';

const keys = (code: string, mods: string) => ({
  code,
  ctrlKey: mods.includes('ctrl'),
  altKey: mods.includes('alt'),
  shiftKey: mods.includes('shift'),
  metaKey: mods.includes('meta'),
});

describe('layoutShortcut', () => {
  it('Ctrl+Alt+setas leva o foco ao vizinho daquele lado', () => {
    expect(layoutShortcut(keys('ArrowLeft', 'ctrl alt'))).toEqual({ type: 'focus', side: 'left' });
    expect(layoutShortcut(keys('ArrowRight', 'ctrl alt'))).toEqual({
      type: 'focus',
      side: 'right',
    });
    expect(layoutShortcut(keys('ArrowUp', 'ctrl alt'))).toEqual({ type: 'focus', side: 'top' });
    expect(layoutShortcut(keys('ArrowDown', 'ctrl alt'))).toEqual({
      type: 'focus',
      side: 'bottom',
    });
  });

  it('Alt+Shift+setas troca o painel com o vizinho', () => {
    expect(layoutShortcut(keys('ArrowUp', 'alt shift'))).toEqual({ type: 'swap', side: 'top' });
    expect(layoutShortcut(keys('ArrowRight', 'alt shift'))).toEqual({
      type: 'swap',
      side: 'right',
    });
  });

  it('Alt+Shift+D duplica; Alt+Shift com + divide à direita e com − divide abaixo, também no teclado numérico', () => {
    expect(layoutShortcut(keys('KeyD', 'alt shift'))).toEqual({ type: 'duplicate' });
    expect(layoutShortcut(keys('Equal', 'alt shift'))).toEqual({ type: 'split', side: 'right' });
    expect(layoutShortcut(keys('NumpadAdd', 'alt shift'))).toEqual({
      type: 'split',
      side: 'right',
    });
    expect(layoutShortcut(keys('Minus', 'alt shift'))).toEqual({ type: 'split', side: 'bottom' });
    expect(layoutShortcut(keys('NumpadSubtract', 'alt shift'))).toEqual({
      type: 'split',
      side: 'bottom',
    });
  });

  it('Ctrl+Shift+W fecha o painel', () => {
    expect(layoutShortcut(keys('KeyW', 'ctrl shift'))).toEqual({ type: 'close' });
  });

  it('o que é do terminal passa: Alt+setas (palavra a palavra), Ctrl+W, Ctrl+Z, setas soltas e combinações com Meta', () => {
    expect(layoutShortcut(keys('ArrowLeft', 'alt'))).toBeNull();
    expect(layoutShortcut(keys('ArrowLeft', ''))).toBeNull();
    expect(layoutShortcut(keys('ArrowLeft', 'ctrl'))).toBeNull();
    expect(layoutShortcut(keys('KeyW', 'ctrl'))).toBeNull();
    expect(layoutShortcut(keys('KeyZ', 'ctrl'))).toBeNull();
    expect(layoutShortcut(keys('KeyD', 'alt'))).toBeNull();
    expect(layoutShortcut(keys('ArrowLeft', 'ctrl alt shift'))).toBeNull();
    expect(layoutShortcut(keys('ArrowLeft', 'ctrl alt meta'))).toBeNull();
    expect(layoutShortcut(keys('Digit1', 'ctrl alt'))).toBeNull();
  });
});
