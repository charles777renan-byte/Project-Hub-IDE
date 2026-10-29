import type { ExecutionDto, MissionStepDto, UsageSummaryDto } from '@project-hub/contracts';

/** Total de tokens de uma ou mais tentativas. `costUsd` só existe quando todas as partes têm custo. */
export type UsageTotal = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  costUsd?: number;
};

/**
 * Soma o gasto das tentativas. Tentativa sem `usage` fica de fora (não conta como zero), e sem nenhuma
 * com uso o total é `undefined`. Um uso antigo, sem os campos de cache, conta só com o que tem.
 */
export function sumUsage(usages: Iterable<UsageSummaryDto | undefined>): UsageTotal | undefined {
  let total: UsageTotal | undefined;
  let cost: number | undefined = 0;
  for (const usage of usages) {
    if (usage === undefined) continue;
    total ??= {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    };
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
    total.cacheWriteInputTokens +=
      (usage.cacheWrite5mInputTokens ?? 0) + (usage.cacheWrite1hInputTokens ?? 0);
    cost =
      cost === undefined || usage.estimatedCostUsd === undefined
        ? undefined
        : cost + usage.estimatedCostUsd;
  }
  if (total !== undefined && cost !== undefined) total.costUsd = cost;
  return total;
}

/** O gasto de uma tarefa do plano: a soma das tentativas dela, inclusive as que falharam. */
export type TaskUsage = { key: string; label: string; total: UsageTotal };

/**
 * O gasto por tarefa, na ordem do plano. A tentativa que roda a missão inteira (sem tarefa) aparece como
 * "Missão inteira". Tarefa sem gasto fica de fora.
 */
export function usageByTask(
  executions: readonly ExecutionDto[],
  steps: readonly MissionStepDto[],
): TaskUsage[] {
  const rows: TaskUsage[] = [];
  const whole = sumUsage(
    executions.filter((execution) => execution.stepId === undefined).map((e) => e.usage),
  );
  if (whole !== undefined) rows.push({ key: 'missao', label: 'Missão inteira', total: whole });
  for (const step of [...steps].sort((a, b) => a.position - b.position)) {
    const total = sumUsage(
      executions.filter((execution) => execution.stepId === step.id).map((e) => e.usage),
    );
    if (total !== undefined) {
      rows.push({ key: step.id, label: `${step.position}. ${step.title}`, total });
    }
  }
  return rows;
}

const TOKENS = new Intl.NumberFormat('pt-BR');
const USD = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Contagem de tokens no formato do Brasil (`12.345`). */
export function formatTokens(count: number): string {
  return TOKENS.format(count);
}

/** Valor em dólar com duas casas; abaixo de um centavo, diz isso em vez de mostrar zero. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return `menos de ${USD.format(0.01)}`;
  return USD.format(value);
}
