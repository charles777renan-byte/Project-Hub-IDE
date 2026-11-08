import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MenuAcoes } from '../../src/renderer/components/MenuAcoes';

describe('MenuAcoes', () => {
  it('com ícone, o gatilho mostra o ícone e usa o rótulo só como nome acessível', async () => {
    const user = userEvent.setup();
    render(
      <MenuAcoes
        rotulo="Mais ações do painel"
        icone={<svg data-testid="icone" aria-hidden="true" />}
        acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]}
      />,
    );
    const gatilho = screen.getByRole('button', { name: 'Mais ações do painel' });
    expect(gatilho).toHaveAttribute('aria-label', 'Mais ações do painel');
    expect(gatilho).toContainElement(screen.getByTestId('icone'));
    expect(gatilho).toHaveTextContent('');
    expect(screen.queryByText('Mais ações do painel')).toBeNull();

    await user.click(gatilho);
    expect(screen.getByRole('menuitem', { name: 'Pausar' })).toBeVisible();
  });

  it('sem ícone, o gatilho segue sendo o texto do rótulo, sem aria-label', () => {
    render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]} />);
    const gatilho = screen.getByRole('button', { name: 'Mais ações' });
    expect(gatilho).toHaveTextContent('Mais ações');
    expect(gatilho).not.toHaveAttribute('aria-label');
  });

  it('abre com o clique e mostra as ações', async () => {
    const user = userEvent.setup();
    render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]} />);

    expect(screen.queryByRole('menuitem', { name: 'Pausar' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));

    expect(screen.getByRole('menuitem', { name: 'Pausar' })).toBeVisible();
  });

  it('chama onSelecionar da ação escolhida e fecha o menu', async () => {
    const user = userEvent.setup();
    const pausar = vi.fn();
    const cancelar = vi.fn();
    render(
      <MenuAcoes
        rotulo="Mais ações"
        acoes={[
          { rotulo: 'Pausar', onSelecionar: pausar },
          { rotulo: 'Cancelar missão', onSelecionar: cancelar },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(screen.getByRole('menuitem', { name: 'Pausar' }));

    expect(pausar).toHaveBeenCalledOnce();
    expect(cancelar).not.toHaveBeenCalled();
    expect(screen.queryByRole('menuitem', { name: 'Pausar' })).toBeNull();
  });

  it('Escape fecha o menu e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]} />);
    const gatilho = screen.getByRole('button', { name: 'Mais ações' });

    await user.click(gatilho);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menuitem', { name: 'Pausar' })).toBeNull();
    expect(gatilho).toHaveFocus();
  });

  it('abre pelo teclado e as setas percorrem as ações', async () => {
    const user = userEvent.setup();
    const cancelar = vi.fn();
    render(
      <MenuAcoes
        rotulo="Mais ações"
        acoes={[
          { rotulo: 'Pausar', onSelecionar: vi.fn() },
          { rotulo: 'Cancelar missão', onSelecionar: cancelar },
        ]}
      />,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Mais ações' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Pausar' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Cancelar missão' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(cancelar).toHaveBeenCalledOnce();
  });

  it('ação perigosa recebe a classe de perigo; a comum não', async () => {
    const user = userEvent.setup();
    render(
      <MenuAcoes
        rotulo="Mais ações"
        acoes={[
          { rotulo: 'Pausar', onSelecionar: vi.fn() },
          { rotulo: 'Excluir missão', onSelecionar: vi.fn(), perigosa: true },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));

    expect(screen.getByRole('menuitem', { name: 'Excluir missão' })).toHaveClass(
      'menu-acoes__item--perigo',
    );
    expect(screen.getByRole('menuitem', { name: 'Pausar' })).not.toHaveClass(
      'menu-acoes__item--perigo',
    );
  });

  it('ação desabilitada aparece, mas não chama onSelecionar', async () => {
    const user = userEvent.setup();
    const pausar = vi.fn();
    render(
      <MenuAcoes
        rotulo="Mais ações"
        acoes={[{ rotulo: 'Pausar', onSelecionar: pausar, desabilitada: true }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    const item = screen.getByRole('menuitem', { name: 'Pausar' });
    // O Radix marca o item desabilitado com aria-disabled, não com o atributo `disabled`.
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await user.click(item);

    expect(pausar).not.toHaveBeenCalled();
  });

  it('abrir o menu não adiciona nenhum <style> ao documento (a CSP bloqueia <style> inline)', async () => {
    const user = userEvent.setup();
    const antes = document.querySelectorAll('style').length;
    render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]} />);

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await screen.findByRole('menuitem', { name: 'Pausar' });

    // O menu modal do Radix monta um <style> para travar a rolagem do fundo; `modal={false}` o evita.
    expect(document.querySelectorAll('style')).toHaveLength(antes);
  });

  it('não trava a página: o conteúdo de fora segue visível aos leitores de tela', async () => {
    const user = userEvent.setup();
    render(
      <>
        <p>Resto da página</p>
        <MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]} />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await screen.findByRole('menuitem', { name: 'Pausar' });

    expect(screen.getByText('Resto da página')).toBeVisible();
    expect(document.body).not.toHaveAttribute('data-scroll-locked');
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  it('aceita dois itens com o mesmo rótulo, sem aviso de chave repetida, e cada um chama a sua ação', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const primeira = vi.fn();
    const segunda = vi.fn();
    render(
      <MenuAcoes
        rotulo="Mais ações"
        acoes={[
          { rotulo: 'index.ts', onSelecionar: primeira },
          { rotulo: 'index.ts', onSelecionar: segunda },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    const itens = screen.getAllByRole('menuitem', { name: 'index.ts' });
    expect(itens).toHaveLength(2);
    await user.click(itens[1] as HTMLElement);

    expect(segunda).toHaveBeenCalledTimes(1);
    expect(primeira).not.toHaveBeenCalled();
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/);
    errors.mockRestore();
  });
});
