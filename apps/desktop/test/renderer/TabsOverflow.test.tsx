import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabsOverflow, useTabsOverflow } from '../../src/renderer/components/TabsOverflow';

/**
 * O jsdom não tem IntersectionObserver nem layout. Este falso guarda o que cada instância observa e deixa o teste
 * dizer, por aba, se ela está inteira à vista (`show`): é o que o navegador faria ao medir a faixa.
 */
class FakeIntersectionObserver {
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
function live(): FakeIntersectionObserver {
  const found = FakeIntersectionObserver.instances.filter((item) => !item.disconnected).at(-1);
  if (found === undefined) throw new Error('Nenhum IntersectionObserver vivo.');
  return found;
}

function tabEl(id: string): Element {
  const found = [...live().observed].find((item) => item.getAttribute('data-tab-id') === id);
  if (found === undefined) throw new Error(`A aba ${id} não está sendo observada.`);
  return found;
}

/** Diz ao observador vivo quais abas estão à vista (as outras ficam fora). */
function show(...visibleIds: string[]) {
  const changes = new Map<Element, boolean>();
  for (const element of live().observed) {
    changes.set(element, visibleIds.includes(element.getAttribute('data-tab-id') ?? ''));
  }
  act(() => live().report(changes));
}

const IDS = ['a', 'b', 'c', 'd'];
let scrollIntoView: ReturnType<typeof vi.fn>;
let original: typeof globalThis.IntersectionObserver | undefined;

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  original = globalThis.IntersectionObserver;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView =
    scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (original !== undefined) globalThis.IntersectionObserver = original;
});

/** Uma faixa de abas de teste: a lista de ids muda por `setIds`, e o menu leva só as escondidas. */
let setIdsFromOutside: (ids: string[]) => void = () => undefined;
let selected: string[] = [];

function Strip({ initial = IDS }: { initial?: string[] }) {
  const [ids, setIds] = useState(initial);
  setIdsFromOutside = setIds;
  const ref = useRef<HTMLDivElement>(null);
  const { start, end, hidden } = useTabsOverflow(ref);
  return (
    <>
      <div
        ref={ref}
        role="tablist"
        aria-label="Faixa"
        data-fade-start={start ? 'true' : undefined}
        data-fade-end={end ? 'true' : undefined}
      >
        {ids.map((id) => (
          <button key={id} type="button" role="tab" data-tab-id={id}>
            Aba {id}
          </button>
        ))}
      </div>
      <TabsOverflow
        items={ids.filter((id) => hidden.includes(id)).map((id) => ({ id, label: `Aba ${id}` }))}
        onSelect={(id) => selected.push(id)}
      />
    </>
  );
}

const trigger = () => screen.queryByRole('button', { name: 'Abas fora de vista' });

describe('useTabsOverflow e TabsOverflow', () => {
  beforeEach(() => {
    selected = [];
  });

  it('com todas as abas à vista, não há botão "⌄" nem atributo de esmaecimento', () => {
    render(<Strip />);
    show('a', 'b', 'c', 'd');

    expect(trigger()).toBeNull();
    const strip = screen.getByRole('tablist', { name: 'Faixa' });
    expect(strip).not.toHaveAttribute('data-fade-start');
    expect(strip).not.toHaveAttribute('data-fade-end');
  });

  it('observa cada aba contra a própria faixa', () => {
    render(<Strip />);

    expect(live().options?.root).toBe(screen.getByRole('tablist', { name: 'Faixa' }));
    expect([...live().observed].map((item) => item.getAttribute('data-tab-id'))).toEqual(IDS);
  });

  it('abas escondidas no fim esmaecem só o fim', () => {
    render(<Strip />);
    show('a', 'b');

    const strip = screen.getByRole('tablist', { name: 'Faixa' });
    expect(strip).toHaveAttribute('data-fade-end', 'true');
    expect(strip).not.toHaveAttribute('data-fade-start');
  });

  it('abas escondidas no começo esmaecem só o começo', () => {
    render(<Strip />);
    show('c', 'd');

    const strip = screen.getByRole('tablist', { name: 'Faixa' });
    expect(strip).toHaveAttribute('data-fade-start', 'true');
    expect(strip).not.toHaveAttribute('data-fade-end');
  });

  it('escondidas dos dois lados esmaecem os dois', () => {
    render(<Strip />);
    show('b', 'c');

    const strip = screen.getByRole('tablist', { name: 'Faixa' });
    expect(strip).toHaveAttribute('data-fade-start', 'true');
    expect(strip).toHaveAttribute('data-fade-end', 'true');
  });

  it('o botão "Abas fora de vista" lista só as escondidas', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    show('a', 'b');

    const button = screen.getByRole('button', { name: 'Abas fora de vista' });
    await user.click(button);

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Aba c', 'Aba d']);
  });

  it('escolher uma aba chama onSelect com o id e rola a aba para a vista', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    show('a', 'b');

    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    await user.click(screen.getByRole('menuitem', { name: 'Aba d' }));

    expect(selected).toEqual(['d']);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(tabEl('d'));
  });

  it('o botão se opera pelo teclado e some quando as abas voltam à vista', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    show('a', 'b', 'c');

    const button = screen.getByRole('button', { name: 'Abas fora de vista' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: 'Aba d' })).toBeVisible();
    await user.keyboard('{Escape}');

    show('a', 'b', 'c', 'd');
    expect(trigger()).toBeNull();
  });

  it('guarda o último estado de cada aba: um aviso só da que mudou não esquece as outras', () => {
    render(<Strip />);
    show('a', 'b');
    // Só a "c" muda (entra à vista): "d" continua escondida.
    act(() => live().report(new Map([[tabEl('c'), true]])));

    const strip = screen.getByRole('tablist', { name: 'Faixa' });
    expect(strip).toHaveAttribute('data-fade-end', 'true');
    expect(strip).not.toHaveAttribute('data-fade-start');
    expect(trigger()).not.toBeNull();
  });

  it('observa de novo quando a lista de abas muda e esquece as que saíram', async () => {
    const user = userEvent.setup();
    render(<Strip />);
    show('a');
    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')).toHaveLength(3);
    await user.keyboard('{Escape}');

    act(() => setIdsFromOutside(['a', 'b', 'e']));
    await waitFor(() =>
      expect([...live().observed].map((item) => item.getAttribute('data-tab-id'))).toEqual([
        'a',
        'b',
        'e',
      ]),
    );
    show('a', 'b');

    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Aba e']);
  });

  it('desconecta o observador ao desmontar', () => {
    const { unmount } = render(<Strip />);
    const observer = live();

    unmount();

    expect(observer.disconnected).toBe(true);
  });

  it('sem IntersectionObserver (jsdom puro), nada fica escondido e nada quebra', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    render(<Strip />);

    expect(trigger()).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Faixa' })).not.toHaveAttribute('data-fade-end');
  });
});
