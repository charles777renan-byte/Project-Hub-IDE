import { useEffect, useRef } from 'react';
import {
  contourLevels,
  contourSegments,
  createFieldGrid,
  createSimplexNoise3D,
  sampleField,
  type FieldGrid,
  type Segment,
  type Tier,
} from '../topographic';

export interface TopographicBackgroundProps {
  /** Tamanho da célula em px. Células maiores custam menos por quadro. */
  cellSize?: number;
  levelsCount?: number;
  majorInterval?: number;
  baseScale?: number;
  /** Velocidade do movimento, em unidades de campo por ms. */
  speed?: number;
  seed?: number;
  /** Teto de quadros por segundo. O campo muda devagar, então 30 basta. */
  maxFps?: number;
}

const TIERS: readonly Tier[] = [0, 1, 2];
const TIER_WIDTH: Record<Tier, number> = { 0: 1.05, 1: 1.35, 2: 2.35 };
/** As linhas maiores ficam atenuadas, para não competir com o texto. */
const TIER_ALPHA: Record<Tier, number> = { 0: 1, 1: 1, 2: 0.35 };
const TIER_TOKEN: Record<Tier, string> = { 0: '--line', 1: '--field-line', 2: '--muted' };

/**
 * Cores lidas dos tokens de tokens.css, para o canvas seguir a paleta do app e não uma cópia dela.
 */
function readTopoColors(): { background: string; tiers: Record<Tier, string> } {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    background: token('--bg'),
    tiers: { 0: token(TIER_TOKEN[0]), 1: token(TIER_TOKEN[1]), 2: token(TIER_TOKEN[2]) },
  };
}

/**
 * Fundo animado de linhas topográficas, atrás do conteúdo. Não recebe foco nem cliques
 * (`pointer-events: none`), e fica oculto para leitores de tela. Respeita "reduzir movimento":
 * nesse caso desenha um quadro só. Para de animar quando a janela está oculta ou minimizada.
 */
export function TopographicBackground({
  cellSize = 12,
  levelsCount = 16,
  majorInterval = 4,
  baseScale = 0.0022,
  speed = 0.00007,
  seed = 42,
  maxFps = 30,
}: TopographicBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const current = canvasRef.current;
    if (current === null) return;
    // Constantes com tipo fixo: as funções internas abaixo não herdam o estreitamento dos `if`.
    const surface: HTMLCanvasElement = current;
    const found = surface.getContext('2d', { alpha: false });
    // Sem canvas (ambientes de teste sem ele), não há o que desenhar.
    if (!found) return;
    const ctx: CanvasRenderingContext2D = found;

    const parent: HTMLElement = surface.parentElement ?? surface;
    const noise = createSimplexNoise3D(seed);
    const levels = contourLevels(levelsCount, majorInterval);
    const colors = readTopoColors();
    const frameInterval = 1000 / maxFps;
    const segments: Segment[] = [];

    // Em ambientes sem matchMedia (jsdom), o movimento segue ativo.
    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = motionQuery?.matches ?? false;

    let width = 1;
    let height = 1;
    let grid: FieldGrid = createFieldGrid(width, height, cellSize);
    let timeOffset = 0;
    let lastPainted = -Infinity;
    let frameId: number | null = null;

    function resize(): void {
      const rect = parent.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width || window.innerWidth));
      height = Math.max(1, Math.floor(rect.height || window.innerHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.floor(width * dpr);
      surface.height = Math.floor(height * dpr);
      // Trocar o tamanho do canvas zera o contexto, então a escala é refeita aqui.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      grid = createFieldGrid(width, height, cellSize);
    }

    function paint(): void {
      sampleField(noise, grid, timeOffset, baseScale);

      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, width, height);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Uma trajetória por faixa: cada cor vira um único stroke.
      for (const tier of TIERS) {
        segments.length = 0;
        for (const level of levels) {
          if (level.tier === tier) contourSegments(grid, level.value, segments);
        }
        if (segments.length === 0) continue;

        ctx.globalAlpha = TIER_ALPHA[tier];
        ctx.strokeStyle = colors.tiers[tier];
        ctx.lineWidth = TIER_WIDTH[tier];
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of segments) {
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function schedule(): void {
      if (frameId === null && !reducedMotion && !document.hidden) {
        frameId = window.requestAnimationFrame(tick);
      }
    }

    function stop(): void {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
    }

    function tick(now: number): void {
      frameId = null;
      if (now - lastPainted >= frameInterval) {
        const elapsed = lastPainted === -Infinity ? 0 : Math.min(100, now - lastPainted);
        timeOffset += elapsed * speed;
        lastPainted = now;
        paint();
      }
      schedule();
    }

    function handleResize(): void {
      resize();
      paint();
    }

    function handleMotionChange(event: MediaQueryListEvent): void {
      reducedMotion = event.matches;
      if (reducedMotion) {
        stop();
        paint();
      } else {
        schedule();
      }
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        stop();
      } else {
        schedule();
      }
    }

    resize();
    paint();
    lastPainted = performance.now();
    schedule();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleResize);
    if (resizeObserver) {
      resizeObserver.observe(parent);
    } else {
      window.addEventListener('resize', handleResize, { passive: true });
    }
    motionQuery?.addEventListener('change', handleMotionChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stop();
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', handleResize);
      }
      motionQuery?.removeEventListener('change', handleMotionChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cellSize, levelsCount, majorInterval, baseScale, speed, seed, maxFps]);

  return (
    <div className="topo-background" aria-hidden="true">
      <canvas ref={canvasRef} className="topo-background__canvas" />
    </div>
  );
}
