import { useId, type ReactNode } from 'react';
import type { Tone } from '../mission-text';
import { StatusChip } from './StatusChip';

export type PanelAccent =
  | 'violet'
  | 'red'
  | 'blue'
  | 'magenta'
  | 'orange'
  | 'lime'
  | 'cyan'
  | 'yellow';

/**
 * Painel do workspace: faixa de 3px no topo na cor do acento, cabeçalho (ponto, título, meta e tag
 * opcionais) e corpo com rolagem própria. A região tem o nome do título; o `id` vem de `useId`, único
 * por instância. A cor vem da classe `panel--<acento>` (app.css), nunca de estilo inline.
 */
export function Panel({
  title,
  accent,
  meta,
  tag,
  children,
}: {
  title: string;
  accent: PanelAccent;
  meta?: string;
  tag?: { label: string; tone: Tone };
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={`panel panel--${accent}`}>
      <header className="panel__head">
        <span aria-hidden="true" className="panel__dot" />
        <h2 id={titleId} className="panel__title">
          {title}
        </h2>
        {meta === undefined ? null : <span className="panel__meta">{meta}</span>}
        {tag === undefined ? null : (
          <span className="panel__tag">
            <StatusChip label={tag.label} tone={tag.tone} />
          </span>
        )}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

/** Estado vazio de um painel: uma frase em `--muted`. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="panel__empty">{children}</p>;
}
