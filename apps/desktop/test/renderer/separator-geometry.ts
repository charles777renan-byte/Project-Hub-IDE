import { vi } from 'vitest';

/**
 * O jsdom não tem geometria: toda caixa mede 0 e todo ponteiro nasce em (0, 0). O react-resizable-panels acha,
 * então, que todo clique cai numa divisória e cancela o `pointerdown` de qualquer controle da página. Esta
 * função tira as divisórias (`role="separator"`) do caminho, medindo-as longe de (0, 0). Quem a chama restaura
 * no fim do teste, com `vi.restoreAllMocks()`.
 */
export function moveSeparatorsAway() {
  const measure = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') !== 'separator') return measure.call(this);
    return {
      x: 9000,
      y: 9000,
      left: 9000,
      top: 9000,
      right: 9008,
      bottom: 9008,
      width: 8,
      height: 8,
      toJSON: () => ({}),
    };
  });
}
