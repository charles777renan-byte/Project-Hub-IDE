import { useEffect, useId, useRef, useState } from 'react';
import type { LimitWindowDto } from '@project-hub/contracts';
import {
  type LimitLevel,
  formatDaysLeft,
  isWindowExhausted,
  isWindowExpired,
  limitLevel,
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

/** A semanal aparece pelo tempo que falta para renovar ("3d"), e não por um nome: é o que muda de um dia para o outro. */
const WEEKLY = 'seven_day';

/**
 * O resumo de uma janela para a barra: "16%", "esgotada" ou um traço quando a janela já renovou e o número guardado
 * não vale mais. A janela renovada não pesa no nível: o que se sabe dela é só que zerou.
 */
function partOf(window: LimitWindowDto, now: Date): Part | null {
  const short = shortWindowLabel(window.id);
  if (short === undefined) return null;
  const weekly = window.id === WEEKLY;
  const name = weekly ? 'semanal' : short;
  if (isWindowExpired(window, now)) {
    return { label: short, value: '—', spoken: `${name} —`, level: 'normal' };
  }
  const daysLeft = weekly ? formatDaysLeft(window.resetsAt, now) : '';
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

/**
 * Limites da assinatura na barra de status: o resumo das janelas do Claude fica sempre à vista (rótulo, barrinha e
 * número de cada uma; a semanal leva como rótulo os dias que faltam para renovar) e o clique abre o painel (LimitsPanel). Sem leitura, um traço, nunca um zero. O número vem
 * sempre em texto; a cor do nível só reforça. O painel fecha com Esc (o foco volta ao botão), com um clique fora ou
 * com outro clique no botão.
 */
export function LimitsIndicator() {
  const { limits, refresh } = useLimits();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const now = new Date();
  const claude = limits?.providers.find((entry) => entry.provider === 'claude');
  const parts = (claude?.windows ?? [])
    .map((window) => partOf(window, now))
    .filter((part): part is Part => part !== null);
  const level = parts.reduce<LimitLevel>(
    (worst, part) => (LEVEL_ORDER[part.level] > LEVEL_ORDER[worst] ? part.level : worst),
    'normal',
  );
  const summary = parts.length === 0 ? 'sem leitura' : parts.map((part) => part.spoken).join(', ');

  return (
    <div
      ref={root}
      className="limits-indicator"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        className="limits-indicator__button"
        aria-label={`Limites do Claude: ${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-nivel={level}
        onClick={() => setOpen((current) => !current)}
      >
        <ProviderIcon provider="claude" size={12} />
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
      {open ? <LimitsPanel id={panelId} claude={claude} onRefresh={refresh} /> : null}
    </div>
  );
}
