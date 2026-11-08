import { act } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * O jsdom não tem IntersectionObserver nem layout. Este falso guarda o que cada instância observa e deixa o teste
 * dizer, por aba, se ela está inteira à vista (`show`): é o que o navegador faria ao medir a faixa.
 */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Avisa só das abas dadas, como o navegador: quem não mudou não vem na lista. */
  report(changes: ReadonlyMap<Element, boolean>) {
    const entries = [...changes].map(
      ([target, visible]) =>
        ({
          target,
          isIntersecting: visible,
          intersectionRatio: visible ? 1 : 0,
        }) as unknown as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** A instância viva (a mais recente que ainda observa algo). */
export function live(): FakeIntersectionObserver {
  const found = FakeIntersectionObserver.instances.filter((item) => !item.disconnected).at(-1);
  if (found === undefined) throw new Error('Nenhum IntersectionObserver vivo.');
  return found;
}

export function tabEl(id: string): Element {
  const found = [...live().observed].find((item) => item.getAttribute('data-tab-id') === id);
  if (found === undefined) throw new Error(`A aba ${id} não está sendo observada.`);
  return found;
}

/** Diz ao observador vivo quais abas estão à vista (as outras ficam fora). */
export function show(...visibleIds: string[]) {
  const changes = new Map<Element, boolean>();
  for (const element of live().observed) {
    changes.set(element, visibleIds.includes(element.getAttribute('data-tab-id') ?? ''));
  }
  act(() => live().report(changes));
}

/** Instala o falso a cada teste (e o `scrollIntoView`, que o jsdom não tem) e o tira ao fim. */
export function useFakeIntersectionObserver(): { scrollIntoView: ReturnType<typeof vi.fn> } {
  const handle = { scrollIntoView: vi.fn() };
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    handle.scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView =
      handle.scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  return handle;
}
