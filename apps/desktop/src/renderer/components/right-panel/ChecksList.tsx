import { useId, useState } from 'react';
import type { CheckDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  ICON_PROPS,
  LoaderCircle,
  type LucideIcon,
} from '../Icon';
import { formatDate } from './ChecksPrHeader';
import { checkView, summarizeChecks, type CheckTone } from './checks-status';

const TEXT = RIGHT_PANEL_TEXT.checks;

const TONE_ICON: Record<CheckTone, LucideIcon> = {
  success: CircleCheck,
  failure: CircleAlert,
  pending: LoaderCircle,
  neutral: CircleSlash,
};

/** O endereço da página do check, quando o GitHub deu um. */
function detailsUrl(check: CheckDto): string | null {
  return check.kind === 'check-run' ? check.detailsUrl : check.targetUrl;
}

/** Uma chave estável por check (tipo, workflow e nome); repetidos ganham um sufixo pela ordem. */
function keysOf(checks: readonly CheckDto[]): string[] {
  const seen = new Map<string, number>();
  return checks.map((check) => {
    const workflow = check.kind === 'check-run' ? (check.workflowName ?? '') : '';
    const base = `${check.kind}|${workflow}|${check.name}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  });
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </>
  );
}

function CheckDetails({
  check,
  onOpenLink,
}: {
  check: CheckDto;
  onOpenLink: (url: string) => void;
}) {
  const url = detailsUrl(check);
  return (
    <div className="checks-list__details">
      <dl className="checks-list__facts">
        <Detail term={TEXT.kind} value={TEXT.kindLabel[check.kind]} />
        {check.kind === 'check-run' && check.workflowName !== null ? (
          <Detail term={TEXT.workflow} value={check.workflowName} />
        ) : null}
        <Detail
          term={TEXT.started}
          value={check.startedAt === null ? TEXT.noDate : formatDate(check.startedAt)}
        />
        {check.kind === 'check-run' ? (
          <>
            <Detail
              term={TEXT.finished}
              value={check.completedAt === null ? TEXT.noDate : formatDate(check.completedAt)}
            />
            <Detail term={TEXT.status} value={check.status} />
            <Detail term={TEXT.conclusion} value={check.conclusion ?? TEXT.noDate} />
          </>
        ) : (
          <Detail term={TEXT.state} value={check.state} />
        )}
      </dl>
      {url === null ? null : (
        <button type="button" className="btn-secondary" onClick={() => onOpenLink(url)}>
          {TEXT.details}
        </button>
      )}
    </div>
  );
}

/**
 * O resumo ("N com sucesso / N falharam / N pendentes") e a lista dos checks do PR. Cada linha tem ícone, nome e o
 * texto do estado, e é um botão que expande início, fim, identificadores e "Ver detalhes completos". Nomes e
 * identificadores vêm do GitHub e entram como texto puro.
 */
export function ChecksList({
  checks,
  onOpenLink,
}: {
  checks: readonly CheckDto[];
  onOpenLink: (url: string) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const base = useId();

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  if (checks.length === 0) return <p className="checks-tab__status">{TEXT.noChecks}</p>;
  const total = summarizeChecks(checks);
  const keys = keysOf(checks);
  return (
    <section className="checks-list" aria-label={TEXT.listLabel}>
      <p className="checks-list__summary" aria-label={TEXT.summary.group}>
        <span>{TEXT.summary.success(total.success)}</span>
        <span aria-hidden="true">/</span>
        <span>{TEXT.summary.failed(total.failure)}</span>
        <span aria-hidden="true">/</span>
        <span>{TEXT.summary.pending(total.pending)}</span>
      </p>
      <ul className="checks-list__items">
        {checks.map((check, index) => {
          const key = keys[index] ?? String(index);
          const view = checkView(check);
          const Icon = TONE_ICON[view.tone];
          const expanded = open.has(key);
          const panelId = `${base}-${index}`;
          return (
            <li key={key} className="checks-list__item">
              <button
                type="button"
                className="checks-list__row"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(key)}
              >
                {expanded ? (
                  <ChevronDown {...ICON_PROPS} className="checks-list__chevron" />
                ) : (
                  <ChevronRight {...ICON_PROPS} className="checks-list__chevron" />
                )}
                <Icon
                  {...ICON_PROPS}
                  className={`checks-list__icon checks-list__icon--${view.tone}`}
                />
                <span className="checks-list__name" title={check.name}>
                  {check.name}
                </span>
                <span className="checks-list__state">{view.label}</span>
              </button>
              <div id={panelId} hidden={!expanded}>
                {expanded ? <CheckDetails check={check} onOpenLink={onOpenLink} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
