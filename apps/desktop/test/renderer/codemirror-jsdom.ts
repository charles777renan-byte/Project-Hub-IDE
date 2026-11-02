import { EditorView } from '@codemirror/view';

/**
 * O CodeMirror mede o texto com `Range.getClientRects` e `getBoundingClientRect`, que o jsdom não tem (não há
 * layout). Este stub devolve retângulos vazios: o editor monta, recebe texto e comandos, e nada além disso.
 * Chame uma vez antes de montar o editor.
 */
export function stubLayoutForCodeMirror(): void {
  const empty = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
  } as DOMRect;
  const rects = (): DOMRectList => {
    const list = [] as unknown as DOMRectList;
    Object.assign(list, { item: () => null });
    return list;
  };
  Range.prototype.getClientRects = rects;
  Range.prototype.getBoundingClientRect = () => empty;
}

/** O Shadow Root onde o editor mora: o `host` do `CodeEditor` é o filho `.code-editor__host` do `container`. */
export function shadowOf(container: HTMLElement): ShadowRoot {
  const host = container.querySelector('.code-editor__host');
  if (!(host instanceof HTMLElement) || host.shadowRoot === null) {
    throw new Error('O editor ainda não montou o Shadow Root.');
  }
  return host.shadowRoot;
}

/** A `EditorView` do editor montado no `container`. */
export function viewOf(container: HTMLElement): EditorView {
  const dom = shadowOf(container).querySelector('.cm-editor');
  const view = dom === null ? null : EditorView.findFromDOM(dom as HTMLElement);
  if (view === null) throw new Error('O editor ainda não montou.');
  return view;
}
