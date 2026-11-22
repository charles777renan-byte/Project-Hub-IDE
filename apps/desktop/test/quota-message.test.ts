import { describe, expect, it } from 'vitest';
import type { LimitsDto } from '@project-hub/contracts';
import { accountSwitchText, quotaExhaustedMessage } from '../src/main/quota-message';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const inHours = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function limits(windows: { id: string; usedPercent: number; resetsAt: string }[]): LimitsDto {
  return { accounts: [], providers: [{ provider: 'claude', windows, refreshing: false }] };
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
    expect(quotaExhaustedMessage({ providers: [], accounts: [] }, NOW)).toBeUndefined();
  });
});

/** A hora como o processo principal a escreve, no fuso da máquina que roda o teste. */
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

describe('quotaExhaustedMessage com a marcação', () => {
  it('usa a marcação quando nenhuma janela está em 100%', () => {
    expect(quotaExhaustedMessage({ providers: [], accounts: [] }, NOW, inHours(2))).toBe(
      `A cota do Claude acabou. Renova às ${clock(inHours(2))}. Veja o uso no Início, em Uso do Claude.`,
    );
  });

  it('vale a mais tardia entre a janela e a marcação', () => {
    const message = quotaExhaustedMessage(
      limits([{ id: 'five_hour', usedPercent: 100, resetsAt: inHours(1) }]),
      NOW,
      inHours(3),
    );
    expect(message).toContain(`Renova às ${clock(inHours(3))}.`);
  });

  it('marcação vencida não conta', () => {
    expect(quotaExhaustedMessage({ providers: [], accounts: [] }, NOW, inHours(-1))).toBeUndefined();
  });
});

describe('accountSwitchText', () => {
  it('monta a frase da troca, com a hora quando ela é conhecida', () => {
    expect(
      accountSwitchText({ fromName: 'Trabalho', toName: 'Pessoal', resetsAt: inHours(2) }, NOW),
    ).toBe(
      `Limite da conta Trabalho acabou (renova às ${clock(inHours(2))}). A missão continuou na conta Pessoal.`,
    );
    expect(accountSwitchText({ fromName: 'Trabalho', toName: 'Pessoal' }, NOW)).toBe(
      'Limite da conta Trabalho acabou. A missão continuou na conta Pessoal.',
    );
  });

  it('com a renovação a mais de um dia, diz o dia', () => {
    expect(
      accountSwitchText({ fromName: 'A', toName: 'B', resetsAt: inHours(30) }, NOW),
    ).toMatch(/^Limite da conta A acabou \(renova em \d{2}\/\d{2}, às \d{2}:\d{2}\)\./);
  });
});
