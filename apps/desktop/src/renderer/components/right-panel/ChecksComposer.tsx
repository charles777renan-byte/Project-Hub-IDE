import { useLayoutEffect, useRef, type RefObject } from 'react';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { Hint } from '../Hint';
import { Bold, Code, ICON_PROPS, Italic, List, type LucideIcon, Quote } from '../Icon';
import { applyFormat, type CommentFormat } from './comment-format';

const TEXT = RIGHT_PANEL_TEXT.checks.comments;

const TOOLS: { format: CommentFormat; label: string; icon: LucideIcon }[] = [
  { format: 'bold', label: TEXT.bold, icon: Bold },
  { format: 'italic', label: TEXT.italic, icon: Italic },
  { format: 'code', label: TEXT.code, icon: Code },
  { format: 'quote', label: TEXT.quote, icon: Quote },
  { format: 'list', label: TEXT.list, icon: List },
];

/**
 * O campo do novo comentário: a barra B, I, código, citação e lista, o texto e os botões Cancelar e Enviar. A barra
 * só insere a sintaxe Markdown no texto (em volta da seleção, ou no começo das linhas), sem renderizar nada. O
 * texto mora em quem monta, para não se perder se a escrita falhar. Enviar fica desligado com o texto vazio ou só
 * com espaços e enquanto uma escrita roda (nela o campo vira somente leitura, como a barra e os botões); Cancelar
 * limpa o texto.
 */
export function ChecksComposer({
  value,
  onChange,
  disabled,
  onSend,
  fieldRef,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Há uma escrita em andamento: Enviar e a barra ficam desligados. */
  disabled: boolean;
  onSend: () => void;
  /** O campo, para quem monta devolver o foco a ele depois de enviar. */
  fieldRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  // Depois que o React grava o texto novo, a seleção e o foco voltam ao campo.
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const field = fieldRef.current;
    if (selection === null || field === null) return;
    pendingSelection.current = null;
    field.focus();
    field.setSelectionRange(selection.start, selection.end);
  }, [value]);

  function format(kind: CommentFormat) {
    const field = fieldRef.current;
    if (field === null) return;
    const edit = applyFormat(kind, value, field.selectionStart, field.selectionEnd);
    pendingSelection.current = { start: edit.start, end: edit.end };
    onChange(edit.text);
  }

  const empty = value.trim() === '';
  return (
    <div className="checks-composer">
      <div className="checks-composer__toolbar" role="toolbar" aria-label={TEXT.toolbar}>
        {TOOLS.map(({ format: kind, label, icon: Icon }) => (
          <Hint key={kind} label={label}>
            <button
              type="button"
              className="checks-composer__tool"
              aria-label={label}
              disabled={disabled}
              onClick={() => format(kind)}
            >
              <Icon {...ICON_PROPS} />
            </button>
          </Hint>
        ))}
      </div>
      <textarea
        ref={fieldRef}
        className="checks-composer__field"
        aria-label={TEXT.field}
        placeholder={TEXT.placeholder}
        rows={4}
        value={value}
        readOnly={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="checks-composer__actions">
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || value === ''}
          onClick={() => onChange('')}
        >
          {TEXT.cancel}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || empty}
          onClick={onSend}
        >
          {TEXT.send}
        </button>
      </div>
    </div>
  );
}
