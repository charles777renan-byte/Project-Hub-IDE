import { describe, expect, it } from 'vitest';
import {
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

  it('o resumo não carrega caminho nem comando', () => {
    const summary = terminalSummarySchema.parse({
      id: 't',
      kind: 'shell',
      title: 'Shell',
      projectId: 'p1',
      projectName: 'app',
      state: 'running',
      provider: 'shell',
      origin: 'new',
      cwd: 'C:/segredo',
    });
    expect(Object.keys(summary)).not.toContain('cwd');
  });

  it('o resumo exige provedor e origem conhecidos, e o nome do worktree é opcional', () => {
    const base = {
      id: 't',
      kind: 'agent',
      title: 'Agente',
      projectId: 'p1',
      projectName: 'app',
      state: 'running',
    };
    const ok = { ...base, provider: 'claude', origin: 'recovered', worktreeName: 'mission-1' };
    expect(terminalSummarySchema.safeParse(ok).success).toBe(true);
    expect(terminalSummarySchema.safeParse({ ...ok, worktreeName: undefined }).success).toBe(true);
    expect(terminalSummarySchema.safeParse({ ...base, origin: 'new' }).success).toBe(false);
    expect(terminalSummarySchema.safeParse({ ...base, provider: 'claude' }).success).toBe(false);
    expect(terminalSummarySchema.safeParse({ ...ok, provider: 'bash' }).success).toBe(false);
    expect(terminalSummarySchema.safeParse({ ...ok, origin: 'resumed' }).success).toBe(false);
  });

  it('o resumo aceita modelo e contexto, e continua valendo sem eles', () => {
    const base = {
      id: 't',
      kind: 'shell',
      title: 'Claude',
      projectId: 'p1',
      projectName: 'app',
      state: 'running',
      provider: 'claude',
      origin: 'new',
    };
    const context = { usedTokens: 42_000, windowTokens: 1_000_000 };
    const withContext = terminalSummarySchema.parse({
      ...base,
      model: 'claude-sonnet-5-5',
      context,
    });
    expect(withContext.model).toBe('claude-sonnet-5-5');
    expect(withContext.context).toEqual(context);
    expect(terminalSummarySchema.safeParse(base).success).toBe(true);
    expect(
      terminalSummarySchema.safeParse({ ...base, context: { usedTokens: -1, windowTokens: 5 } })
        .success,
    ).toBe(false);
    expect(
      terminalSummarySchema.safeParse({ ...base, context: { usedTokens: 1.5, windowTokens: 5 } })
        .success,
    ).toBe(false);
    expect(terminalSummarySchema.safeParse({ ...base, context: { usedTokens: 1 } }).success).toBe(
      false,
    );
  });
});
