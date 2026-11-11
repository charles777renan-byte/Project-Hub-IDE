import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { DRAG_THRESHOLD, previewBox, zoneAt, type Box, type DropZone } from './pane-drag';

/** O arrasto em curso, para desenhar a prévia do destino e o "fantasma" que segue o ponteiro. */
export type PaneDragState = {
  sourceId: string;
  /** O ponteiro, em px da janela. */
  x: number;
  y: number;
  /** O destino sob o ponteiro; `null` quando soltar ali não muda nada. */
  zone: DropZone | null;
  /** A área que o painel vai ocupar, em px a partir do canto da área da grade. */
  preview: Box | null;
};

type Options = {
  /** A área da grade: os lugares dos painéis (`.pane-tree__leaf[data-leaf-id]`) são procurados dentro dela. */
  area: HTMLElement | null;
  /** O destino vale? Encaixe que deixaria algum painel abaixo do mínimo, por exemplo, não vale. */
  accepts(sourceId: string, zone: DropZone): boolean;
  onDrop(sourceId: string, zone: DropZone): void;
};

type Gesture = {
  sourceId: string;
  pointerId: number;
  grip: HTMLElement;
  startX: number;
  startY: number;
  started: boolean;
  zone: DropZone | null;
  stop(): void;
};

const SOURCE_FLAG = 'dragSource';

function slotsOf(area: HTMLElement): { id: string; element: HTMLElement; box: Box }[] {
  return Array.from(area.querySelectorAll<HTMLElement>('.pane-tree__leaf[data-leaf-id]')).map(
    (element) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return { id: element.dataset.leafId ?? '', element, box: { left, top, width, height } };
    },
  );
}

/**
 * Arrastar um painel pela alça do cabeçalho, com eventos de ponteiro (e não o arrastar-e-soltar do HTML, que não dá
 * controle da prévia nem funciona bem sobre o terminal). O gesto só vira arrasto depois de `DRAG_THRESHOLD` px, e o
 * ponteiro fica capturado na alça: o terminal embaixo não recebe nada. Soltar fora de um destino válido ou apertar
 * Esc cancela. Nada do layout muda durante o arrasto, só ao soltar, então nenhum terminal é movido no meio do gesto.
 */
export function usePaneDrag({ area, accepts, onDrop }: Options) {
  const [drag, setDrag] = useState<PaneDragState | null>(null);
  const gesture = useRef<Gesture | null>(null);
  // Os callbacks mais recentes, para os ouvintes do gesto (registrados uma vez) não ficarem com os antigos.
  const latest = useRef({ area, accepts, onDrop });
  latest.current = { area, accepts, onDrop };

  const finish = useCallback((apply: boolean) => {
    const current = gesture.current;
    if (current === null) return;
    gesture.current = null;
    current.stop();
    setDrag(null);
    if (apply && current.started && current.zone !== null) {
      latest.current.onDrop(current.sourceId, current.zone);
    }
  }, []);

  // A página saiu da tela no meio do gesto: nada fica pendurado.
  useEffect(() => () => finish(false), [finish]);

  const onGripPointerDown = useCallback(
    (leafId: string, event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || gesture.current !== null) return;
      const grip = event.currentTarget;
      const pointerId = event.pointerId;

      const onMove = (move: globalThis.PointerEvent) => {
        const current = gesture.current;
        if (current === null || move.pointerId !== pointerId) return;
        if (!current.started) {
          if (
            Math.hypot(move.clientX - current.startX, move.clientY - current.startY) <
            DRAG_THRESHOLD
          )
            return;
          current.started = true;
        }
        const root = latest.current.area;
        const slots = root === null ? [] : slotsOf(root);
        for (const slot of slots) {
          if (slot.id === leafId) slot.element.dataset[SOURCE_FLAG] = 'true';
        }
        const found = zoneAt(slots, leafId, move.clientX, move.clientY);
        const zone = found !== null && latest.current.accepts(leafId, found) ? found : null;
        current.zone = zone;
        let preview: Box | null = null;
        if (zone !== null && root !== null) {
          const target = slots.find((slot) => slot.id === zone.targetId);
          const origin = root.getBoundingClientRect();
          if (target !== undefined) {
            const box = previewBox(target.box, zone.spot);
            preview = { ...box, left: box.left - origin.left, top: box.top - origin.top };
          }
        }
        setDrag({ sourceId: leafId, x: move.clientX, y: move.clientY, zone, preview });
      };
      const onUp = (up: globalThis.PointerEvent) => {
        if (up.pointerId === pointerId) finish(true);
      };
      const onCancel = (cancel: globalThis.PointerEvent) => {
        if (cancel.pointerId === pointerId) finish(false);
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key !== 'Escape') return;
        // O Esc é do arrasto: não chega ao terminal nem fecha outra coisa.
        key.preventDefault();
        key.stopPropagation();
        finish(false);
      };
      // Um clique que termina o arrasto sobre a alça não é um clique nela.
      const onLostCapture = () => finish(false);

      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
      grip.addEventListener('pointercancel', onCancel);
      grip.addEventListener('lostpointercapture', onLostCapture);
      window.addEventListener('keydown', onKey, true);
      try {
        grip.setPointerCapture(pointerId);
      } catch {
        // Sem captura (ponteiro que já sumiu) o gesto ainda vale enquanto o ponteiro estiver sobre a alça.
      }

      gesture.current = {
        sourceId: leafId,
        pointerId,
        grip,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
        zone: null,
        stop: () => {
          grip.removeEventListener('pointermove', onMove);
          grip.removeEventListener('pointerup', onUp);
          grip.removeEventListener('pointercancel', onCancel);
          grip.removeEventListener('lostpointercapture', onLostCapture);
          window.removeEventListener('keydown', onKey, true);
          try {
            if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
          } catch {
            // A alça já saiu do documento.
          }
          const root = latest.current.area;
          root
            ?.querySelectorAll<HTMLElement>('.pane-tree__leaf[data-drag-source]')
            .forEach((element) => delete element.dataset[SOURCE_FLAG]);
        },
      };
      // Sem seleção de texto nem arrasto nativo começando pela alça.
      event.preventDefault();
    },
    [finish],
  );

  return { drag, onGripPointerDown };
}
