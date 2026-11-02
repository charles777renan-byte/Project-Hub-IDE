import { HighlightStyle, type TagStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags, type Tag } from '@lezer/highlight';

/*
 * O visual do editor. O CodeMirror mora num Shadow Root (a CSP bloqueia o <style> que ele injetaria no documento),
 * e o CSS global não entra lá dentro: tema e realce são escritos aqui, só com `var(--token)` de tokens.css, que
 * herdam pelo Shadow Root. Nenhuma cor literal. O CodeMirror aplica estas regras por CSSOM (`adoptedStyleSheets`),
 * que a CSP deixa passar. As cores do código são as `--syntax-*` (a paleta Dark+ do VS Code); o lima fica só com
 * o anel de foco.
 */

export const editorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'var(--surface)',
      color: 'var(--text)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
    },
    // O anel de foco do app (lima, 2px) por dentro: o contêiner corta o que passa da borda.
    '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.6' },
    '.cm-content': { caretColor: 'var(--text)', padding: 'var(--space-2) 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
      { backgroundColor: 'var(--fill)' },
    '.cm-activeLine': { backgroundColor: 'var(--surface-2)' },
    '.cm-gutters': {
      backgroundColor: 'var(--surface)',
      color: 'var(--muted)',
      border: 'none',
      borderRight: '1px solid var(--line)',
    },
    // Colchete pareado e ocorrências da palavra selecionada: contorno além do fundo, para não depender da cor.
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--fill)',
      outline: '1px solid var(--field-line)',
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'transparent',
      outline: '1px solid var(--syntax-invalid)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--fill)',
      outline: '1px solid var(--field-line)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--surface-2)', color: 'var(--text)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--space-2) 0 var(--space-3)' },
    // A busca (Ctrl+F): a faixa no alto, com campos e botões no mesmo desenho do resto do app.
    '.cm-panels': {
      backgroundColor: 'var(--surface-2)',
      color: 'var(--text)',
      fontFamily: 'var(--font-sans)',
    },
    '.cm-panels-top': { borderBottom: '1px solid var(--line)' },
    '.cm-panel.cm-search': {
      padding: 'var(--space-2) var(--space-5) var(--space-2) var(--space-3)',
    },
    '.cm-panel.cm-search label': { fontSize: 'var(--text-xs)' },
    '.cm-textfield': {
      border: '1px solid var(--field-line)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'var(--bg)',
      color: 'var(--text)',
    },
    '.cm-textfield:focus-visible': { outline: '2px solid var(--focus)', outlineOffset: '1px' },
    '.cm-button': {
      border: '1px solid var(--field-line)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'transparent',
      backgroundImage: 'none',
      color: 'var(--text)',
    },
    '.cm-button:hover': { backgroundColor: 'var(--fill)' },
    '.cm-button:focus-visible, .cm-panel.cm-search [name=close]:focus-visible': {
      outline: '2px solid var(--focus)',
      outlineOffset: '1px',
    },
    '.cm-panel.cm-search [name=close]': { color: 'var(--text)' },
    // Os achados também têm contorno, para a marca não ficar só na cor.
    '.cm-searchMatch': {
      backgroundColor: 'var(--fill)',
      outline: '1px solid var(--field-line)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--fill)',
      outline: '2px solid var(--yellow)',
    },
  },
  { dark: true },
);

/** A cor de um grupo de tags, sempre por token `--syntax-*` (ou `--text` no que não tem cor própria). */
const colored = (color: string, ...group: Tag[]): TagStyle => ({
  tag: group,
  color: `var(${color})`,
});

export const editorHighlight = HighlightStyle.define([
  colored(
    '--syntax-keyword',
    tags.keyword,
    tags.operatorKeyword,
    tags.definitionKeyword,
    tags.modifier,
    tags.self,
    tags.atom,
    tags.bool,
    tags.null,
  ),
  colored('--syntax-control', tags.controlKeyword, tags.moduleKeyword),
  colored('--syntax-type', tags.typeName, tags.className, tags.namespace),
  colored(
    '--syntax-function',
    tags.function(tags.variableName),
    tags.function(tags.propertyName),
    tags.definition(tags.function(tags.variableName)),
    tags.definition(tags.function(tags.propertyName)),
    tags.macroName,
  ),
  colored(
    '--syntax-variable',
    tags.variableName,
    tags.definition(tags.variableName),
    tags.labelName,
    tags.constant(tags.variableName),
  ),
  colored('--syntax-property', tags.propertyName, tags.definition(tags.propertyName)),
  colored('--syntax-number', tags.number, tags.integer, tags.float),
  colored(
    '--syntax-string',
    tags.string,
    tags.special(tags.string),
    tags.character,
    tags.attributeValue,
    tags.monospace,
  ),
  colored('--syntax-regexp', tags.regexp, tags.escape),
  {
    ...colored(
      '--syntax-comment',
      tags.comment,
      tags.lineComment,
      tags.blockComment,
      tags.docComment,
    ),
    fontStyle: 'italic',
  },
  colored('--text', tags.operator, tags.punctuation, tags.separator, tags.bracket, tags.content),
  colored('--syntax-tag', tags.tagName, tags.angleBracket),
  colored('--syntax-attribute', tags.attributeName),
  { ...colored('--syntax-heading', tags.heading), fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { ...colored('--syntax-link', tags.link, tags.url), textDecoration: 'underline' },
  { ...colored('--syntax-invalid', tags.invalid), textDecoration: 'underline' },
]);
