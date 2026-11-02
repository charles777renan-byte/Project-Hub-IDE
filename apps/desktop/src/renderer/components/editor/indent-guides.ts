import { indentUnit } from '@codemirror/language';
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/*
 * Guias de indentação: uma linha vertical por nível, como no VS Code. Cada linha visível ganha a classe
 * `cm-indent-N` (N níveis) e `cm-indent-wU` (U colunas por nível); as regras do tema, geradas abaixo, desenham as
 * guias com `background-image` em `ch`. Nada de atributo `style` (a CSP bloqueia) e nada de elemento extra.
 * Só se decora o que está na tela (`view.visibleRanges`), nunca o documento inteiro.
 */

/** Níveis desenhados; o que passa disso fica sem guia (ninguém lê 12 níveis de recuo). */
const MAX_LEVELS = 12;
/** Colunas por nível que têm regra: de 1 a 8 cobre 1, 2, 3, 4 e 8 espaços e a tabulação de até 8. */
const MAX_UNIT = 8;
/** Até onde procurar, acima e abaixo, a linha com texto que dá o nível de uma linha em branco. */
const BLANK_SCAN_LIMIT = 200;

/** Largura, em colunas, do recuo de `text` (só o espaço em branco do começo) e se a linha tem texto. */
function measureIndent(text: string, tabSize: number): { columns: number; blank: boolean } {
  let columns = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\t') columns += tabSize - (columns % tabSize);
    else if (char === ' ') columns += 1;
    else return { columns, blank: false };
  }
  return { columns, blank: true };
}

/** Colunas de um nível: a unidade de indentação do estado (`indentUnit`), com a tabulação valendo `tabSize`. */
function unitWidth(state: EditorState): number {
  const unit = state.facet(indentUnit);
  const tabSize = state.tabSize;
  const width = measureIndent(unit, tabSize).columns;
  return Math.min(MAX_UNIT, Math.max(1, width > 0 ? width : tabSize));
}

/** O nível de indentação da linha `number` quando ela tem texto; `null` quando está em branco. */
function levelOf(state: EditorState, number: number, unit: number): number | null {
  const { columns, blank } = measureIndent(state.doc.line(number).text, state.tabSize);
  return blank ? null : Math.floor(columns / unit);
}

/** Nível da linha com texto mais próxima de `from` na direção `step`, ou 0 no fim do documento ou do limite. */
function nearestLevel(state: EditorState, from: number, step: 1 | -1, unit: number): number {
  const last = state.doc.lines;
  for (let n = from + step, seen = 0; n >= 1 && n <= last && seen < BLANK_SCAN_LIMIT; n += step) {
    const level = levelOf(state, n, unit);
    if (level !== null) return level;
    seen += 1;
  }
  return 0;
}

/**
 * Os níveis de cada linha. Linha em branco dentro de um bloco herda o nível do bloco: o menor entre o da
 * linha com texto de cima e o da de baixo, para a guia atravessar o vão sem passar do fim do bloco.
 */
export function indentLevel(state: EditorState, number: number): number {
  const unit = unitWidth(state);
  const own = levelOf(state, number, unit);
  if (own !== null) return own;
  return Math.min(nearestLevel(state, number, -1, unit), nearestLevel(state, number, 1, unit));
}

function decorate(view: EditorView): DecorationSet {
  const { state } = view;
  const unit = unitWidth(state);
  const builder = new RangeSetBuilder<Decoration>();
  let lastDecorated = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= lastDecorated) continue;
      lastDecorated = line.number;
      const level = Math.min(MAX_LEVELS, indentLevel(state, line.number));
      if (level < 1) continue;
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: `cm-indent-${level} cm-indent-w${unit}` }),
      );
    }
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorate(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = decorate(update.view);
    }
  },
  { decorations: (instance) => instance.decorations },
);

/**
 * Uma guia de 1px por nível, em `ch`, em camadas de `background-image` (e não no atalho `background`, que
 * zeraria a cor de fundo da linha atual). `content-box` conta a posição depois do recuo interno da linha.
 */
function guideRule(levels: number, unit: number, strongLast: boolean): Record<string, string> {
  const indexes = Array.from({ length: levels }, (_, level) => level);
  const color = (level: number): string =>
    strongLast && level === levels - 1 ? 'var(--fill)' : 'var(--line)';
  return {
    backgroundImage: indexes
      .map((level) => `linear-gradient(${color(level)}, ${color(level)})`)
      .join(', '),
    backgroundPosition: indexes.map((level) => `${level * unit}ch 0`).join(', '),
    backgroundSize: indexes.map(() => '1px 100%').join(', '),
    backgroundRepeat: 'no-repeat',
    backgroundOrigin: 'content-box',
  };
}

/** Uma regra por combinação de níveis e largura; a guia do nível da linha atual é um pouco mais forte. */
function themeRules(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  for (let unit = 1; unit <= MAX_UNIT; unit += 1) {
    for (let levels = 1; levels <= MAX_LEVELS; levels += 1) {
      const classes = `.cm-indent-${levels}.cm-indent-w${unit}`;
      rules[`.cm-line${classes}`] = guideRule(levels, unit, false);
      rules[`.cm-line.cm-activeLine${classes}`] = guideRule(levels, unit, true);
    }
  }
  return rules;
}

const guidesTheme = EditorView.theme(themeRules());

export function indentGuides(): Extension {
  return [plugin, guidesTheme];
}
