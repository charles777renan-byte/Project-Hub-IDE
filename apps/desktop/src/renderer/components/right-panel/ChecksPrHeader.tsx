import type { PrSummaryDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import { openExternal } from '../../open-external';
import { Hint } from '../Hint';
import { ICON_PROPS, RefreshCw } from '../Icon';
import { StatusChip } from '../StatusChip';

const TEXT = RIGHT_PANEL_TEXT.checks;

const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Uma data ISO no formato curto da pessoa; um texto que não é data aparece como veio. */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_FORMAT.format(time);
}

function prState(pr: PrSummaryDto): { label: string; tone: 'lime' | 'violet' | 'red' | 'muted' } {
  if (pr.state === 'MERGED') return { label: TEXT.prState.merged, tone: 'violet' };
  if (pr.state === 'CLOSED') return { label: TEXT.prState.closed, tone: 'red' };
  return pr.isDraft
    ? { label: TEXT.prState.draft, tone: 'muted' }
    : { label: TEXT.prState.open, tone: 'lime' };
}

/**
 * O cabeçalho da aba Checks: o selo do estado do PR (com texto, nunca só cor), o número (que abre o PR no
 * navegador), as branches e o botão Atualizar; embaixo, o título e "PR atualizado em …". Título e branches vêm do
 * GitHub e entram como texto puro.
 */
export function ChecksPrHeader({
  pr,
  refreshing,
  onRefresh,
}: {
  pr: PrSummaryDto;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const state = prState(pr);
  const branches = TEXT.branches(pr.headRefName, pr.baseRefName);
  return (
    <div className="checks-tab__header">
      <div className="checks-tab__line">
        <StatusChip label={state.label} tone={state.tone} />
        <button
          type="button"
          className="checks-tab__number"
          aria-label={TEXT.openPr(pr.number)}
          onClick={() => openExternal(pr.url)}
        >
          {`#${pr.number}`}
        </button>
        <p className="checks-tab__branches" title={branches}>
          {branches}
        </p>
        <Hint label={TEXT.refresh}>
          <button
            type="button"
            className="git-tab__refresh"
            aria-label={TEXT.refresh}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw {...ICON_PROPS} />
          </button>
        </Hint>
      </div>
      <p className="checks-tab__title">{pr.title}</p>
      <p className="checks-tab__updated">{TEXT.updatedAt(formatDate(pr.updatedAt))}</p>
    </div>
  );
}
