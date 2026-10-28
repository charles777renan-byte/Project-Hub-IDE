import { useId } from 'react';
import type { ExecutionDto, MissionStepDto } from '@project-hub/contracts';
import {
  formatTokens,
  formatUsd,
  sumUsage,
  usageByTask,
  type UsageTotal,
} from '../../mission-usage';

const TITLE = 'Gasto de tokens';
const NOTE =
  'Tokens novos são a entrada nova mais a saída; o cache entra à parte. Só o Claude Code informa o gasto por enquanto.';
const COST_UNAVAILABLE = 'Custo estimado indisponível: algum modelo usado ainda não tem preço.';

/** Tokens novos de um total: a entrada nova e a saída. A leitura de cache fica de fora, porque domina a entrada. */
function newTokens(total: UsageTotal): number {
  return total.inputTokens + total.outputTokens;
}

function tokensLabel(count: number): string {
  return `${formatTokens(count)} ${count === 1 ? 'token novo' : 'tokens novos'}`;
}

/**
 * "Gasto de tokens" da missão, no centro da página: o total de tokens novos em destaque (entrada nova e
 * saída), o cache numa linha à parte e o custo estimado. O custo é sempre dito como estimativa a preço de
 * lista da API, não fatura; sem custo (algum modelo sem preço), a seção diz que ele está indisponível em
 * vez de mostrar zero. Com mais de uma linha, lista o gasto por tarefa (as tentativas de uma tarefa somam,
 * e a que roda a missão inteira aparece como "Missão inteira"). Sem nenhuma tentativa com uso, a seção
 * não aparece: falta de número não é zero. Tudo entra como texto, nunca como HTML.
 */
export function TokenUsage({
  executions,
  steps,
}: {
  executions: readonly ExecutionDto[];
  steps: readonly MissionStepDto[];
}) {
  const titleId = useId();
  const total = sumUsage(executions.map((execution) => execution.usage));
  if (total === undefined) return null;

  const rows = usageByTask(executions, steps);
  const cacheParts = [
    total.cacheReadInputTokens > 0
      ? `${formatTokens(total.cacheReadInputTokens)} lidos`
      : undefined,
    total.cacheWriteInputTokens > 0
      ? `${formatTokens(total.cacheWriteInputTokens)} escritos`
      : undefined,
  ].filter((part) => part !== undefined);

  return (
    <section aria-labelledby={titleId} className="token-usage">
      <h2 id={titleId} className="mission-section-title">
        {TITLE}
      </h2>
      <p className="token-usage__headline">
        <span className="token-usage__figure">{formatTokens(newTokens(total))}</span>{' '}
        {newTokens(total) === 1 ? 'token novo' : 'tokens novos'}
      </p>
      <p className="token-usage__detail">
        Entrada nova: {formatTokens(total.inputTokens)} · Saída: {formatTokens(total.outputTokens)}
      </p>
      {cacheParts.length > 0 ? (
        <p className="token-usage__detail">Cache: {cacheParts.join(' · ')}</p>
      ) : null}
      <p className="token-usage__detail">
        {total.costUsd === undefined
          ? COST_UNAVAILABLE
          : `Custo estimado a preço de lista da API: ${formatUsd(total.costUsd)} (não é fatura).`}
      </p>
      {rows.length > 1 ? (
        <ul className="token-usage__list" aria-label="Gasto por tarefa">
          {rows.map((row) => (
            <li key={row.key} className="token-usage__item">
              <span className="token-usage__task">{row.label}</span>{' '}
              <span className="token-usage__counts">
                {tokensLabel(newTokens(row.total))} ·{' '}
                {row.total.costUsd === undefined
                  ? 'custo indisponível'
                  : formatUsd(row.total.costUsd)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="token-usage__note">{NOTE}</p>
    </section>
  );
}
