import type { LimitWindowDto, ProviderLimitsDto } from '@project-hub/contracts';
import {
  LIMIT_EXPIRED_TEXT,
  LIMIT_PROBLEM_TEXT,
  formatAge,
  formatCountdown,
  formatRenewal,
  isWindowExhausted,
  isWindowExpired,
  limitLevel,
  usedPercent,
  windowElapsedPercent,
  windowLabel,
} from '../limits-format';
import { ICON_PROPS, RefreshCw } from './Icon';
import { ProviderIcon } from './ProviderIcon';

/** Programas que ainda não têm fonte de dados para o limite: aparecem no painel, sem número. */
const PENDING_PROVIDERS = [
  { id: 'codex', label: 'Codex' },
  { id: 'antigravity', label: 'Antigravity' },
] as const;

/** "às 18:00" ou "sex, 05:59": a hora da renovação sem o verbo, para vir depois da contagem. */
function renewalMoment(resetsAt: string, now: Date): string {
  return formatRenewal(resetsAt, now).replace(/^Renova /, '');
}

/** "renova em 4h · às 18:00"; na janela esgotada, "volta em 4h · às 18:00". */
function renewalText(window: LimitWindowDto, now: Date, exhausted: boolean): string {
  const countdown = formatCountdown(window.resetsAt, now);
  const moment = renewalMoment(window.resetsAt, now);
  return `${exhausted ? 'volta' : 'renova'} em ${countdown} · ${moment}`;
}

function WindowRow({ window, now }: { window: LimitWindowDto; now: Date }) {
  const label = windowLabel(window.id);
  if (isWindowExpired(window, now)) {
    return (
      <li className="limits-panel__row" aria-label={label}>
        <div className="limits-panel__head">
          <span className="limits-panel__label">{label}</span>
        </div>
        <p className="limits-panel__foot">{LIMIT_EXPIRED_TEXT}</p>
      </li>
    );
  }

  const used = usedPercent(window);
  const exhausted = isWindowExhausted(window);
  const level = exhausted ? 'critico' : limitLevel(window);
  const elapsed = windowElapsedPercent(window, now);
  return (
    <li className="limits-panel__row" aria-label={label}>
      <div className="limits-panel__head">
        <span className="limits-panel__label">{label}</span>
        <span className="limits-panel__value" data-nivel={level}>
          {exhausted ? 'Esgotada' : `${used}%`}
        </span>
      </div>
      {/*
       * A barra mostra o uso; o risco fino marca quanto do tempo da janela já passou. Uso à direita do risco quer
       * dizer que o consumo anda mais rápido que o relógio. O mesmo vem em texto logo abaixo.
       */}
      <div
        className="limits-panel__bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
        aria-label={`${label}, ${used}% usado`}
        data-nivel={level}
      >
        <span className="limits-panel__fill" style={{ width: `${used}%` }} />
        {elapsed === undefined ? null : (
          <span className="limits-panel__tick" aria-hidden="true" style={{ left: `${elapsed}%` }} />
        )}
      </div>
      <p className="limits-panel__foot">{renewalText(window, now, exhausted)}</p>
      {elapsed === undefined || exhausted ? null : (
        <p className="limits-panel__foot">
          {elapsed}% do tempo passou · {used > elapsed ? 'acima do ritmo' : 'dentro do ritmo'}
        </p>
      )}
    </li>
  );
}

type LimitsPanelProps = {
  id: string;
  claude: ProviderLimitsDto | undefined;
  onRefresh: () => void;
};

/**
 * Painel de limites que o indicador da barra de status abre. Uma linha por janela do Claude: o número grande, a barra
 * com a marca do tempo, a contagem até a renovação e o ritmo. Embaixo, os programas que ainda não têm fonte de dados.
 * Todo número vem em texto; a cor só reforça o nível.
 */
export function LimitsPanel({ id, claude, onRefresh }: LimitsPanelProps) {
  const now = new Date();
  const windows = claude?.windows ?? [];
  const refreshing = claude?.refreshing ?? false;
  const age = claude?.capturedAt ? formatAge(claude.capturedAt, now) : '';

  let status: string | null = null;
  if (claude?.problem) status = LIMIT_PROBLEM_TEXT[claude.problem];
  else if (windows.length === 0) status = refreshing ? 'Lendo os limites…' : 'Ainda sem leitura.';

  return (
    <div id={id} role="dialog" aria-label="Limites da assinatura" className="limits-panel">
      <div className="limits-panel__title-row">
        <h2 className="limits-panel__title">Limites da assinatura</h2>
        {age === '' ? null : <span className="limits-panel__age">{age}</span>}
        <button
          type="button"
          className="limits-panel__refresh"
          aria-label="Atualizar limites"
          title="Atualizar limites"
          onClick={onRefresh}
          disabled={refreshing}
          data-lendo={refreshing ? 'true' : undefined}
        >
          <RefreshCw {...ICON_PROPS} />
        </button>
      </div>

      <section className="limits-panel__provider" aria-label="Claude">
        <h3 className="limits-panel__provider-name">
          <ProviderIcon provider="claude" size={16} />
          Claude
        </h3>
        {windows.length > 0 && (
          <ul className="limits-panel__list">
            {windows.map((window) => (
              <WindowRow key={window.id} window={window} now={now} />
            ))}
          </ul>
        )}
        {status && (
          <p className="limits-panel__status" role="status">
            {status}
          </p>
        )}
      </section>

      <ul className="limits-panel__others" aria-label="Outros programas">
        {PENDING_PROVIDERS.map((provider) => (
          <li key={provider.id} className="limits-panel__other">
            <ProviderIcon provider={provider.id} size={16} />
            <span className="limits-panel__other-name">{provider.label}</span>
            <span className="limits-panel__soon">Em breve</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
