import { useId, type ReactNode } from 'react';
import type { Tone } from '../mission-text';
import { EmptyState } from './EmptyState';
import { Inbox } from './Icon';
import { StatusChip } from './StatusChip';

export type PanelAccent =
  'violet' | 'red' | 'blue' | 'magenta' | 'orange' | 'lime' | 'cyan' | 'yellow';

/**
 * Painel do workspace em cartão (superfície, raio e contorno; sem faixa colorida): cabeçalho (ponto, título, meta e tag
 * opcionais; meta vazia não aparece) e corpo com rolagem própria. A região tem o nome do título; o `id` vem de `useId`, único
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
        {meta ? <span className="panel__meta">{meta}</span> : null}
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

/** Estado vazio de um painel: ícone decorativo e a frase como título (o bloco fica em `--muted`, o título em `--text`). */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return <EmptyState icon={Inbox} title={children} className="panel__empty" />;
}
