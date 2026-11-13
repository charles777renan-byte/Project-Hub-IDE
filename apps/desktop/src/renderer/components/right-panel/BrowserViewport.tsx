import type { BrowserBounds, BrowserTabDto } from '@project-hub/contracts';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../EmptyState';
import { Globe } from '../Icon';

/**
 * Quanto tempo a página espera pela imagem parada antes de sair de cima de uma sobreposição. A captura costuma
 * levar uns 15 ms, mas a primeira de uma página pode passar de 300 ms; um menu não pode ficar coberto esse tempo.
 */
const STILL_DEADLINE_MS = 60;

function sameBounds(a: BrowserBounds | null, b: BrowserBounds | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * A área reservada à página. A página de verdade não mora no DOM: é uma view do processo principal, posta por cima
 * da janela exatamente sobre este elemento. Este componente mede a si mesmo e informa o retângulo
 * (`browser.setBounds`); quando não há página para mostrar (aba vazia, erro, `hidden`, área sem tamanho ou
 * componente desmontado), informa `null`, e a view some. Enquanto há página à vista, a área é medida a cada quadro:
 * ela muda de lugar sem mudar de tamanho (mexer a barra lateral empurra o painel inteiro), e nenhum aviso do
 * navegador cobre esse caso. Um retângulo igual ao último não é mandado de novo.
 *
 * Nada do DOM fica na frente da view. Por isso, com `frozen` (um menu ou diálogo do app aberto), a página dá lugar a
 * uma imagem parada dela: a imagem é pedida com a página ainda à vista, e a página sai quando a imagem chega, ou
 * depois de `STILL_DEADLINE_MS`, o que vier primeiro.
 *
 * O mesmo vale enquanto a pessoa arrasta uma divisória: a view segue o arraste com atraso e fica torta por cima do
 * app. Área que muda com o botão do mouse apertado é arraste; a imagem fica, no tamanho que a página tinha, até
 * soltar, e aí a página volta já no retângulo novo.
 */
export function BrowserViewport({
  projectId,
  tab,
  hidden,
  frozen = false,
  onRetry,
}: {
  projectId: string;
  tab: BrowserTabDto;
  /** Esconde a página sem tirar a área (painel recolhido). */
  hidden: boolean;
  /** Há uma sobreposição do app aberta: a página vira imagem parada. */
  frozen?: boolean;
  onRetry: () => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const hasPage = tab.error === null && tab.url !== '' && !hidden;
  /** O botão do mouse está apertado em algum lugar do app (a página é outra janela de conteúdo e não conta). */
  const pointerDown = useRef(false);
  /** O último retângulo em que a página foi posta: é o tamanho que a imagem parada dela tem. */
  const shown = useRef<BrowserBounds | null>(null);
  /** A área mudou com o botão apertado: a pessoa está arrastando uma divisória. */
  const [dragging, setDragging] = useState(false);
  const freezing = (frozen || dragging) && hasPage;
  /** A imagem parada, o tamanho da área quando ela foi pedida, e se a página já saiu de cima. */
  const [still, setStill] = useState<{
    image: string | null;
    size: { width: number; height: number } | null;
    covered: boolean;
  }>({ image: null, size: null, covered: false });
  const showsPage = hasPage && !(freezing && still.covered);

  useEffect(() => {
    const press = (event: Event) => {
      pointerDown.current = true;
      // Numa divisória o arraste é certo: a página sai antes de o mouse passar por cima dela.
      if (event.target instanceof Element && event.target.closest('[role="separator"]') !== null) {
        setDragging(true);
      }
    };
    const release = () => {
      pointerDown.current = false;
      setDragging(false);
    };
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('blur', release);
    };
  }, []);

  useEffect(() => {
    if (!freezing) return undefined;
    let cancelled = false;
    // A imagem é do tamanho que a página tinha: no arraste a área muda, e a imagem não estica.
    const page = shown.current;
    const size =
      page === null ? null : { width: Math.round(page.width), height: Math.round(page.height) };
    setStill((current) => ({ ...current, size: current.size ?? size }));
    const cover = (image: string | null) => {
      if (cancelled) return;
      setStill((current) => ({ ...current, image: image ?? current.image, covered: true }));
    };
    const deadline = window.setTimeout(() => cover(null), STILL_DEADLINE_MS);
    window.projectHub.browser.snapshot(projectId).then(
      (result) => cover(result.ok ? result.data : null),
      () => cover(null),
    );
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      setStill({ image: null, size: null, covered: false });
    };
  }, [freezing, projectId, tab.id]);

  useEffect(() => {
    const api = window.projectHub.browser;
    /** O último retângulo mandado; `undefined` antes do primeiro. */
    let sent: BrowserBounds | null | undefined;
    let frame: number | null = null;
    let disposed = false;

    const send = (bounds: BrowserBounds | null) => {
      if (sent !== undefined && sameBounds(sent, bounds)) return;
      sent = bounds;
      if (bounds !== null) shown.current = bounds;
      void api.setBounds(projectId, bounds);
    };

    const measure = (): BrowserBounds | null => {
      const area = areaRef.current;
      if (area === null || !showsPage) return null;
      const { x, y, width, height } = area.getBoundingClientRect();
      return width < 1 || height < 1 ? null : { x, y, width, height };
    };

    const tick = () => {
      frame = null;
      if (disposed) return;
      const bounds = measure();
      const moved = sent !== undefined && sent !== null && !sameBounds(sent, bounds);
      if (moved && pointerDown.current) {
        // Arraste: a página não corre atrás da área. Este efeito recomeça quando a imagem cobrir a página.
        setDragging(true);
      } else {
        send(bounds);
      }
      // Sem página à vista não há o que acompanhar: uma medição basta.
      if (showsPage) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      // Sem esperar o quadro: a área saiu da tela agora, e a página não pode ficar por cima do que vier.
      sent = undefined;
      send(null);
    };
  }, [projectId, showsPage]);

  return (
    <div className="browser__viewport" ref={areaRef}>
      {tab.error !== null ? (
        <div className="browser__state" role="alert">
          <p className="browser__state-text">{tab.error.message}</p>
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
        </div>
      ) : tab.url === '' ? (
        <EmptyState icon={Globe} title="Digite uma URL para começar" />
      ) : freezing && still.image !== null ? (
        // Decorativa: é a própria página, parada. O conteúdo dela não é do app.
        <img
          className="browser__still"
          src={still.image}
          alt=""
          width={still.size?.width}
          height={still.size?.height}
        />
      ) : null}
    </div>
  );
}
