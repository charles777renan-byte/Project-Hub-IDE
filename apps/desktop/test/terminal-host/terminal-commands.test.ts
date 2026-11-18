import { describe, expect, it } from 'vitest';
import { MAX_RECORD_BYTES, fitRecords } from '../../src/terminal-host/terminal-commands';

const at = '2026-11-17T12:00:00.000Z';

function record(seq: number, payload: Record<string, unknown>) {
  return { seq, receivedAt: at, payload };
}

describe('fitRecords', () => {
  it('registro pequeno passa inteiro', () => {
    const small = record(1, { hook_event_name: 'Stop', session_id: 's1' });
    expect(fitRecords([small])).toEqual([small]);
  });

  it('registro grande demais guarda os campos curtos, o comando e o final da saída', () => {
    const stdout = `${'linha de teste\n'.repeat(5000)}      Tests  12 passed (12)`;
    const big = record(1, {
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      transcript_path: '/t/s1.jsonl',
      tool_name: 'Bash',
      tool_use_id: 't1',
      duration_ms: 4187,
      tool_input: { command: 'pnpm test', description: 'Rodar os testes', timeout: 120000 },
      tool_response: { stdout, stderr: 'aviso', interrupted: false, isImage: false },
    });

    const [fitted] = fitRecords([big]);
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(MAX_RECORD_BYTES);
    expect(fitted?.seq).toBe(1);
    expect(fitted?.payload).toMatchObject({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      transcript_path: '/t/s1.jsonl',
      tool_name: 'Bash',
      tool_use_id: 't1',
      duration_ms: 4187,
      truncated: true,
      tool_input: { command: 'pnpm test' },
      tool_response: { stderr: 'aviso', interrupted: false },
    });
    const response = fitted?.payload['tool_response'] as { stdout: string };
    expect(response.stdout.endsWith('Tests  12 passed (12)')).toBe(true);
    // O corte não deixa uma linha pela metade no começo.
    expect(response.stdout.startsWith('linha de teste\n')).toBe(true);
    expect(response.stdout.length).toBeLessThan(stdout.length);
  });

  it('falha grande demais guarda o começo e o final do erro', () => {
    const error = `Exit code 1\n${'x'.repeat(60_000)}\n      Tests  1 failed | 2 passed (3)`;
    const [fitted] = fitRecords([
      record(1, { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', error }),
    ]);
    const kept = fitted?.payload['error'] as string;
    expect(kept.startsWith('Exit code 1')).toBe(true);
    expect(kept.endsWith('Tests  1 failed | 2 passed (3)')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(MAX_RECORD_BYTES);
  });

  it('se nem o resumo cabe, fica só o nome do evento, para a sequência não travar', () => {
    // Campos curtos demais para serem cortados, em quantidade que passa do limite.
    const many = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`campo_${index}`, 'a'.repeat(400)]),
    );
    const [fitted] = fitRecords([record(1, { hook_event_name: 'PostToolUse', ...many })]);
    expect(fitted?.payload).toEqual({ hook_event_name: 'PostToolUse', truncated: true });
  });

  it('o que não cabe na resposta fica para a leitura seguinte, e o primeiro sempre vai', () => {
    const filler = 'a'.repeat(15_000);
    const records = [1, 2, 3].map((seq) => record(seq, { hook_event_name: 'Stop', filler }));
    expect(fitRecords(records).map((entry) => entry.seq)).toEqual([1, 2]);
  });
});
