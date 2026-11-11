import { useId } from 'react';
import type { LimitProviderId, LimitWindowDto, LimitsDto } from '@project-hub/contracts';
import {
  LIMIT_CRITICAL_ABOVE,
  LIMIT_PROVIDERS,
  LIMIT_WARN_FROM,
  expiredText,
  formatClock,
  formatSeenAt,
  formatRenewal,
  formatReturn,
  isWindowExhausted,
  isWindowExpired,
  limitLevel,
  problemText,
  usageText,
  usedPercent,
  windowLabel,
} from '../../limits-format';
import { useLimits } from '../../use-limits';
import { ProviderIcon } from '../ProviderIcon';

function LimitRow({
  window,
  now,
  provider,
}: {
  window: LimitWindowDto;
  now: Date;
  provider: LimitProviderId;
}) {
  const label = windowLabel(window.id, provider, window.durationMinutes);
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
        <p className="claude-limits__note">{expiredText(provider)}</p>
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

type LimitsCardProps = {
  provider: LimitProviderId;
  limits: LimitsDto | null;
  refresh: () => void;
};

/**
 * Cartão "Uso do <programa>": quanto de cada janela da assinatura já foi usado, a partir do estado dos limites
 * que a tela já tem. O número sempre vem em texto ao lado da barra; a cor sozinha não diz nada.
 */
export function LimitsCard({ provider, limits, refresh }: LimitsCardProps) {
  const titleId = useId();
  const entry = limits?.providers.find((item) => item.provider === provider);
  const windows = entry?.windows ?? [];
  const refreshing = entry?.refreshing ?? false;
  // O Atualizar não tem parâmetro: lê todos os programas, então espera qualquer leitura em andamento.
  const anyRefreshing = limits?.providers.some((item) => item.refreshing) ?? false;
  const now = new Date();
  const name = LIMIT_PROVIDERS[provider].label;

  let status: string | null = null;
  if (entry?.problem) status = problemText(provider, entry.problem);
  else if (windows.length === 0) status = refreshing ? 'Lendo os limites…' : 'Ainda sem leitura.';
  const capturedClock = entry?.capturedAt ? formatClock(entry.capturedAt) : '';

  return (
    <div className="claude-limits" role="group" aria-labelledby={titleId}>
      <div className="claude-limits__title-row">
        <h3 id={titleId} className="claude-limits__title">
          <ProviderIcon provider={provider} size={16} />
          Uso do {name}
        </h3>
        <button
          type="button"
          className="claude-limits__refresh"
          onClick={refresh}
          disabled={anyRefreshing}
          title="Atualiza os limites de todos os programas"
        >
          Atualizar
        </button>
      </div>
      {windows.length > 0 && (
        <ul className="claude-limits__list">
          {windows.map((window) => (
            <LimitRow key={window.id} window={window} now={now} provider={provider} />
          ))}
        </ul>
      )}
      {status && (
        <p className="claude-limits__status" role="status">
          {status}
        </p>
      )}
      {capturedClock && (
        <p className="claude-limits__note">
          {provider === 'codex'
            ? `Visto ${formatSeenAt(entry?.capturedAt ?? '', now)}, na última resposta do Codex.`
            : `Lido às ${capturedClock}`}
        </p>
      )}
    </div>
  );
}

/** Cartão de limites de um programa (o Claude, por padrão) que busca o próprio estado. */
export function ClaudeLimits({ provider = 'claude' }: { provider?: LimitProviderId }) {
  const { limits, refresh } = useLimits();
  return <LimitsCard provider={provider} limits={limits} refresh={refresh} />;
}
