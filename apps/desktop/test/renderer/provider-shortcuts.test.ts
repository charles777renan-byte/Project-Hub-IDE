import { describe, expect, it } from 'vitest';
import {
  providerShortcutIndex,
  providerShortcutKeys,
  providerShortcutLabel,
} from '../../src/renderer/workspace/provider-shortcuts';

const press = (code: string, extra: Partial<KeyboardEventInit> = {}) => ({
  code,
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  ...extra,
});

describe('atalhos dos programas', () => {
  it('Ctrl+Alt+1 a Ctrl+Alt+9 apontam para a posição 0 a 8 do menu', () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      expect(providerShortcutIndex(press(`Digit${digit}`))).toBe(digit - 1);
    }
  });

  it('lê a tecla física: o AltGr do teclado ABNT2 troca o `key` por ¹ ² ³, mas o `code` fica', () => {
    expect(providerShortcutIndex(press('Digit1'))).toBe(0);
  });

  it('ignora o 0, as letras e o teclado numérico', () => {
    expect(providerShortcutIndex(press('Digit0'))).toBeNull();
    expect(providerShortcutIndex(press('KeyB'))).toBeNull();
    expect(providerShortcutIndex(press('Numpad1'))).toBeNull();
  });

  it('exige Ctrl e Alt juntos, sem Shift nem Meta', () => {
    expect(providerShortcutIndex(press('Digit1', { ctrlKey: false }))).toBeNull();
    expect(providerShortcutIndex(press('Digit1', { altKey: false }))).toBeNull();
    expect(providerShortcutIndex(press('Digit1', { shiftKey: true }))).toBeNull();
    expect(providerShortcutIndex(press('Digit1', { metaKey: true }))).toBeNull();
  });

  it('o rótulo do menu e o aria-keyshortcuts saem da mesma posição', () => {
    expect(providerShortcutLabel(0)).toBe('Ctrl+Alt+1');
    expect(providerShortcutLabel(5)).toBe('Ctrl+Alt+6');
    expect(providerShortcutKeys(0)).toBe('Control+Alt+1');
    expect(providerShortcutKeys(8)).toBe('Control+Alt+9');
  });

  it('a partir da décima posição não há atalho', () => {
    expect(providerShortcutLabel(9)).toBeUndefined();
    expect(providerShortcutKeys(9)).toBeUndefined();
    expect(providerShortcutLabel(-1)).toBeUndefined();
  });
});
