import { render, screen } from '@testing-library/react';
import type { MissionEventDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { TerminalPanel } from '../../src/renderer/components/workspace/TerminalPanel';
import { stripAnsi, terminalEntries } from '../../src/renderer/mission-text';

function event(overrides: Partial<MissionEventDto>): MissionEventDto {
  return {
    id: 'ev',
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'tool.requested',
    severity: 'info',
    actor: 'agent',
    payload: {},
    sequence: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

function requested(id: string, sequence: number, input: Record<string, unknown>, name = 'bash') {
  return event({
    id: `req-${id}`,
    sequence,
    eventType: 'tool.requested',
    payload: { call: { callId: id, name, input } },
  });
}

function completed(id: string, sequence: number, result: unknown) {
  return event({
    id: `done-${id}`,
    sequence,
    eventType: 'tool.completed',
    payload: { callId: id, result },
  });
}

describe('TerminalPanel', () => {
  it('mostra o comando pedido e a saída', () => {
    render(
      <TerminalPanel
        events={[
          requested('c1', 1, { command: 'pnpm test' }),
          completed('c1', 2, { ok: true, output: '3 testes passaram' }),
        ]}
      />,
    );
    expect(screen.getByText('$ pnpm test')).toBeInTheDocument();
    expect(screen.getByText('3 testes passaram')).toBeInTheDocument();
  });

  it('sem eventos de comando mostra o estado vazio', () => {
    render(<TerminalPanel events={[event({ id: 'x', eventType: 'session.started' })]} />);
    expect(screen.getByText('O agente ainda não executou comandos.')).toBeInTheDocument();
  });

  it('mostra a saída com ANSI sem os códigos e como texto', () => {
    render(
      <TerminalPanel
        events={[
          requested('c1', 1, { command: 'ls' }),
          completed('c1', 2, { ok: true, output: '\u001b[32mverde\u001b[0m <b>negrito</b>' }),
        ]}
      />,
    );
    expect(screen.getByText('verde <b>negrito</b>')).toBeInTheDocument();
    expect(document.body.querySelector('b')).toBeNull();
  });

  it('deixa o mais recente no fim e mostra a falha da ferramenta', () => {
    render(
      <TerminalPanel
        events={[
          requested('c2', 3, { command: 'segundo' }),
          requested('c1', 1, { command: 'primeiro' }),
          completed('c1', 2, { ok: true }),
          completed('c2', 4, { ok: false, error: { code: 'X', message: 'deu ruim' } }),
        ]}
      />,
    );
    const commands = screen.getAllByText(/^\$ /).map((node) => node.textContent);
    expect(commands).toEqual(['$ primeiro', '$ segundo']);
    expect(screen.getByText('deu ruim')).toBeInTheDocument();
  });

  it('sem campo de comando usa o nome da ferramenta e o primeiro argumento de texto', () => {
    render(
      <TerminalPanel events={[requested('c1', 1, { relativePath: 'src/a.ts' }, 'create-file')]} />,
    );
    expect(screen.getByText('$ create-file src/a.ts')).toBeInTheDocument();
  });
});

describe('terminalEntries e stripAnsi', () => {
  it('stripAnsi remove cores e movimentos de cursor', () => {
    expect(stripAnsi('\u001b[1;31merro\u001b[0m\u001b[2K ok')).toBe('erro ok');
  });

  it('liga o pedido e a conclusão pelo callId e ignora conclusão sem pedido', () => {
    const entries = terminalEntries([
      completed('orfa', 1, { ok: true, output: 'x' }),
      requested('c1', 2, { command: 'ls' }),
      completed('c1', 3, { ok: true, output: 'a' }),
    ]);
    expect(entries).toEqual([{ id: 'c1', command: 'ls', output: 'a', failed: false }]);
  });
});
