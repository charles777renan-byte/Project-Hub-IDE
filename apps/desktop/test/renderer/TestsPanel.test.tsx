import { render, screen } from '@testing-library/react';
import type { MissionEventDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { TestsPanel } from '../../src/renderer/components/workspace/TestsPanel';
import {
  describeEvent,
  verificationEntries,
  verifiedCriteria,
} from '../../src/renderer/mission-text';

function verification(
  id: string,
  sequence: number,
  payload: Record<string, unknown>,
): MissionEventDto {
  return {
    id,
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'verification.completed',
    severity: 'info',
    actor: 'agent',
    payload: { type: 'verification.completed', ...payload },
    sequence,
    createdAt: '2026-10-20T09:00:00.000Z',
  };
}

describe('TestsPanel', () => {
  it('mostra o total passou/total e o tempo', () => {
    render(
      <TestsPanel
        events={[
          verification('v1', 1, {
            command: 'pnpm test',
            passed: 14,
            failed: 0,
            durationMs: 2300,
          }),
        ]}
      />,
    );

    expect(screen.getByText('pnpm test')).toBeInTheDocument();
    expect(screen.getByText('14/14')).toBeInTheDocument();
    expect(screen.getByText('2,3 s')).toBeInTheDocument();
  });

  it('falha aparece em vermelho, com a saída como texto', () => {
    render(
      <TestsPanel
        events={[
          verification('v1', 1, {
            command: 'pnpm test',
            passed: 12,
            failed: 2,
            durationMs: 450,
            output: 'FAIL <b>soma</b>\n  esperado 3',
          }),
        ]}
      />,
    );

    const total = screen.getByText('12/14');
    expect(total).toHaveClass('tests-run__total--failed');
    expect(screen.getByText('450 ms')).toBeInTheDocument();
    const output = screen.getByText(/FAIL <b>soma<\/b>/);
    expect(output).toHaveClass('tests-run__output--failed');
    expect(output.querySelector('b')).toBeNull();
  });

  it('verificação que passou também mostra a saída, sem o vermelho', () => {
    render(
      <TestsPanel
        events={[
          verification('v1', 1, {
            command: 'pnpm lint',
            passed: 1,
            failed: 0,
            durationMs: 900,
            output: 'sem problemas',
          }),
        ]}
      />,
    );

    expect(screen.getByText('1/1')).not.toHaveClass('tests-run__total--failed');
    expect(screen.getByText('sem problemas')).not.toHaveClass('tests-run__output--failed');
  });

  it('mostra "Nenhum teste rodou" sem a cor de sucesso numa verificação vazia', () => {
    render(
      <TestsPanel
        events={[
          verification('v1', 1, { command: 'pnpm test', passed: 0, failed: 0, durationMs: 800 }),
        ]}
      />,
    );

    const total = screen.getByText('Nenhum teste rodou');
    expect(total).not.toHaveClass('tests-run__total--failed');
    expect(total).toHaveClass('tests-run__total--empty');
    expect(screen.queryByText('0/0')).toBeNull();
  });

  it('sem verificação, diz que nenhum comando foi executado', () => {
    render(<TestsPanel events={[]} />);

    expect(screen.getByText('Nenhum comando de verificação foi executado')).toBeInTheDocument();
  });

  it('ignora eventos que não são de verificação e payload malformado', () => {
    render(
      <TestsPanel
        events={[
          { ...verification('x', 1, {}), eventType: 'message.delta' },
          verification('y', 2, { command: 'pnpm test', passed: 'muitos' }),
        ]}
      />,
    );

    expect(screen.getByText('Nenhum comando de verificação foi executado')).toBeInTheDocument();
  });

  it('lista as verificações da mais antiga para a mais recente', () => {
    render(
      <TestsPanel
        events={[
          verification('v2', 2, { command: 'pnpm lint', passed: 1, failed: 0, durationMs: 10 }),
          verification('v1', 1, { command: 'pnpm test', passed: 3, failed: 0, durationMs: 10 }),
        ]}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('pnpm test');
    expect(items[1]).toHaveTextContent('pnpm lint');
  });
});

describe('verificações na linha do tempo e nos critérios', () => {
  it('describeEvent descreve a verificação com o total e o tempo', () => {
    expect(
      describeEvent(
        verification('v1', 1, { command: 'pnpm test', passed: 14, failed: 0, durationMs: 2300 }),
      ),
    ).toBe('Verificação concluída: pnpm test, 14/14 testes passaram em 2,3 s.');
  });

  it('describeEvent destaca a falha', () => {
    expect(
      describeEvent(
        verification('v1', 1, { command: 'pnpm test', passed: 12, failed: 2, durationMs: 450 }),
      ),
    ).toBe('Verificação falhou: pnpm test, 2 de 14 testes falharam em 450 ms.');
  });

  it('a linha do tempo diz que nenhum teste rodou numa verificação vazia', () => {
    expect(
      describeEvent(
        verification('v1', 1, { command: 'pnpm test', passed: 0, failed: 0, durationMs: 1200 }),
      ),
    ).toBe('Verificação sem testes: pnpm test, nenhum teste rodou em 1,2 s.');
  });

  it('describeEvent tem frase mesmo com o payload incompleto', () => {
    expect(describeEvent(verification('v1', 1, {}))).toBe('Verificação concluída.');
  });

  it('verificationEntries lê o evento e descarta o malformado', () => {
    const entries = verificationEntries([
      verification('v1', 1, {
        command: 'pnpm test',
        passed: 3,
        failed: 1,
        durationMs: 5,
        output: 'x',
        criteria: ['A', 7],
      }),
      verification('v2', 2, { passed: 1, failed: 0, durationMs: 1 }),
    ]);

    expect(entries).toEqual([
      {
        id: 'v1',
        command: 'pnpm test',
        passed: 3,
        failed: 1,
        durationMs: 5,
        output: 'x',
        criteria: ['A'],
      },
    ]);
  });

  it('verifiedCriteria devolve só os critérios associados a verificações que passaram', () => {
    const verified = verifiedCriteria([
      verification('v1', 1, {
        command: 'pnpm test',
        passed: 3,
        failed: 0,
        durationMs: 5,
        criteria: ['Critério A'],
      }),
      verification('v2', 2, {
        command: 'pnpm lint',
        passed: 2,
        failed: 1,
        durationMs: 5,
        criteria: ['Critério B'],
      }),
      verification('v3', 3, { command: 'pnpm build', passed: 1, failed: 0, durationMs: 5 }),
    ]);

    expect([...verified]).toEqual(['Critério A']);
  });

  it('verificação sem testes (0/0) não marca critério', () => {
    const verified = verifiedCriteria([
      verification('v1', 1, {
        command: 'pnpm test',
        passed: 0,
        failed: 0,
        durationMs: 5,
        criteria: ['Critério A'],
      }),
    ]);

    expect(verified.size).toBe(0);
  });
});
