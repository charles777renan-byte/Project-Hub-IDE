import { describe, expect, it } from 'vitest';
import { readLimitLine } from '../../src/claude-code/transcript-limit';

/** Linha de limite no formato antigo (Claude Code 2.1.219): só o texto diz a janela e a hora. */
const OLD_LINE = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-08-01T20:41:52.054Z',
  error: 'rate_limit',
  isApiErrorMessage: true,
  message: {
    model: '<synthetic>',
    content: [
      { type: 'text', text: "You've hit your session limit · resets 8:10pm (America/Sao_Paulo)" },
    ],
  },
});

/** Linha de limite no formato novo (2.1.299): o texto e os campos estruturados. */
const NEW_LINE = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-10-19T19:16:06.936Z',
  error: 'rate_limit',
  isApiErrorMessage: true,
  apiError: 'usage_limit_reached',
  apiErrorParams: {
    rate_limit_info: { status: 'rejected', resetsAt: 1792441800, rateLimitType: 'five_hour' },
  },
  message: {
    model: '<synthetic>',
    content: [
      { type: 'text', text: "You've hit your session limit · resets 5:30pm (America/Sao_Paulo)" },
    ],
  },
});

const ANSWER_LINE = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-10-19T19:16:06.936Z',
  message: { id: 'msg_1', content: [{ type: 'text', text: 'resposta comum' }] },
});

/** Linha antiga com campos trocados: `undefined` tira o campo. */
function line(
  change: { ts?: string; text?: string } & Record<string, unknown> = {},
): string {
  const { ts, text, ...rest } = change;
  const record = JSON.parse(OLD_LINE) as Record<string, unknown>;
  if (ts !== undefined) record['timestamp'] = ts;
  if (text !== undefined) {
    record['message'] = { model: '<synthetic>', content: [{ type: 'text', text }] };
  }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) delete record[key];
    else record[key] = value;
  }
  return JSON.stringify(record);
}

describe('readLimitLine', () => {
  it('lê o formato novo pela hora estruturada', () => {
    expect(readLimitLine(NEW_LINE)).toEqual({
      window: 'session',
      resetsAt: new Date(1792441800_000).toISOString(),
      at: Date.parse('2026-10-19T19:16:06.936Z'),
    });
  });

  it('lê o formato antigo pelo texto, na zona dada', () => {
    // 20:41 UTC = 17:41 em São Paulo; "8:10pm" é 20:10 de São Paulo = 23:10 UTC do mesmo dia
    expect(readLimitLine(OLD_LINE)?.resetsAt).toBe('2026-08-01T23:10:00.000Z');
  });

  it('passa para o dia seguinte quando a hora já passou', () => {
    // linha às 23:30 de São Paulo (02:30 UTC do dia 2), "resets 1am" → 01:00 de São Paulo do dia 2 = 04:00 UTC
    expect(
      readLimitLine(
        line({
          ts: '2026-08-02T02:30:00.000Z',
          text: "You've hit your session limit · resets 1am (America/Sao_Paulo)",
        }),
      )?.resetsAt,
    ).toBe('2026-08-02T04:00:00.000Z');
  });

  it('reconhece a janela semanal pelo texto e não lê a hora que vem depois de uma data', () => {
    const read = readLimitLine(
      line({ text: "You've hit your weekly limit · resets Nov 25, 9am (America/Sao_Paulo)" }),
    );
    expect(read?.window).toBe('weekly');
    expect(read).not.toHaveProperty('resetsAt');
  });

  it('reconhece a janela semanal pelo campo estruturado', () => {
    expect(
      readLimitLine(
        line({
          apiErrorParams: { rate_limit_info: { resetsAt: 1792441800, rateLimitType: 'seven_day_opus' } },
        }),
      )?.window,
    ).toBe('weekly');
  });

  it('fica sem hora quando o texto não traz uma que dê para ler', () => {
    const read = readLimitLine(line({ text: "You've hit your session limit" }));
    expect(read?.window).toBe('session');
    expect(read).not.toHaveProperty('resetsAt');
  });

  it('fica sem hora quando a zona não existe', () => {
    expect(
      readLimitLine(line({ text: "You've hit your session limit · resets 8pm (Lugar/Nenhum)" }))
        ?.resetsAt,
    ).toBeUndefined();
  });

  it.each([
    ['sem isApiErrorMessage', { isApiErrorMessage: undefined }],
    ['outro erro', { error: 'overloaded' }],
    ['sem timestamp', { timestamp: undefined }],
  ])('não reconhece linha %s', (_name, change) => {
    expect(readLimitLine(line(change))).toBeUndefined();
  });

  it('não reconhece JSON quebrado nem resposta comum', () => {
    expect(readLimitLine('{"error":"rate_limit"')).toBeUndefined();
    expect(readLimitLine(ANSWER_LINE)).toBeUndefined();
  });
});
