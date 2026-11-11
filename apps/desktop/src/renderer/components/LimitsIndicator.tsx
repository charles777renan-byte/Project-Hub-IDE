import { useEffect, useId, useRef, useState } from 'react';
import type { LimitWindowDto } from '@project-hub/contracts';
import {
  type LimitLevel,
  isWindowExhausted,
  isWindowExpired,
  limitLevel,
  shortWindowLabel,
  usedPercent,
} from '../limits-format';
import { useLimits } from '../use-limits';
import { ClaudeLimits } from './home/ClaudeLimits';
import { ProviderIcon } from './ProviderIcon';

const LEVEL_ORDER: Record<LimitLevel, number> = { normal: 0, aviso: 1, critico: 2 };

type Part = { label: string; value: string; level: LimitLevel };

/**
 * O resumo de uma janela para a barra: "16%", "esgotada" ou um traço quando a janela já renovou e o número guardado
 * não vale mais. A janela renovada não pesa no nível: o que se sabe dela é só que zerou.
 */
function partOf(window: LimitWindowDto, now: Date): Part | null {
  const label = shortWindowLabel(window.id);
  if (label === undefined) return null;
  if (isWindowExpired(window, now)) return { label, value: '—', level: 'normal' };
  if (isWindowExhausted(window)) return { label, value: 'esgotada', level: 'critico' };
  return { label, value: `${usedPercent(window)}%`, level: limitLevel(window) };
}

/**
 * Limites da assinatura na barra de status: o resumo das janelas do Claude fica sempre à vista ("5h 16% · sem 14%") e
 * o clique abre um painel com o mesmo cartão do Início (barras, renovação, Atualizar). Sem leitura, um traço, nunca um
 * zero. O número vem sempre em texto; a cor do nível só reforça. O painel fecha com Esc (o foco volta ao botão), com
 * um clique fora ou com outro clique no botão.
 */
export function LimitsIndicator() {
  const { limits } = useLimits();
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
  const summary =
    parts.length === 0
      ? 'sem leitura'
      : parts.map((part) => `${part.label} ${part.value}`).join(', ');

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
            <span key={part.label} className="limits-indicator__part" data-nivel={part.level}>
              {part.label} {part.value}
            </span>
          ))
        )}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Limites da assinatura"
          className="limits-indicator__panel"
        >
          <ClaudeLimits />
          <p className="limits-indicator__note">Codex e Antigravity: em breve.</p>
        </div>
      ) : null}
    </div>
  );
}
