import type { ExecutionDto, MissionStepDto, UsageSummaryDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { formatTokens, formatUsd, sumUsage, usageByTask } from '../../src/renderer/mission-usage';

/** O Intl do Brasil separa o código da moeda do valor com um espaço sem quebra; o teste compara com espaço comum. */
function plain(text: string): string {
  return text.replaceAll(String.fromCharCode(0xa0), ' ');
}

function usageOf(overrides: Partial<UsageSummaryDto> = {}): UsageSummaryDto {
  return { inputTokens: 100, outputTokens: 20, ...overrides };
}

function executionOf(id: string, usage?: UsageSummaryDto, stepId?: string): ExecutionDto {
  return {
    id,
    missionId: 'm1',
    attempt: 1,
    status: 'succeeded',
    ...(stepId === undefined ? {} : { stepId }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function stepOf(id: string, position: number, title: string): MissionStepDto {
  return { id, position, title, status: 'succeeded', agent: 'claude-code' };
}

describe('sumUsage', () => {
  it('sem nenhuma tentativa, não há total (e não é zero)', () => {
    expect(sumUsage([])).toBeUndefined();
  });

  it('só tentativas sem uso também não dão total', () => {
    expect(sumUsage([undefined, undefined])).toBeUndefined();
  });

  it('ignora a tentativa sem uso, sem contá-la como zero', () => {
    const total = sumUsage([usageOf({ estimatedCostUsd: 0.5 }), undefined]);
    expect(total).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      costUsd: 0.5,
    });
  });

  it('um uso antigo, sem os campos de cache, conta só com o que tem', () => {
    const total = sumUsage([usageOf()]);
    expect(total).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });

  it('soma entrada, saída, leitura de cache e as duas escritas de cache', () => {
    const total = sumUsage([
      usageOf({
        cacheReadInputTokens: 1000,
        cacheWrite5mInputTokens: 30,
        cacheWrite1hInputTokens: 4,
        estimatedCostUsd: 0.25,
      }),
      usageOf({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 500,
        cacheWrite5mInputTokens: 6,
        estimatedCostUsd: 0.5,
      }),
    ]);
    expect(total).toEqual({
      inputTokens: 110,
      outputTokens: 25,
      cacheReadInputTokens: 1500,
      cacheWriteInputTokens: 40,
      costUsd: 0.75,
    });
  });

  it('o custo some quando uma das partes não tem custo', () => {
    const total = sumUsage([
      usageOf({ estimatedCostUsd: 0.25 }),
      usageOf(),
      usageOf({ estimatedCostUsd: 0.5 }),
    ]);
    expect(total).toBeDefined();
    expect(total?.inputTokens).toBe(300);
    expect(total?.costUsd).toBeUndefined();
    expect(total).not.toHaveProperty('costUsd');
  });

  it('o custo some mesmo quando só a primeira parte é a que não tem custo', () => {
    const total = sumUsage([usageOf(), usageOf({ estimatedCostUsd: 0.5 })]);
    expect(total?.costUsd).toBeUndefined();
  });

  it('custo zero informado é custo (zero de verdade), não custo ausente', () => {
    expect(sumUsage([usageOf({ estimatedCostUsd: 0 })])?.costUsd).toBe(0);
  });

  it('aceita qualquer iterável', () => {
    const total = sumUsage(new Set([usageOf()]));
    expect(total?.inputTokens).toBe(100);
  });
});

describe('usageByTask', () => {
  const steps = [
    stepOf('s2', 2, 'Testar'),
    stepOf('s1', 1, 'Implementar'),
    stepOf('s3', 3, 'Docs'),
  ];

  it('sem nenhuma tentativa com uso, não há linhas', () => {
    expect(usageByTask([executionOf('e1', undefined, 's1')], steps)).toEqual([]);
  });

  it('põe as linhas na ordem do plano, não na das tentativas', () => {
    const rows = usageByTask(
      [
        executionOf('e1', usageOf({ inputTokens: 2 }), 's2'),
        executionOf('e2', usageOf({ inputTokens: 1 }), 's1'),
      ],
      steps,
    );
    expect(rows.map((row) => row.label)).toEqual(['1. Implementar', '2. Testar']);
    expect(rows.map((row) => row.key)).toEqual(['s1', 's2']);
  });

  it('a tentativa sem tarefa vira "Missão inteira" e vem primeiro', () => {
    const rows = usageByTask(
      [executionOf('e1', usageOf(), 's1'), executionOf('e2', usageOf({ inputTokens: 7 }))],
      steps,
    );
    expect(rows.map((row) => row.label)).toEqual(['Missão inteira', '1. Implementar']);
    expect(rows[0]?.total.inputTokens).toBe(7);
  });

  it('as tentativas da mesma tarefa (retries) entram na soma dela', () => {
    const rows = usageByTask(
      [
        executionOf('e1', usageOf({ inputTokens: 10, estimatedCostUsd: 0.1 }), 's1'),
        executionOf('e2', usageOf({ inputTokens: 5, estimatedCostUsd: 0.2 }), 's1'),
      ],
      steps,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total.inputTokens).toBe(15);
    expect(rows[0]?.total.costUsd).toBeCloseTo(0.3);
  });

  it('tarefa sem gasto fica de fora, e a tentativa sem uso não vira zero', () => {
    const rows = usageByTask(
      [executionOf('e1', usageOf(), 's1'), executionOf('e2', undefined, 's2')],
      steps,
    );
    expect(rows.map((row) => row.key)).toEqual(['s1']);
  });

  it('não muda a ordem da lista de tarefas que recebeu', () => {
    const before = steps.map((step) => step.id);
    usageByTask([executionOf('e1', usageOf(), 's1')], steps);
    expect(steps.map((step) => step.id)).toEqual(before);
  });
});

describe('formatTokens', () => {
  it('usa o ponto como separador de milhar, no formato do Brasil', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12345)).toBe('12.345');
    expect(formatTokens(1234567)).toBe('1.234.567');
  });
});

describe('formatUsd', () => {
  it('mostra o código da moeda e a vírgula decimal, com duas casas', () => {
    expect(plain(formatUsd(1.5))).toBe('USD 1,50');
    expect(plain(formatUsd(1234.567))).toBe('USD 1.234,57');
    expect(plain(formatUsd(0))).toBe('USD 0,00');
  });

  it('abaixo de um centavo, diz isso em vez de mostrar zero', () => {
    expect(plain(formatUsd(0.004))).toBe('menos de USD 0,01');
    expect(plain(formatUsd(0.0001))).toBe('menos de USD 0,01');
  });

  it('um centavo exato já é mostrado como valor', () => {
    expect(plain(formatUsd(0.01))).toBe('USD 0,01');
  });
});
