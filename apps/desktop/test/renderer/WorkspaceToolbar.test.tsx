import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderInfo } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { LIMIT_HINT, WorkspaceToolbar } from '../../src/renderer/workspace/WorkspaceToolbar';

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

  it('o menu abre com o foco no campo de busca', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    expect(screen.getByRole('searchbox', { name: 'Buscar programa' })).toHaveFocus();
  });

  it('as setas percorrem só os programas disponíveis, com volta pela busca; Home e End vão às pontas', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('searchbox', { name: 'Buscar programa' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveFocus();
  });

  it('Home e End no campo de busca mexem no cursor, não no menu', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('pow{Home}{End}');
    expect(screen.getByRole('searchbox', { name: 'Buscar programa' })).toHaveFocus();
  });

  it('digitar com um item focado leva a tecla ao campo de busca', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('{ArrowDown}p');
    const search = screen.getByRole('searchbox', { name: 'Buscar programa' });
    expect(search).toHaveFocus();
    expect(search).toHaveValue('p');
  });

  it('a busca filtra os programas pelo nome, sem diferenciar maiúsculas nem acentos', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('POWER');
    expect(itemNames()).toEqual(['PowerShell']);
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Buscar programa' }));
    await userEvent.keyboard('cõdex');
    expect(itemNames()).toEqual(['Codex']);
  });

  it('sem resultado, o menu diz que nenhum programa foi encontrado', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('zzz');
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum programa encontrado');
  });

  it('Enter na busca abre o primeiro programa disponível que sobrou', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith('claude');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('pow{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith('shell');
  });

  it('Enter na busca não abre programa que não está instalado', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('codex{Enter}');
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('só o item marcado mostra a descrição, e a marca acompanha o mouse', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    // Sem o mouse em nenhum item, o primeiro disponível é o marcado.
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveTextContent(
      'Agente de código da Anthropic',
    );
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).not.toHaveTextContent(
      'Terminal do sistema',
    );
    await userEvent.hover(screen.getByRole('menuitem', { name: /PowerShell/ }));
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveTextContent(
      'Terminal do sistema',
    );
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).not.toHaveTextContent(
      'Agente de código da Anthropic',
    );
    expect(document.querySelectorAll('[data-marked="true"]')).toHaveLength(1);
  });

  it('o mouse sobre outro item leva o foco do teclado para ele: um item só fica selecionado', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveFocus();
    await userEvent.hover(screen.getByRole('menuitem', { name: /PowerShell/ }));
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveFocus();
    expect(document.querySelectorAll('[data-marked="true"]')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toHaveAttribute(
      'data-marked',
      'false',
    );
  });

  it('o mouse não rouba o foco da busca: dá para digitar com o ponteiro sobre a lista', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.hover(screen.getByRole('menuitem', { name: /PowerShell/ }));
    expect(screen.getByRole('searchbox', { name: 'Buscar programa' })).toHaveFocus();
    await userEvent.keyboard('cl');
    expect(screen.getByRole('searchbox', { name: 'Buscar programa' })).toHaveValue('cl');
  });

  it('a marca acompanha o foco do teclado', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveAttribute(
      'data-marked',
      'true',
    );
  });

  it('as linhas não trazem etiqueta de empresa ou tipo', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    expect(document.querySelector('.workspace__menu-badge')).toBeNull();
  });

  it('cada linha traz o atalho (Ctrl+Alt+posição no menu) e o anuncia por aria-keyshortcuts', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    const claude = screen.getByRole('menuitem', { name: /Claude Code/ });
    const shell = screen.getByRole('menuitem', { name: /PowerShell/ });
    expect(claude).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+1');
    expect(shell).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+3');
    const kbd = shell.querySelector('kbd.workspace__menu-kbd');
    expect(kbd).toHaveTextContent('Ctrl+Alt+3');
    // O leitor de tela já tem o aria-keyshortcuts: a tecla visual não entra no nome do item.
    expect(kbd).toHaveAttribute('aria-hidden', 'true');
  });

  it('o atalho fica na linha do nome, para a descrição ter a largura toda da linha', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    const shell = screen.getByRole('menuitem', { name: /PowerShell/ });
    const head = shell.querySelector('.workspace__menu-head');
    expect(head).toContainElement(shell.querySelector('.workspace__menu-name') as HTMLElement);
    expect(head).toContainElement(shell.querySelector('kbd.workspace__menu-kbd') as HTMLElement);
    expect(head).not.toContainElement(shell.querySelector('small'));
  });

  it('o atalho segue a posição no menu, mesmo com a lista filtrada', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('pow');
    expect(screen.getByRole('menuitem', { name: /PowerShell/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Alt+3',
    );
  });

  it('um separador divide o PowerShell dos agentes', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    const separators = screen.getAllByRole('separator');
    expect(separators).toHaveLength(1);
    expect(separators[0]?.nextElementSibling).toContainElement(
      screen.getByRole('menuitem', { name: /PowerShell/ }),
    );
  });

  it('com uma lista de um item só, não sobra separador solto', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
    await userEvent.keyboard('pow');
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('reabrir o menu limpa a busca', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Abrir terminal' });
    await userEvent.click(trigger);
    await userEvent.keyboard('pow{Escape}');
    await userEvent.click(trigger);
    expect(screen.getByRole('searchbox', { name: 'Buscar programa' })).toHaveValue('');
    expect(itemNames()).toEqual(['Claude Code', 'Codex', 'PowerShell']);
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
    rerender(<WorkspaceToolbar providers={providers} busy={false} limitReached onOpen={onOpen} />);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeDisabled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
