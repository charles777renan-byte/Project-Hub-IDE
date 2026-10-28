import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHubApi } from '@project-hub/contracts';
import { dateLabel, Greeting, greetingFor } from '../../src/renderer/components/home/Greeting';

/** Saudação do Início: faixa pela hora local, data por extenso em pt-BR e o nome do perfil local. */

afterEach(() => {
  delete (window as { projectHub?: unknown }).projectHub;
});

/** Liga o preload de teste: `profile.get` devolve o nome dado; `setDisplayName` é o que o teste precisar. */
function givePreload(displayName: string | null, setDisplayName = vi.fn()) {
  const get = vi.fn(() => Promise.resolve({ ok: true, data: { displayName } }));
  window.projectHub = { profile: { get, setDisplayName } } as unknown as ProjectHubApi;
  return { get, setDisplayName };
}

describe('greetingFor', () => {
  it.each([
    [0, 'Boa noite'],
    [4, 'Boa noite'],
    [5, 'Bom dia'],
    [11, 'Bom dia'],
    [12, 'Boa tarde'],
    [17, 'Boa tarde'],
    [18, 'Boa noite'],
    [23, 'Boa noite'],
  ])('às %ih diz "%s"', (hour, expected) => {
    expect(greetingFor(hour)).toBe(expected);
  });
});

describe('dateLabel', () => {
  it('põe zero à esquerda na hora e nos minutos', () => {
    expect(dateLabel(new Date(2026, 9, 25, 9, 5))).toBe('domingo · 25 de outubro · 09:05');
  });
});

describe('Greeting', () => {
  it('mostra a saudação da hora local e a data por extenso numa linha só', () => {
    render(<Greeting now={new Date(2026, 9, 24, 15, 30)} />);

    expect(screen.getByText('Boa tarde')).toBeInTheDocument();
    expect(screen.getByText('sábado · 24 de outubro · 15:30')).toBeInTheDocument();
    expect(screen.getByText('Boa tarde').parentElement).toBe(
      screen.getByText('sábado · 24 de outubro · 15:30').parentElement,
    );
  });

  it('mantém o título "Início" para a leitura de tela', () => {
    render(<Greeting now={new Date(2026, 9, 24, 8, 0)} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
  });

  it('não tem botão de alterar o nome: isso agora vem da paleta', async () => {
    givePreload('Ana');
    render(<Greeting now={new Date(2026, 9, 24, 15, 30)} />);

    expect(await screen.findByText('Boa tarde, Ana')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('sem o preload, a saudação sai sem nome', () => {
    render(<Greeting now={new Date(2026, 9, 24, 15, 30)} />);

    expect(screen.getByText('Boa tarde')).toBeInTheDocument();
  });
});

describe('Greeting com o nome do perfil local', () => {
  const now = new Date(2026, 9, 24, 15, 30);

  it('com nome gravado, a saudação leva o nome', async () => {
    givePreload('Ana');
    render(<Greeting now={now} />);

    expect(await screen.findByText('Boa tarde, Ana')).toBeInTheDocument();
  });

  it('com o pedido de edição, abre o campo com o nome atual', async () => {
    givePreload('Ana');
    render(<Greeting now={now} editRequested />);

    expect(await screen.findByRole('textbox', { name: 'Seu nome' })).toHaveValue('Ana');
    expect(screen.queryByRole('button', { name: 'Alterar nome' })).not.toBeInTheDocument();
  });

  it('sem nome gravado, o campo abre vazio e não oferece Remover nome', async () => {
    givePreload(null);
    render(<Greeting now={now} editRequested />);

    expect(await screen.findByRole('textbox', { name: 'Seu nome' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Remover nome' })).not.toBeInTheDocument();
  });

  it('salva o nome, mostra a saudação nova, fecha o campo e avisa quem pediu', async () => {
    const user = userEvent.setup();
    const onEditClose = vi.fn();
    const { setDisplayName } = givePreload(
      null,
      vi.fn(() => Promise.resolve({ ok: true })),
    );
    render(<Greeting now={now} editRequested onEditClose={onEditClose} />);

    await user.type(await screen.findByRole('textbox', { name: 'Seu nome' }), 'Bia');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(setDisplayName).toHaveBeenCalledWith('Bia');
    expect(await screen.findByText('Boa tarde, Bia')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Seu nome' })).not.toBeInTheDocument();
    expect(onEditClose).toHaveBeenCalledTimes(1);
  });

  it('mostra a mensagem do processo principal e segue com o campo aberto', async () => {
    const user = userEvent.setup();
    const onEditClose = vi.fn();
    givePreload(
      null,
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'O nome pode ter até 40 caracteres.',
            retryable: false,
          },
        }),
      ),
    );
    render(<Greeting now={now} editRequested onEditClose={onEditClose} />);

    await user.type(await screen.findByRole('textbox', { name: 'Seu nome' }), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O nome pode ter até 40 caracteres.',
    );
    expect(screen.getByRole('textbox', { name: 'Seu nome' })).toBeInTheDocument();
    expect(onEditClose).not.toHaveBeenCalled();
  });

  it('falha sem resposta vira a mensagem genérica', async () => {
    const user = userEvent.setup();
    givePreload(
      null,
      vi.fn(() => Promise.reject(new Error('canal fora do ar'))),
    );
    render(<Greeting now={now} editRequested />);

    await user.type(await screen.findByRole('textbox', { name: 'Seu nome' }), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o nome.');
  });

  it('Remover nome tira o nome da saudação e fecha o campo', async () => {
    const user = userEvent.setup();
    const onEditClose = vi.fn();
    const { setDisplayName } = givePreload(
      'Ana',
      vi.fn(() => Promise.resolve({ ok: true })),
    );
    render(<Greeting now={now} editRequested onEditClose={onEditClose} />);

    await user.click(await screen.findByRole('button', { name: 'Remover nome' }));

    expect(setDisplayName).toHaveBeenCalledWith(null);
    expect(await screen.findByText('Boa tarde')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Seu nome' })).not.toBeInTheDocument();
    expect(onEditClose).toHaveBeenCalledTimes(1);
  });

  it('Cancelar fecha o campo e avisa quem pediu', async () => {
    const user = userEvent.setup();
    const onEditClose = vi.fn();
    givePreload('Ana');
    render(<Greeting now={now} editRequested onEditClose={onEditClose} />);

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('textbox', { name: 'Seu nome' })).not.toBeInTheDocument();
    expect(onEditClose).toHaveBeenCalledTimes(1);
  });
});
