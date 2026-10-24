import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderInfo } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceToolbar } from '../../src/renderer/workspace/WorkspaceToolbar';

const providers: ProviderInfo[] = [
  { id: 'claude', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: false, reason: 'Codex não está instalado.' },
  { id: 'shell', label: 'PowerShell', available: true },
];

function setup(busy = false) {
  const onOpen = vi.fn();
  render(<WorkspaceToolbar providers={providers} busy={busy} onOpen={onOpen} />);
  return { onOpen };
}

describe('WorkspaceToolbar', () => {
  it('é uma barra de ferramentas com um botão por provedor, na ordem recebida', () => {
    setup();
    const bar = screen.getByRole('toolbar', { name: 'Abrir terminal' });
    const buttons = Array.from(bar.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual(['Claude Code', 'Codex', 'PowerShell']);
    for (const b of bar.querySelectorAll('button')) expect(b).toHaveAttribute('type', 'button');
  });

  it('clicar chama onOpen com o id do provedor', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'PowerShell' }));
    expect(onOpen).toHaveBeenCalledWith('shell');
  });

  it('provedor indisponível fica desabilitado e a dica traz o motivo', async () => {
    const { onOpen } = setup();
    const codex = screen.getByRole('button', { name: 'Codex' });
    expect(codex).toBeDisabled();
    await userEvent.hover(codex.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Codex não está instalado.');
    await userEvent.click(codex);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('setas, Home e End movem o foco entre os botões habilitados', async () => {
    setup();
    screen.getByRole('button', { name: 'Claude Code' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'PowerShell' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'PowerShell' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Claude Code' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'PowerShell' })).toHaveFocus();
  });

  it('ocupado desabilita todos os botões', () => {
    setup(true);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});
