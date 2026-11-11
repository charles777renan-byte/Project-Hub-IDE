import { useId } from 'react';
import type { LimitWindowDto } from '@project-hub/contracts';
import {
  LIMIT_CRITICAL_ABOVE,
  LIMIT_EXPIRED_TEXT,
  LIMIT_PROBLEM_TEXT,
  LIMIT_WARN_FROM,
  formatClock,
  formatRenewal,
  formatReturn,
  isWindowExhausted,
  isWindowExpired,
  limitLevel,
  usageText,
  usedPercent,
  windowLabel,
} from '../../limits-format';
import { useLimits } from '../../use-limits';
import { ProviderIcon } from '../ProviderIcon';

function LimitRow({ window, now }: { window: LimitWindowDto; now: Date }) {
  const label = windowLabel(window.id);
  const expired = isWindowExpired(window, now);
  return (
    <li className="claude-limits__row">
      <div className="claude-limits__head">
        <span className="claude-limits__label">{label}</span>
        {!expired && (
          <span className="claude-limits__reset">
            {isWindowExhausted(window)
              ? formatReturn(window.resetsAt, now)
              : formatRenewal(window.resetsAt, now)}
          </span>
        )}
      </div>
      {expired ? (
        <p className="claude-limits__note">{LIMIT_EXPIRED_TEXT}</p>
      ) : (
        <>
          {/*
           * Regiões do <meter>: abaixo de `low` é a região ótima (neutra), de `low` a `high` é a de aviso
           * (âmbar) e acima de `high` é a crítica (vermelha). `optimum` = 0 porque usar menos é o desejado.
           * O mesmo limiar vale para `data-nivel`, que o texto e os testes leem.
           */}
          <meter
            className="claude-limits__bar"
            min={0}
            max={100}
            low={LIMIT_WARN_FROM}
            high={LIMIT_CRITICAL_ABOVE}
            optimum={0}
            value={usedPercent(window)}
            data-nivel={limitLevel(window)}
            aria-label={`${label}, ${usedPercent(window)}% usado`}
          />
          <p className="claude-limits__note">{usageText(window)}</p>
        </>
      )}
    </li>
  );
}

/**
 * Cartão "Uso do Claude": quanto de cada janela da assinatura já foi usado, lido pelo processo principal.
 * O número sempre vem em texto ao lado da barra; a cor sozinha não diz nada.
 */
export function ClaudeLimits() {
  const { limits, refresh } = useLimits();
  const titleId = useId();
  const claude = limits?.providers.find((entry) => entry.provider === 'claude');
  const windows = claude?.windows ?? [];
  const refreshing = claude?.refreshing ?? false;
  const now = new Date();

  let status: string | null = null;
  if (claude?.problem) status = LIMIT_PROBLEM_TEXT[claude.problem];
  else if (windows.length === 0) status = refreshing ? 'Lendo os limites…' : 'Ainda sem leitura.';
  const capturedClock = claude?.capturedAt ? formatClock(claude.capturedAt) : '';

  return (
    <div className="claude-limits" role="group" aria-labelledby={titleId}>
      <div className="claude-limits__title-row">
        <h3 id={titleId} className="claude-limits__title">
          <ProviderIcon provider="claude" size={16} />
          Uso do Claude
        </h3>
        <button
          type="button"
          className="claude-limits__refresh"
          onClick={refresh}
          disabled={refreshing}
        >
          Atualizar
        </button>
      </div>
      {windows.length > 0 && (
        <ul className="claude-limits__list">
          {windows.map((window) => (
            <LimitRow key={window.id} window={window} now={now} />
          ))}
        </ul>
      )}
      {status && (
        <p className="claude-limits__status" role="status">
          {status}
        </p>
      )}
      {capturedClock && <p className="claude-limits__note">Lido às {capturedClock}</p>}
    </div>
  );
}
