import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { hasOpenOverlay, useOverlayOpen } from '../../src/renderer/overlay-guard';

/** Põe na página a casca mínima do app: `#root` dentro de `body`. */
function root(): HTMLElement {
  const element = document.createElement('div');
  element.id = 'root';
  document.body.append(element);
  return element;
}

/** Um nó solto em `body` com um filho do papel dado: é assim que um portal do Radix chega. */
function portal(role: string): HTMLElement {
  const wrapper = document.createElement('div');
  const inner = document.createElement('div');
  inner.setAttribute('role', role);
  wrapper.append(inner);
  return wrapper;
}

const extras: HTMLElement[] = [];
function attach<T extends HTMLElement>(parent: HTMLElement, node: T): T {
  parent.append(node);
  extras.push(node);
  return node;
}

afterEach(() => {
  for (const node of extras.splice(0)) node.remove();
  document.getElementById('root')?.remove();
});

describe('hasOpenOverlay', () => {
  it('é falso no documento limpo', () => {
    root();
    expect(hasOpenOverlay(document)).toBe(false);
  });

  it.each(['menu', 'dialog', 'listbox'])('é verdadeiro com um %s num portal em body', (role) => {
    root();
    attach(document.body, portal(role));
    expect(hasOpenOverlay(document)).toBe(true);
  });

  it('é falso com o mesmo menu dentro de #root', () => {
    attach(root(), portal('menu'));
    expect(hasOpenOverlay(document)).toBe(false);
  });

  it('dica não conta', () => {
    root();
    attach(document.body, portal('tooltip'));
    expect(hasOpenOverlay(document)).toBe(false);
  });

  it('um <dialog> aberto conta, mesmo dentro de #root', () => {
    const dialog = attach(root(), document.createElement('dialog'));
    expect(hasOpenOverlay(document)).toBe(false);
    dialog.setAttribute('open', '');
    expect(hasOpenOverlay(document)).toBe(true);
  });
});

function Probe() {
  return <p>{useOverlayOpen() ? 'aberta' : 'fechada'}</p>;
}

describe('useOverlayOpen', () => {
  it('muda ao acrescentar e ao tirar o nó', async () => {
    render(<Probe />);
    expect(screen.getByText('fechada')).toBeInTheDocument();
    const node = portal('menu');
    await act(async () => {
      attach(document.body, node);
      await Promise.resolve();
    });
    expect(screen.getByText('aberta')).toBeInTheDocument();
    await act(async () => {
      node.remove();
      await Promise.resolve();
    });
    expect(screen.getByText('fechada')).toBeInTheDocument();
  });

  it('muda quando um <dialog> abre e fecha', async () => {
    const dialog = attach(document.body, document.createElement('dialog'));
    render(<Probe />);
    await act(async () => {
      dialog.setAttribute('open', '');
      await Promise.resolve();
    });
    expect(screen.getByText('aberta')).toBeInTheDocument();
    await act(async () => {
      dialog.removeAttribute('open');
      await Promise.resolve();
    });
    expect(screen.getByText('fechada')).toBeInTheDocument();
  });
});
