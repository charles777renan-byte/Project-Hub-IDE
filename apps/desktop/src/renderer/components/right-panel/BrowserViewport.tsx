import type { BrowserBounds, BrowserTabDto } from '@project-hub/contracts';
import { useEffect, useRef } from 'react';
import { EmptyState } from '../EmptyState';
import { Globe } from '../Icon';

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
 */
export function BrowserViewport({
  projectId,
  tab,
  hidden,
  onRetry,
}: {
  projectId: string;
  tab: BrowserTabDto;
  /** Esconde a página sem tirar a área (painel recolhido, sobreposição aberta). */
  hidden: boolean;
  onRetry: () => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const showsPage = tab.error === null && tab.url !== '' && !hidden;

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
      ) : null}
    </div>
  );
}
