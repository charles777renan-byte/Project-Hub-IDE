import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  PaletaComandos,
  type ItemComando,
} from '../../src/renderer/components/PaletaComandos';

const ITENS: ItemComando[] = [
  { id: 'projeto:p1', rotulo: 'TESTE', grupo: 'Projetos', executar: () => {} },
  { id: 'acao:nova', rotulo: 'Nova missão', grupo: 'Ações', executar: () => {} },
];

describe('PaletaComandos', () => {
  it('filtra os itens pelo que a pessoa digita', async () => {
    const user = userEvent.setup();
    render(<PaletaComandos aberta itens={ITENS} aoFechar={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'teste');
    expect(screen.getByRole('option', { name: 'TESTE' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Nova missão' })).toBeNull();
  });

  it('Enter executa o item selecionado e fecha', async () => {
    const user = userEvent.setup();
    const executar = vi.fn();
    const aoFechar = vi.fn();
    render(
      <PaletaComandos
        aberta
        itens={[{ id: 'p1', rotulo: 'TESTE', grupo: 'Projetos', executar }]}
        aoFechar={aoFechar}
      />,
    );
    await user.type(screen.getByRole('combobox'), 'TESTE{Enter}');
    expect(executar).toHaveBeenCalledOnce();
    expect(aoFechar).toHaveBeenCalledOnce();
  });

  it('Escape fecha sem executar nada', async () => {
    const user = userEvent.setup();
    const executar = vi.fn();
    const aoFechar = vi.fn();
    render(
      <PaletaComandos
        aberta
        itens={[{ id: 'p1', rotulo: 'TESTE', grupo: 'Projetos', executar }]}
        aoFechar={aoFechar}
      />,
    );
    await user.keyboard('{Escape}');
    expect(executar).not.toHaveBeenCalled();
    expect(aoFechar).toHaveBeenCalledOnce();
  });

  it('fechada, não mostra a busca nem os itens', () => {
    render(<PaletaComandos aberta={false} itens={ITENS} aoFechar={() => {}} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('abre com o foco na busca e, ao fechar, devolve o foco a quem o tinha', async () => {
    const user = userEvent.setup();
    function Tela() {
      const [aberta, setAberta] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setAberta(true)}>
            Abrir
          </button>
          <PaletaComandos aberta={aberta} itens={ITENS} aoFechar={() => setAberta(false)} />
        </>
      );
    }
    render(<Tela />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus();
  });
});
