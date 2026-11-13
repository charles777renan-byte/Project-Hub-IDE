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
 * componente desmontado), informa `null`, e a view some. As medições de um mesmo quadro viram um pedido só, e um
 * retângulo igual ao último não é mandado de novo.
 *
 * Nada do DOM fica na frente da view. Por isso, com `frozen` (um menu ou diálogo do app aberto), a página dá lugar a
 * uma imagem parada dela: a imagem é pedida com a página ainda à vista, e a página sai quando a imagem chega, ou
 * depois de `STILL_DEADLINE_MS`, o que vier primeiro.
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
  const freezing = frozen && hasPage;
  /** A imagem parada, e se a página já saiu de cima. Só valem enquanto `freezing`. */
  const [still, setStill] = useState<{ image: string | null; covered: boolean }>({
    image: null,
    covered: false,
  });
  const showsPage = hasPage && !(freezing && still.covered);

  useEffect(() => {
    if (!freezing) return undefined;
    let cancelled = false;
    const cover = (image: string | null) => {
      if (cancelled) return;
      setStill((current) => ({ image: image ?? current.image, covered: true }));
    };
    const deadline = window.setTimeout(() => cover(null), STILL_DEADLINE_MS);
    window.projectHub.browser.snapshot(projectId).then(
      (result) => cover(result.ok ? result.data : null),
      () => cover(null),
    );
    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      setStill({ image: null, covered: false });
    };
  }, [freezing, projectId, tab.id]);

  useEffect(() => {
    const api = window.projectHub.browser;
    /** O último retângulo mandado; `undefined` antes do primeiro. */
    let sent: BrowserBounds | null | undefined;
    let frame: number | null = null;

    const send = (bounds: BrowserBounds | null) => {
      if (sent !== undefined && sameBounds(sent, bounds)) return;
      sent = bounds;
      void api.setBounds(projectId, bounds);
    };

    const measure = (): BrowserBounds | null => {
      const area = areaRef.current;
      if (area === null || !showsPage) return null;
      const { x, y, width, height } = area.getBoundingClientRect();
      return width < 1 || height < 1 ? null : { x, y, width, height };
    };

    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        send(measure());
      });
    };

    schedule();
    const area = areaRef.current;
    const observer = new ResizeObserver(schedule);
    if (area !== null) observer.observe(area);
    // O painel pode mudar de lugar sem mudar de tamanho (a janela cresce e ele segue colado à direita).
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
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
        <img className="browser__still" src={still.image} alt="" />
      ) : null}
    </div>
  );
}
