import { describe, expect, it } from 'vitest';
import {
  openShellInputSchema,
  terminalEventSchema,
  terminalResizeInputSchema,
  terminalSummarySchema,
  terminalWriteInputSchema,
} from '../src';

describe('contratos de terminal', () => {
  it('aceita os três eventos e recusa um tipo desconhecido', () => {
    expect(
      terminalEventSchema.safeParse({ type: 'data', terminalId: 't', data: 'oi' }).success,
    ).toBe(true);
    expect(
      terminalEventSchema.safeParse({ type: 'exit', terminalId: 't', exitCode: 0 }).success,
    ).toBe(true);
    expect(terminalEventSchema.safeParse({ type: 'restart', terminalId: 't' }).success).toBe(true);
    expect(terminalEventSchema.safeParse({ type: 'apagar', terminalId: 't' }).success).toBe(false);
  });

  it('limita a digitação e o tamanho do terminal', () => {
    expect(
      terminalWriteInputSchema.safeParse({ terminalId: 't', data: 'x'.repeat(16_385) }).success,
    ).toBe(false);
    expect(
      terminalResizeInputSchema.safeParse({ terminalId: 't', cols: 0, rows: 10 }).success,
    ).toBe(false);
    expect(
      terminalResizeInputSchema.safeParse({ terminalId: 't', cols: 120, rows: 30 }).success,
    ).toBe(true);
  });

  it('abrir shell recebe só o projeto, e o resumo não carrega caminho nem comando', () => {
    expect(openShellInputSchema.safeParse({ projectId: 'p1' }).success).toBe(true);
    const summary = terminalSummarySchema.parse({
      id: 't',
      kind: 'shell',
      title: 'Shell',
      projectId: 'p1',
      projectName: 'app',
      state: 'running',
      cwd: 'C:/segredo',
    });
    expect(Object.keys(summary)).not.toContain('cwd');
  });
});
