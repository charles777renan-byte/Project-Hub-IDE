import { useEffect, useId, useRef, useState } from 'react';
import type { LimitProviderId, LimitWindowDto, ProviderLimitsDto } from '@project-hub/contracts';
import {
  type LimitLevel,
  LIMIT_PROVIDERS,
  formatDaysLeft,
  isWindowExhausted,
  isWindowExpired,
  limitLevel,
  presentProviders,
  shortWindowLabel,
  usedPercent,
} from '../limits-format';
import { useLimits } from '../use-limits';
import { LimitsPanel } from './LimitsPanel';
import { ProviderIcon } from './ProviderIcon';

const LEVEL_ORDER: Record<LimitLevel, number> = { normal: 0, aviso: 1, critico: 2 };

/**
 * Uma janela no rodapé. `label` é o que se vê; `spoken` é a mesma coisa por extenso, para o nome acessível do botão.
 * `fill` é a largura da barrinha (0 a 100) e falta na janela já renovada, que não tem número que valha.
 */
type Part = { label: string; value: string; spoken: string; level: LimitLevel; fill?: number };

/**
 * A semanal e a mensal aparecem pelo tempo que falta para renovar ("3d"), e não por um nome: é o que muda de um dia
 * para o outro. O valor é o nome por extenso, para o botão.
 */
const BY_DAYS: Record<string, string> = { seven_day: 'semanal', thirty_day: 'mensal' };

/**
 * O resumo de uma janela para a barra: "16%", "esgotada" ou um traço quando a janela já renovou e o número guardado
 * não vale mais. A janela renovada não pesa no nível: o que se sabe dela é só que zerou.
 */
function partOf(window: LimitWindowDto, provider: LimitProviderId, now: Date): Part | null {
  const short = shortWindowLabel(window.id, provider);
  if (short === undefined) return null;
  const byDays = BY_DAYS[window.id] !== undefined;
  const name = BY_DAYS[window.id] ?? short;
  if (isWindowExpired(window, now)) {
    return { label: short, value: '—', spoken: `${name} —`, level: 'normal' };
  }
  const daysLeft = byDays ? formatDaysLeft(window.resetsAt, now) : '';
  const label = daysLeft === '' ? short : daysLeft;
  const renewal = daysLeft === '' ? '' : `, renova em ${daysLeft}`;
  if (isWindowExhausted(window)) {
    return {
      label,
      value: 'esgotada',
      spoken: `${name} esgotada${renewal}`,
      level: 'critico',
      fill: 100,
    };
  }
  const used = usedPercent(window);
  return {
    label,
    value: `${used}%`,
    spoken: `${name} ${used}%${renewal}`,
    level: limitLevel(window),
    fill: used,
  };
}

/** O resumo de um programa para a barra: as partes das janelas que ela resume, o pior nível e o texto por extenso. */
function summaryOf(entry: ProviderLimitsDto | undefined, provider: LimitProviderId, now: Date) {
  const parts = (entry?.windows ?? [])
    .map((window) => partOf(window, provider, now))
    .filter((part): part is Part => part !== null);
  const level = parts.reduce<LimitLevel>(
    (worst, part) => (LEVEL_ORDER[part.level] > LEVEL_ORDER[worst] ? part.level : worst),
    'normal',
  );
  const spoken = parts.length === 0 ? 'sem leitura' : parts.map((part) => part.spoken).join(', ');
  return { parts, level, spoken };
}

/**
 * Limites da assinatura na barra de status: um botão por programa com dados (o do Claude fica sempre à vista; o do
 * Codex só aparece com ao menos uma janela), cada um com o resumo das janelas (rótulo, barrinha e número; a semanal
 * e a mensal levam como rótulo os dias que faltam para renovar). O clique em qualquer um abre o mesmo painel
 * (LimitsPanel). Sem leitura, um traço, nunca um zero. O número vem sempre em texto; a cor do nível só reforça. O
 * painel fecha com Esc (o foco volta ao botão que o abriu), com um clique fora ou com outro clique no botão.
 */
export function LimitsIndicator() {
  const { limits, refresh } = useLimits();
  // Qual botão abriu o painel: só ele anuncia "expandido" e controla o painel.
  const [openByState, setOpenBy] = useState<LimitProviderId | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const listening = openByState !== null;
  useEffect(() => {
    if (!listening) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setOpenBy(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [listening]);

  const now = new Date();
  const providers = limits?.providers ?? [];
  // Um botão por programa do estado com parte resumível; o do Claude fica sempre (mesmo sem leitura, com um traço).
  const buttons = presentProviders(providers)
    .map((provider) => ({ provider, entry: providers.find((item) => item.provider === provider) }))
    .filter(
      ({ provider, entry }) =>
        provider === 'claude' || summaryOf(entry, provider, now).parts.length > 0,
    );
  // O dono do painel que perdeu o botão (ex.: o Codex ficou sem janelas) deixa o painel fechado.
  const openBy = buttons.some(({ provider }) => provider === openByState) ? openByState : null;
  const open = openBy !== null;
  useEffect(() => {
    if (openByState !== null && openBy === null) setOpenBy(null);
  }, [openByState, openBy]);

  return (
    <div
      ref={root}
      className="limits-indicator"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpenBy(null);
        opener.current?.focus();
      }}
    >
      {buttons.map(({ provider, entry }) => {
        const { parts, level, spoken } = summaryOf(entry, provider, now);
        return (
          <button
            key={provider}
            type="button"
            className="limits-indicator__button"
            aria-label={`Limites do ${LIMIT_PROVIDERS[provider].label}: ${spoken}`}
            aria-haspopup="dialog"
            aria-expanded={openBy === provider}
            aria-controls={openBy === provider ? panelId : undefined}
            data-nivel={level}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setOpenBy((current) => (current === provider ? null : provider));
            }}
          >
            <ProviderIcon provider={provider} size={12} />
            {parts.length === 0 ? (
              <span>—</span>
            ) : (
              parts.map((part) => (
                <span key={part.spoken} className="limits-indicator__part" data-nivel={part.level}>
                  <span className="limits-indicator__label">{part.label}</span>
                  {part.fill === undefined ? null : (
                    <span className="limits-indicator__mini">
                      <span
                        className="limits-indicator__mini-fill"
                        style={{ width: `${part.fill}%` }}
                      />
                    </span>
                  )}
                  <span className="limits-indicator__value">{part.value}</span>
                </span>
              ))
            )}
          </button>
        );
      })}
      {open ? <LimitsPanel id={panelId} providers={providers} onRefresh={refresh} /> : null}
    </div>
  );
}
