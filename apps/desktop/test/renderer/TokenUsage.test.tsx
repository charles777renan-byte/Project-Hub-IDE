import { render, screen, within } from '@testing-library/react';
import type { ExecutionDto, MissionStepDto, UsageSummaryDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { TokenUsage } from '../../src/renderer/components/mission/TokenUsage';

/** O Intl do Brasil separa o código da moeda do valor com um espaço sem quebra; o teste compara com espaço comum. */
function textOf(element: HTMLElement): string {
  return (element.textContent ?? '').replaceAll(String.fromCharCode(0xa0), ' ');
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

const STEPS = [stepOf('s1', 1, 'Implementar'), stepOf('s2', 2, 'Testar')];

function section(): HTMLElement {
  return screen.getByRole('region', { name: 'Gasto de tokens' });
}

describe('TokenUsage', () => {
  it('sem nenhuma tentativa com gasto, não mostra a seção (falta de número não é zero)', () => {
    const { container } = render(
      <TokenUsage executions={[executionOf('e1', undefined, 's1')]} steps={STEPS} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('sem tentativas, não mostra a seção', () => {
    const { container } = render(<TokenUsage executions={[]} steps={STEPS} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('com custo: destaca os tokens novos, põe o cache à parte e diz que o custo é estimativa, não fatura', () => {
    render(
      <TokenUsage
        executions={[
          executionOf(
            'e1',
            {
              inputTokens: 10000,
              outputTokens: 2345,
              cacheReadInputTokens: 500000,
              cacheWrite5mInputTokens: 2000,
              cacheWrite1hInputTokens: 1000,
              estimatedCostUsd: 0.4231,
            },
            's1',
          ),
        ]}
        steps={STEPS}
      />,
    );

    const region = section();
    expect(within(region).getByRole('heading', { level: 2, name: 'Gasto de tokens' })).toHaveClass(
      'mission-section-title',
    );
    expect(within(region).getByText('12.345')).toHaveClass('token-usage__figure');
    expect(textOf(region)).toBe(
      [
        'Gasto de tokens',
        '12.345 tokens novos',
        'Entrada nova: 10.000 · Saída: 2.345',
        'Cache: 500.000 lidos · 3.000 escritos',
        'Custo estimado a preço de lista da API: USD 0,42 (não é fatura).',
        'Tokens novos são a entrada nova mais a saída; o cache entra à parte. Só o Claude Code informa o gasto por enquanto.',
      ].join(''),
    );
  });

  it('sem custo (modelo sem preço), diz que o custo estimado está indisponível e não mostra zero', () => {
    render(
      <TokenUsage
        executions={[
          executionOf('e1', { inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.1 }, 's1'),
          executionOf('e2', { inputTokens: 5, outputTokens: 1 }, 's1'),
        ]}
        steps={STEPS}
      />,
    );

    const region = section();
    expect(textOf(region)).toContain(
      'Custo estimado indisponível: algum modelo usado ainda não tem preço.',
    );
    expect(textOf(region)).not.toContain('USD');
    expect(textOf(region)).not.toContain('0,00');
    expect(within(region).getByText('126')).toBeInTheDocument();
  });

  it('um uso antigo, sem os campos de cache, não mostra a linha de cache', () => {
    render(
      <TokenUsage
        executions={[executionOf('e1', { inputTokens: 100, outputTokens: 20 }, 's1')]}
        steps={STEPS}
      />,
    );

    expect(textOf(section())).not.toContain('Cache:');
  });

  it('só leitura de cache mostra só os lidos', () => {
    render(
      <TokenUsage
        executions={[
          executionOf(
            'e1',
            { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 4000, estimatedCostUsd: 0 },
            's1',
          ),
        ]}
        steps={STEPS}
      />,
    );

    expect(textOf(section())).toContain('Cache: 4.000 lidos');
    expect(textOf(section())).not.toContain('escritos');
  });

  it('um custo abaixo de um centavo diz isso em vez de mostrar zero', () => {
    render(
      <TokenUsage
        executions={[
          executionOf('e1', { inputTokens: 3, outputTokens: 1, estimatedCostUsd: 0.002 }, 's1'),
        ]}
        steps={STEPS}
      />,
    );

    expect(textOf(section())).toContain(
      'Custo estimado a preço de lista da API: menos de USD 0,01 (não é fatura).',
    );
  });

  it('um token só usa o singular', () => {
    render(
      <TokenUsage
        executions={[executionOf('e1', { inputTokens: 1, outputTokens: 0 }, 's1')]}
        steps={STEPS}
      />,
    );

    expect(textOf(section())).toContain('1 token novo');
    expect(textOf(section())).not.toContain('1 tokens');
  });

  it('com uma tarefa só, não lista o gasto por tarefa', () => {
    render(
      <TokenUsage
        executions={[executionOf('e1', { inputTokens: 100, outputTokens: 20 }, 's1')]}
        steps={STEPS}
      />,
    );

    expect(screen.queryByRole('list')).toBeNull();
  });

  it('com mais de uma tarefa, lista uma linha por tarefa na ordem do plano, com as tentativas somadas', () => {
    render(
      <TokenUsage
        executions={[
          executionOf('e3', { inputTokens: 40, outputTokens: 2, estimatedCostUsd: 0.2 }, 's2'),
          executionOf('e1', { inputTokens: 10, outputTokens: 1, estimatedCostUsd: 0.1 }, 's1'),
          executionOf('e2', { inputTokens: 20, outputTokens: 4, estimatedCostUsd: 0.3 }, 's1'),
        ]}
        steps={STEPS}
      />,
    );

    const list = screen.getByRole('list', { name: 'Gasto por tarefa' });
    expect(within(list).getAllByRole('listitem').map(textOf)).toEqual([
      '1. Implementar 35 tokens novos · USD 0,40',
      '2. Testar 42 tokens novos · USD 0,20',
    ]);
  });

  it('a tentativa sem tarefa aparece como "Missão inteira", e linha sem custo diz "custo indisponível"', () => {
    render(
      <TokenUsage
        executions={[
          executionOf('e1', { inputTokens: 7, outputTokens: 3 }),
          executionOf('e2', { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.05 }, 's1'),
        ]}
        steps={STEPS}
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Gasto por tarefa' })).getAllByRole(
      'listitem',
    );
    expect(items.map(textOf)).toEqual([
      'Missão inteira 10 tokens novos · custo indisponível',
      '1. Implementar 2 tokens novos · USD 0,05',
    ]);
  });

  it('o título da tarefa entra como texto, nunca como HTML', () => {
    const { container } = render(
      <TokenUsage
        executions={[
          executionOf('e1', { inputTokens: 1, outputTokens: 1 }, 's1'),
          executionOf('e2', { inputTokens: 1, outputTokens: 1 }, 's2'),
        ]}
        steps={[stepOf('s1', 1, '<img src=x onerror=alert(1)>'), stepOf('s2', 2, 'Testar')]}
      />,
    );

    expect(screen.getByText('1. <img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
