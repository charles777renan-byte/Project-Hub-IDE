import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderInfo } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  LIMIT_HINT,
  WorkspaceToolbar,
} from '../../src/renderer/workspace/WorkspaceToolbar';

const providers: ProviderInfo[] = [
  { id: 'claude', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: false, reason: 'Codex não está instalado.' },
  { id: 'shell', label: 'PowerShell', available: true },
];

function setup(props: Partial<Parameters<typeof WorkspaceToolbar>[0]> = {}) {
  const onOpen = vi.fn();
  const view = render(
    <WorkspaceToolbar providers={providers} busy={false} onOpen={onOpen} {...props} />,
  );
  return { onOpen, ...view };
}

/** Nome de cada item do menu, sem a descrição que vem junto (só o rótulo do programa). */
function itemNames(): string[] {
  return screen
    .getAllByRole('menuitem')
    .map((item) => item.querySelector('.workspace__menu-name')?.textContent ?? '');
}

describe('WorkspaceToolbar', () => {
  it('a barra traz um botão "Abrir terminal" que abre um menu, e o menu começa fechado', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Abrir terminal' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('o menu lista os provedores na ordem recebida', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    expect(screen.getByRole('menu', { name: 'Abrir terminal' })).toBeInTheDocument();
    expect(itemNames()).toEqual(['Claude Code', 'Codex', 'PowerShell']);
  });

  it('escolher um programa disponível fecha o menu e chama onOpen com o id', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /PowerShell/ }));
    expect(onOpen).toHaveBeenCalledWith('shell');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('programa indisponível aparece como não instalado e não abre nada', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    const codex = screen.getByRole('menuitem', { name: /Codex/ });
    expect(codex).toHaveAttribute('aria-disabled', 'true');
    expect(codex).toHaveTextContent('Não instalado');
    await userEvent.click(codex);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('as setas percorrem só os programas disponíveis, com volta; Home e End vão às pontas', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveFocus();
  });

  it('Esc fecha o menu e devolve o foco ao botão', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Abrir terminal' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('clicar fora do menu o fecha', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ocupado desabilita o botão', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeDisabled();
  });

  it('com o limite de painéis, o botão fica desabilitado e a dica traz o limite', async () => {
    setup({ limitReached: true });
    const trigger = screen.getByRole('button', { name: 'Abrir terminal' });
    expect(trigger).toBeDisabled();
    await userEvent.hover(trigger.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(LIMIT_HINT);
  });

  it('com o motivo de indisponível, o botão fica desabilitado e a dica traz o motivo', async () => {
    setup({ unavailableReason: 'A pasta do projeto não está disponível.' });
    const trigger = screen.getByRole('button', { name: 'Abrir terminal' });
    expect(trigger).toBeDisabled();
    expect(trigger.parentElement).toHaveClass('workspace__open-wrap');
    await userEvent.hover(trigger.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'A pasta do projeto não está disponível.',
    );
  });

  it('sem o motivo de indisponível, o botão segue habilitado e sem a dica', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Abrir terminal' });
    expect(trigger).toBeEnabled();
    expect(trigger.parentElement).not.toHaveClass('workspace__open-wrap');
  });

  it('um focusToken novo leva o foco ao botão', async () => {
    const { rerender } = setup();
    rerender(
      <WorkspaceToolbar providers={providers} busy={false} onOpen={vi.fn()} focusToken={1} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Abrir terminal' })).toHaveFocus(),
    );
  });

  it('o wrapper do botão bloqueado tem papel de grupo e nome com o motivo da dica', () => {
    setup({ limitReached: true });
    const group = screen.getByRole('group', { name: LIMIT_HINT });
    expect(group).toHaveAttribute('tabindex', '0');
    expect(group).toContainElement(screen.getByRole('button', { name: 'Abrir terminal' }));
  });

  it('com o motivo de indisponível, o wrapper também é um grupo nomeado por esse motivo', () => {
    setup({ unavailableReason: 'A pasta do projeto não está disponível.' });
    expect(
      screen.getByRole('group', { name: 'A pasta do projeto não está disponível.' }),
    ).toContainElement(screen.getByRole('button', { name: 'Abrir terminal' }));
  });

  it('um bloqueio que chega com o menu aberto fecha o menu e impede a escolha', async () => {
    const { onOpen, rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    rerender(
      <WorkspaceToolbar providers={providers} busy={false} limitReached onOpen={onOpen} />,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeDisabled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
