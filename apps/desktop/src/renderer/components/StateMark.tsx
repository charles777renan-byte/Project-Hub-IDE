import { MARKS, type MarkKind } from '../state-mark';

/**
 * Marca de estado: a forma (escondida dos leitores de tela) mais o rótulo em texto. Com `withLabel` o
 * rótulo fica visível; sem ele, vira o `title` e um texto só para leitor de tela, para a forma sozinha
 * nunca ser a única pista. O estado ativo pulsa, e a CSS para a animação com `prefers-reduced-motion`.
 */
export function StateMark({ kind, withLabel = false }: { kind: MarkKind; withLabel?: boolean }) {
  const { glyph, label } = MARKS[kind];
  return (
    <span className={`state-mark state-mark--${kind}`} {...(withLabel ? {} : { title: label })}>
      <span aria-hidden="true" className="state-mark__glyph">
        {glyph}
      </span>
      <span className={withLabel ? 'state-mark__label' : 'state-mark__sr'}>{label}</span>
    </span>
  );
}
