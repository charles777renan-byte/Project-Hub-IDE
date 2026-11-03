/** As cinco formas da barra de formatação do comentário. Só inserem a sintaxe Markdown no texto. */
export type CommentFormat = 'bold' | 'italic' | 'code' | 'quote' | 'list';

/** O texto depois da inserção e a seleção que o campo deve ter. */
export type CommentEdit = { text: string; start: number; end: number };

const WRAPPERS: Record<'bold' | 'italic' | 'code', string> = {
  bold: '**',
  italic: '_',
  code: '`',
};

const PREFIXES: Record<'quote' | 'list', string> = { quote: '> ', list: '- ' };

/** Cerca a seleção (ou o cursor) com o marcador; sem seleção, o cursor fica entre os dois. */
function wrap(marker: string, text: string, start: number, end: number): CommentEdit {
  const inner = text.slice(start, end);
  return {
    text: `${text.slice(0, start)}${marker}${inner}${marker}${text.slice(end)}`,
    start: start + marker.length,
    end: end + marker.length,
  };
}

/** Põe o prefixo no começo de cada linha tocada pela seleção (uma seleção que termina numa quebra não toca a seguinte). */
function prefixLines(prefix: string, text: string, start: number, end: number): CommentEdit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = text.indexOf('\n', last);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const changed = lines.map((line) => `${prefix}${line}`).join('\n');
  return {
    text: `${text.slice(0, lineStart)}${changed}${text.slice(lineEnd)}`,
    start: start + prefix.length,
    end: end + prefix.length * lines.length,
  };
}

/** Aplica uma forma ao texto, entre `start` e `end` (a seleção do campo). */
export function applyFormat(
  format: CommentFormat,
  text: string,
  start: number,
  end: number,
): CommentEdit {
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.max(from, Math.min(Math.max(start, end), text.length));
  if (format === 'quote' || format === 'list') {
    return prefixLines(PREFIXES[format], text, from, to);
  }
  return wrap(WRAPPERS[format], text, from, to);
}
