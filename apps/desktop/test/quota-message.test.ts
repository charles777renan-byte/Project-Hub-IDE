import { describe, expect, it } from 'vitest';
import type { LimitsDto } from '@project-hub/contracts';
import { quotaExhaustedMessage } from '../src/main/quota-message';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const inHours = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function limits(windows: { id: string; usedPercent: number; resetsAt: string }[]): LimitsDto {
  return { providers: [{ provider: 'claude', windows, refreshing: false }] };
}

describe('quotaExhaustedMessage', () => {
  it('com a janela da sessão em 100%, diz que a cota acabou e a hora da renovação', () => {
    const message = quotaExhaustedMessage(
      limits([{ id: 'five_hour', usedPercent: 100, resetsAt: inHours(2) }]),
      NOW,
    );

    expect(message).toMatch(/^A cota do Claude acabou\. Renova às \d{2}:\d{2}\./);
    expect(message).toContain('Uso do Claude');
  });

  it('com a semana esgotada e renovando em mais de um dia, mostra o dia e a hora', () => {
    const message = quotaExhaustedMessage(
      limits([{ id: 'seven_day', usedPercent: 100, resetsAt: inHours(24 * 5) }]),
      NOW,
    );

    expect(message).toMatch(/Renova em \d{2}\/\d{2}, às \d{2}:\d{2}\./);
  });

  it('com as duas janelas esgotadas, vale a que renova por último', () => {
    const message = quotaExhaustedMessage(
      limits([
        { id: 'five_hour', usedPercent: 100, resetsAt: inHours(2) },
        { id: 'seven_day', usedPercent: 100, resetsAt: inHours(24 * 5) },
      ]),
      NOW,
    );

    expect(message).toMatch(/Renova em \d{2}\/\d{2}, às/);
  });

  it('com a janela abaixo de 100%, não há mensagem de cota', () => {
    expect(
      quotaExhaustedMessage(
        limits([{ id: 'five_hour', usedPercent: 99, resetsAt: inHours(2) }]),
        NOW,
      ),
    ).toBeUndefined();
  });

  it('com a janela em 100% mas já renovada (o instante passou), não há mensagem de cota', () => {
    expect(
      quotaExhaustedMessage(
        limits([{ id: 'five_hour', usedPercent: 100, resetsAt: inHours(-1) }]),
        NOW,
      ),
    ).toBeUndefined();
  });

  it('sem nenhuma leitura do Claude, não há mensagem de cota', () => {
    expect(quotaExhaustedMessage({ providers: [] }, NOW)).toBeUndefined();
  });
});
