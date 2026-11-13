import { describe, expect, it } from 'vitest';
import {
  fitsContent,
  loadErrorOf,
  shortcutOf,
  toViewBounds,
} from '../src/main/browser/page-events';

const key = (
  name: string,
  mods: Partial<{
    control: boolean;
    alt: boolean;
    shift: boolean;
    meta: boolean;
    type: string;
  }> = {},
) => ({
  type: 'keyDown',
  key: name,
  control: false,
  alt: false,
  shift: false,
  meta: false,
  ...mods,
});

describe('shortcutOf', () => {
  it.each([
    ['b', { control: true, alt: true }, 'toggle-right-panel'],
    ['B', { control: true, alt: true }, 'toggle-right-panel'],
    ['l', { control: true }, 'focus-address'],
    ['F6', {}, 'focus-toolbar'],
    ['t', { control: true }, 'new-tab'],
    ['w', { control: true }, 'close-tab'],
    ['r', { control: true }, 'reload'],
    ['F5', {}, 'reload'],
    ['ArrowLeft', { alt: true }, 'back'],
    ['ArrowRight', { alt: true }, 'forward'],
  ] as const)('%s com %j é %s', (name, mods, action) => {
    expect(shortcutOf(key(name, mods))).toBe(action);
  });

  it.each([
    ['l', { control: true, type: 'keyUp' }],
    ['t', { control: true, shift: true }],
    ['l', {}],
    ['b', { control: true }],
    ['r', { control: true, alt: true }],
    ['ArrowLeft', {}],
    ['ArrowLeft', { alt: true, control: true }],
    ['F6', { control: true }],
    ['a', { control: true }],
  ] as const)('%s com %j segue para a página', (name, mods) => {
    expect(shortcutOf(key(name, mods))).toBeUndefined();
  });
});

describe('loadErrorOf', () => {
  it.each([
    [-106, 'OFFLINE'],
    [-102, 'REFUSED'],
    [-101, 'REFUSED'],
    [-104, 'REFUSED'],
    [-118, 'REFUSED'],
    [-105, 'NOT_FOUND'],
    [-137, 'NOT_FOUND'],
    [-200, 'CERTIFICATE'],
    [-202, 'CERTIFICATE'],
    [-219, 'CERTIFICATE'],
    [-220, 'UNKNOWN'],
    [-2, 'UNKNOWN'],
    [-999, 'UNKNOWN'],
  ] as const)('o código %d é %s', (code, expected) => {
    expect(loadErrorOf(code)).toBe(expected);
  });

  it('carga cancelada (-3) não é erro', () => {
    expect(loadErrorOf(-3)).toBeNull();
  });
});

describe('toViewBounds', () => {
  it('com zoom 1 só arredonda', () => {
    expect(toViewBounds({ x: 10.4, y: 20.6, width: 300.5, height: 400 }, 1)).toEqual({
      x: 10,
      y: 21,
      width: 301,
      height: 400,
    });
  });

  it('multiplica pelo zoom da janela', () => {
    expect(toViewBounds({ x: 10.4, y: 20.6, width: 300.5, height: 400 }, 1.25)).toEqual({
      x: 13,
      y: 26,
      width: 376,
      height: 500,
    });
  });
});

describe('fitsContent', () => {
  const content = { width: 1600, height: 900 };

  it('aceita um retângulo dentro da área', () => {
    expect(fitsContent({ x: 1000, y: 80, width: 600, height: 780 }, content)).toBe(true);
  });

  it.each([
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: -1, width: 10, height: 10 },
    { x: 0, y: 0, width: 1700, height: 10 },
    { x: 1200, y: 0, width: 600, height: 10 },
    { x: 0, y: 500, width: 10, height: 600 },
  ])('recusa %j', (bounds) => {
    expect(fitsContent(bounds, content)).toBe(false);
  });
});
