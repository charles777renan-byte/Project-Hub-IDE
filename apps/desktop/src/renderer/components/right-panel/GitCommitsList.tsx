import { useEffect, useState } from 'react';
import type { GitLogEntryDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { ChevronDown, ChevronRight, ICON_PROPS } from '../Icon';

const TEXT = RIGHT_PANEL_TEXT.git;

const RELATIVE = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "há 3 horas", "ontem"… a partir de uma data ISO. Data inválida vira texto vazio. */
function relativeDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((time - Date.now()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return RELATIVE.format(0, 'second');
}

type Load =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: GitLogEntryDto[] };

/**
 * A seção "Commits", recolhível: últimos 50 commits, sem grafo. Só lê `git.log` com a seção aberta; relê ao abrir
 * e quando `reloadKey` muda (o estado do Git foi relido, por exemplo depois de um commit).
 */
export function GitCommitsList({
  projectId,
  reloadKey,
}: {
  projectId: string;
  reloadKey: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    void window.projectHub.git
      .log({ projectId })
      .then((result) => {
        if (!current) return;
        setLoad(result.ok ? { status: 'ready', entries: result.data } : { status: 'error' });
      })
      .catch(() => {
        if (current) setLoad({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [open, projectId, reloadKey]);

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="git-commits">
      <button
        type="button"
        className="git-commits__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Chevron {...ICON_PROPS} />
        {TEXT.commitsTitle}
      </button>
      {open ? (
        load.status === 'loading' ? (
          <p className="git-commits__note" role="status">
            {TEXT.commitsLoading}
          </p>
        ) : load.status === 'error' ? (
          <p className="git-commits__note" role="alert">
            {TEXT.commitsError}
          </p>
        ) : load.entries.length === 0 ? (
          <p className="git-commits__note">{TEXT.commitsEmpty}</p>
        ) : (
          <ul className="git-commits__list">
            {load.entries.slice(0, 50).map((entry) => (
              <li key={entry.sha} className="git-commits__item">
                <span className="git-commits__subject" title={entry.subject}>
                  {entry.subject}
                </span>
                <span className="git-commits__meta">
                  {entry.author} · {relativeDate(entry.date)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
