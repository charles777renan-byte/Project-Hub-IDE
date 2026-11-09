import { describe, expect, it } from 'vitest';
import { IDLE_SAMPLES, isIdle } from '../../src/renderer/sidebar-activity';

// Sessão viva e parada (§4 do documento de UI/UX): o ponto vazado e cinza só aparece depois de algumas leituras
// sem saída, para o ponto não piscar entre uma linha e outra do agente.

describe('isIdle', () => {
  it('sem amostras, ou com menos que a janela, não é ociosa (o terminal acabou de aparecer)', () => {
    expect(isIdle(undefined)).toBe(false);
    expect(isIdle([0])).toBe(false);
    expect(isIdle(Array<number>(IDLE_SAMPLES - 1).fill(0))).toBe(false);
  });

  it('as últimas leituras todas sem saída: ociosa', () => {
    expect(isIdle(Array<number>(IDLE_SAMPLES).fill(0))).toBe(true);
    expect(isIdle([900, ...Array<number>(IDLE_SAMPLES).fill(0)])).toBe(true);
  });

  it('qualquer saída na janela: não é ociosa', () => {
    expect(isIdle([...Array<number>(IDLE_SAMPLES - 1).fill(0), 12])).toBe(false);
  });
});
