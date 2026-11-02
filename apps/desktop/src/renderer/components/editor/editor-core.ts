import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { indentGuides } from './indent-guides';
import { editorHighlight, editorTheme } from './editor-theme';

/*
 * O miolo do editor: tudo o que importa o CodeMirror fica aqui, e o `CodeEditor` só chama este módulo por
 * `import()`. Assim o CodeMirror vai num chunk próprio, lido quando o primeiro arquivo abre.
 */

export type EditorHandle = {
  /** Troca o documento inteiro por `text` sem avisar `onChange` nem entrar no histórico. Igual ao atual: nada. */
  setValue: (text: string) => void;
  setReadOnly: (readOnly: boolean) => void;
  focus: () => void;
  /** Pede nova medida do texto: o editor foi montado escondido e acabou de aparecer. */
  measure: () => void;
  destroy: () => void;
};

/** A posição do cursor para a barra de status: 1-based, em caracteres (não em bytes nem em unidades UTF-16). */
export type CursorInfo = { line: number; column: number; selected: number };

export type MountOptions = {
  host: HTMLElement;
  doc: string;
  language: Extension | null;
  readOnly: boolean;
  ariaLabel: string;
  onChange: (text: string) => void;
  onCursor?: (info: CursorInfo) => void;
};

/** Quantos caracteres tem o trecho: um emoji conta 1, mesmo ocupando duas unidades UTF-16. */
function charCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

function cursorOf(state: EditorState): CursorInfo {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  let selected = 0;
  for (const range of state.selection.ranges) {
    if (!range.empty) selected += charCount(state.sliceDoc(range.from, range.to));
  }
  return {
    line: line.number,
    column: charCount(state.sliceDoc(line.from, main.head)) + 1,
    selected,
  };
}

/** Marca a troca de documento que veio de fora (recarga do disco): ela não é uma edição da pessoa. */
const external = Annotation.define<boolean>();

const readOnlyCompartment = new Compartment();

/**
 * Monta o editor no Shadow Root de `host` (criado na primeira vez). No `document` o CodeMirror injeta um
 * <style>, que a CSP (`style-src 'self'`) bloqueia; na raiz de um Shadow Root ele usa `adoptedStyleSheets`.
 */
export function mountEditor(options: MountOptions): EditorHandle {
  const { host, doc, language, readOnly, ariaLabel, onChange, onCursor } = options;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    search({ top: true }),
    keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
    syntaxHighlighting(editorHighlight),
    bracketMatching(),
    highlightSelectionMatches(),
    indentGuides(),
    editorTheme,
    EditorState.phrases.of({ ...RIGHT_PANEL_TEXT.editor.find }),
    EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) onCursor?.(cursorOf(update.state));
      if (!update.docChanged) return;
      if (update.transactions.some((transaction) => transaction.annotation(external) === true))
        return;
      onChange(update.state.doc.toString());
    }),
  ];
  if (language !== null) extensions.push(language);
  const view = new EditorView({
    root: shadow,
    parent: shadow,
    state: EditorState.create({ doc, extensions }),
  });
  onCursor?.(cursorOf(view.state));
  return {
    setValue(text) {
      if (view.state.doc.toString() === text) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      });
    },
    setReadOnly(value) {
      view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(value)) });
    },
    focus() {
      view.focus();
    },
    measure() {
      view.requestMeasure();
    },
    destroy() {
      view.destroy();
    },
  };
}
