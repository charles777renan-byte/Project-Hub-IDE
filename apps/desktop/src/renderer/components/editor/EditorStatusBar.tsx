import type { CursorInfo } from './editor-core';
import { languageLabel, type LanguageId } from './languages';
import { RIGHT_PANEL_TEXT } from '../../mission-text';

const TEXT = RIGHT_PANEL_TEXT.editor.statusBar;

type EditorStatusBarProps = {
  cursor: CursorInfo;
  eol: 'lf' | 'crlf' | 'mixed';
  bom: boolean;
  language: LanguageId;
};

/**
 * A faixa de status abaixo do editor, no estilo do VS Code: posição do cursor (com o total selecionado),
 * codificação, fim de linha e linguagem. Só informa; `aria-live="off"` evita o leitor de tela anunciar cada seta.
 */
export function EditorStatusBar({ cursor, eol, bom, language }: EditorStatusBarProps) {
  return (
    <div role="status" aria-live="off" aria-label={TEXT.label} className="editor-status">
      <span className="editor-status__cursor">
        {TEXT.position(cursor.line, cursor.column)}
        {cursor.selected > 0 ? TEXT.selected(cursor.selected) : null}
      </span>
      <span>{bom ? TEXT.utf8Bom : TEXT.utf8}</span>
      <span>{TEXT.eol[eol]}</span>
      <span>{languageLabel(language)}</span>
    </div>
  );
}
