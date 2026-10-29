import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaletaComandos, type ItemComando } from '../../src/renderer/components/PaletaComandos';

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

describe('PaletaComandos: grupos, passo e recentes', () => {
  beforeEach(() => window.localStorage.clear());

  const MISSAO: ItemComando = {
    id: 'missao:m1',
    rotulo: 'Login',
    grupo: 'Missões',
    detalhe: 'Missão · app',
    estado: { rotulo: 'Aguarda você', tom: 'warn' },
    atualizadoEm: '2026-10-28T10:00:00.000Z',
    executar: () => {},
  };

  it('com a busca vazia mostra Recentes e Ações, e não a lista inteira de projetos', () => {
    render(
      <PaletaComandos
        aberta
        itens={[
          ...ITENS,
          MISSAO,
          { id: 'projeto:p2', rotulo: 'site', grupo: 'Projetos', executar: () => {} },
        ]}
        aoFechar={() => {}}
      />,
    );
    expect(screen.getByText('Recentes')).toBeInTheDocument();
    expect(screen.getByText('Ações')).toBeInTheDocument();
    expect(screen.queryByText('Projetos')).toBeNull();
    // Sem histórico, os recentes começam pelas missões mexidas por último, depois os projetos.
    const opcoes = screen.getAllByRole('option').map((opcao) => opcao.getAttribute('aria-label'));
    expect(opcoes.slice(0, 3)).toEqual(['Login, Aguarda você', 'TESTE', 'site']);
    expect(opcoes).toContain('Nova missão');
  });

  it('buscando, separa em Projetos, Missões e Ações, destaca o trecho e conta os resultados', async () => {
    const user = userEvent.setup();
    render(<PaletaComandos aberta itens={[...ITENS, MISSAO]} aoFechar={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'est');
    const opcao = screen.getByRole('option', { name: 'TESTE' });
    expect(opcao.querySelector('mark')).toHaveTextContent('EST');
    expect(screen.getByText('Projetos')).toBeInTheDocument();
    expect(screen.getByText('1 resultado')).toBeInTheDocument();
  });

  it('acha a missão pelo projeto e pelo estado, que ficam na segunda linha', async () => {
    const user = userEvent.setup();
    render(<PaletaComandos aberta itens={[...ITENS, MISSAO]} aoFechar={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'aguarda');
    expect(screen.getByRole('option', { name: 'Login, Aguarda você' })).toHaveAccessibleDescription(
      'Missão · app',
    );
  });

  it('"Nova missão…" abre o passo dos projetos; Enter escolhe, e o indisponível não é escolhido', async () => {
    const user = userEvent.setup();
    const emApp = vi.fn();
    const emNotas = vi.fn();
    const aoFechar = vi.fn();
    const passo: ItemComando = {
      id: 'acao:nova-missao',
      rotulo: 'Nova missão…',
      grupo: 'Ações',
      executar: () => {},
      passo: {
        rotulo: 'Nova missão',
        placeholder: 'Em qual projeto?',
        itens: [
          { id: 'passo:p1', rotulo: 'app', grupo: 'Projetos', executar: emApp },
          {
            id: 'passo:p2',
            rotulo: 'notas',
            grupo: 'Projetos',
            detalhe: 'Sem Git',
            indisponivel: 'Sem Git',
            executar: emNotas,
          },
        ],
      },
    };
    render(<PaletaComandos aberta itens={[passo]} aoFechar={aoFechar} />);
    await user.click(screen.getByRole('option', { name: 'Nova missão…' }));

    const busca = screen.getByRole('combobox');
    expect(busca).toHaveAttribute('placeholder', 'Em qual projeto?');
    expect(busca).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Voltar para todos os comandos' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'notas' })).toHaveAttribute('aria-disabled', 'true');
    expect(aoFechar).not.toHaveBeenCalled();

    await user.click(screen.getByRole('option', { name: 'notas' }));
    expect(emNotas).not.toHaveBeenCalled();

    await user.keyboard('{Backspace}');
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'placeholder',
      'Buscar projeto, missão ou ação…',
    );
    await user.click(screen.getByRole('option', { name: 'Nova missão…' }));
    await user.type(screen.getByRole('combobox'), 'app{Enter}');
    expect(emApp).toHaveBeenCalledOnce();
    expect(aoFechar).toHaveBeenCalledOnce();
  });

  it('o que foi escolhido volta primeiro nos Recentes da próxima abertura', async () => {
    const user = userEvent.setup();
    const itens = [...ITENS, MISSAO];
    const { rerender } = render(<PaletaComandos aberta itens={itens} aoFechar={() => {}} />);
    await user.type(screen.getByRole('combobox'), 'TESTE{Enter}');
    rerender(<PaletaComandos aberta={false} itens={itens} aoFechar={() => {}} />);
    rerender(<PaletaComandos aberta itens={itens} aoFechar={() => {}} />);
    const primeira = screen.getAllByRole('option')[0];
    expect(primeira).toHaveAttribute('aria-label', 'TESTE');
  });

  it('sem resultado, diz o que buscou e oferece as ações de começar', async () => {
    const user = userEvent.setup();
    const adicionar = vi.fn();
    render(
      <PaletaComandos
        aberta
        itens={[
          ...ITENS,
          {
            id: 'acao:adicionar-projeto',
            rotulo: 'Adicionar projeto',
            grupo: 'Ações',
            executar: adicionar,
          },
        ]}
        aoFechar={() => {}}
      />,
    );
    await user.type(screen.getByRole('combobox'), 'zzzz');
    expect(screen.getByText('Nada encontrado para “zzzz”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar projeto' }));
    expect(adicionar).toHaveBeenCalledOnce();
  });
});

describe('PaletaComandos: saída animada', () => {
  it('com movimento, fecha depois da saída: fica "leaving" até a animação acabar, e só então some', () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      const { container, rerender } = render(
        <PaletaComandos aberta itens={ITENS} aoFechar={() => {}} />,
      );
      rerender(<PaletaComandos aberta={false} itens={ITENS} aoFechar={() => {}} />);
      const dialog = container.querySelector('dialog');
      expect(dialog).toHaveAttribute('data-motion', 'leaving');
      expect(screen.getByRole('combobox')).toBeInTheDocument();

      act(() => {
        dialog?.dispatchEvent(new Event('animationend'));
      });
      expect(dialog).not.toHaveAttribute('data-motion');
      expect(screen.queryByRole('combobox')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
