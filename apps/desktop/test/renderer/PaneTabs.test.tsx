import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PaneTabs } from '../../src/renderer/workspace/PaneTabs';

const leaf = (
  id: string,
  provider: 'claude' | 'codex' | 'shell',
  terminalId: string | null = null,
) => ({ type: 'leaf', id, provider, terminalId }) as const;

const providers: ProviderInfo[] = [
  { id: 'claude', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: false, reason: 'Codex não está instalado.' },
  { id: 'shell', label: 'PowerShell', available: true },
];

const terminal = (id: string, provider: 'claude' | 'codex' | 'shell'): TerminalSummary => ({
  id,
  kind: provider === 'shell' ? 'shell' : 'agent',
  title: provider,
  projectId: 'p1',
  projectName: 'app',
  state: 'running',
  provider,
  origin: 'new',
});

function setup(
  leaves: Parameters<typeof PaneTabs>[0]['leaves'],
  terminals: readonly TerminalSummary[] = [],
) {
  const onSelect = vi.fn();
  const onGrid = vi.fn();
  render(
    <PaneTabs
      leaves={leaves}
      activeId={leaves[0]?.id ?? ''}
      terminals={terminals}
      providers={providers}
      onSelect={onSelect}
      onGrid={onGrid}
    />,
  );
  return { onSelect, onGrid };
}

/** Os rótulos de cada aba, na ordem da faixa (sem o número de posição). */
function rotulos(): (string | null)[] {
  return screen
    .getAllByRole('tab')
    .map((tab) => tab.querySelector('.pane-tabs__label')?.textContent ?? null);
}

/** Os números de posição de cada aba, na ordem da faixa. */
function numeros(): (string | null)[] {
  return screen
    .getAllByRole('tab')
    .map((tab) => tab.querySelector('.pane-tabs__number')?.textContent ?? null);
}

describe('PaneTabs: rótulos repetidos', () => {
  it('dois painéis Claude e um shell: os Claude ganham número de ordem, o shell fica como está', () => {
    setup([leaf('a', 'claude'), leaf('b', 'shell'), leaf('c', 'claude')]);

    expect(rotulos()).toEqual(['Claude Code 1', 'PowerShell', 'Claude Code 2']);
    expect(numeros()).toEqual(['1', '2', '3']);
    expect(screen.getByRole('tab', { name: /Claude Code 2/ })).toBeInTheDocument();
  });

  it('o nome acessível da aba é só o rótulo, sem o número de posição', () => {
    setup([leaf('a', 'claude'), leaf('b', 'shell'), leaf('c', 'claude')]);

    expect(screen.getByRole('tab', { name: 'Claude Code 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PowerShell' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Claude Code 2' })).toBeInTheDocument();
  });

  it('com um só painel de um programa, o rótulo fica como está', () => {
    setup([leaf('a', 'claude'), leaf('b', 'codex'), leaf('c', 'shell')]);

    expect(rotulos()).toEqual(['Claude Code', 'Codex', 'PowerShell']);
    expect(numeros()).toEqual(['1', '2', '3']);
  });

  it('a ordem segue a faixa, não o programa: o primeiro da faixa é o 1', () => {
    setup([leaf('a', 'shell'), leaf('b', 'claude'), leaf('c', 'codex'), leaf('d', 'claude')]);

    expect(rotulos()).toEqual(['PowerShell', 'Claude Code 1', 'Codex', 'Claude Code 2']);
  });

  it('agrupa pelo rótulo mostrado: o programa do terminal ligado conta, como no nome da aba', () => {
    setup([leaf('a', 'claude'), leaf('b', 'shell', 't2')], [terminal('t2', 'claude')]);

    expect(rotulos()).toEqual(['Claude Code 1', 'Claude Code 2']);
  });

  it('os números de ordem aparecem em três ou mais painéis do mesmo programa', () => {
    setup([leaf('a', 'codex'), leaf('b', 'codex'), leaf('c', 'codex')]);

    expect(rotulos()).toEqual(['Codex 1', 'Codex 2', 'Codex 3']);
  });

  it('clicar numa aba com número de ordem seleciona o painel dela', async () => {
    const { onSelect } = setup([leaf('a', 'claude'), leaf('b', 'shell'), leaf('c', 'claude')]);

    await userEvent.click(screen.getByRole('tab', { name: /Claude Code 2/ }));

    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('os rótulos numerados ficam dentro do tablist', () => {
    setup([leaf('a', 'claude'), leaf('b', 'claude')]);

    const tabs = within(screen.getByRole('tablist', { name: 'Painéis abertos' })).getAllByRole(
      'tab',
    );
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent('Claude Code 1');
    expect(tabs[1]).toHaveTextContent('Claude Code 2');
  });
});
