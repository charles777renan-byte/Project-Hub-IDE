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
  it('mostra a saudação da hora local e a data por extenso', () => {
    render(<Greeting now={new Date(2026, 9, 24, 15, 30)} />);

    expect(screen.getByText('Boa tarde')).toBeInTheDocument();
    expect(screen.getByText('sábado · 24 de outubro · 15:30')).toBeInTheDocument();
  });

  it('mantém o título "Início" para a leitura de tela', () => {
    render(<Greeting now={new Date(2026, 9, 24, 8, 0)} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
  });

  it('sem o preload, a saudação sai sem nome e o botão de definir o nome segue', async () => {
    render(<Greeting now={new Date(2026, 9, 24, 15, 30)} />);

    expect(screen.getByText('Boa tarde')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Dizer seu nome' })).toBeInTheDocument();
  });
});

describe('Greeting com o nome do perfil local', () => {
  const now = new Date(2026, 9, 24, 15, 30);

  it('sem nome gravado, mostra o botão Dizer seu nome', async () => {
    givePreload(null);
    render(<Greeting now={now} />);

    expect(await screen.findByRole('button', { name: 'Dizer seu nome' })).toBeInTheDocument();
    expect(screen.getByText('Boa tarde')).toBeInTheDocument();
  });

  it('com nome gravado, a saudação leva o nome', async () => {
    givePreload('Ana');
    render(<Greeting now={now} />);

    expect(await screen.findByText('Boa tarde, Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alterar nome' })).toBeInTheDocument();
  });

  it('salva o nome, mostra a saudação nova e fecha o campo', async () => {
    const user = userEvent.setup();
    const { setDisplayName } = givePreload(
      null,
      vi.fn(() => Promise.resolve({ ok: true })),
    );
    render(<Greeting now={now} />);

    await user.click(await screen.findByRole('button', { name: 'Dizer seu nome' }));
    await user.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Bia');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(setDisplayName).toHaveBeenCalledWith('Bia');
    expect(await screen.findByText('Boa tarde, Bia')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Seu nome' })).not.toBeInTheDocument();
  });

  it('mostra a mensagem do processo principal e segue com o campo aberto', async () => {
    const user = userEvent.setup();
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
    render(<Greeting now={now} />);

    await user.click(await screen.findByRole('button', { name: 'Dizer seu nome' }));
    await user.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O nome pode ter até 40 caracteres.',
    );
    expect(screen.getByRole('textbox', { name: 'Seu nome' })).toBeInTheDocument();
  });

  it('falha sem resposta vira a mensagem genérica', async () => {
    const user = userEvent.setup();
    givePreload(
      null,
      vi.fn(() => Promise.reject(new Error('canal fora do ar'))),
    );
    render(<Greeting now={now} />);

    await user.click(await screen.findByRole('button', { name: 'Dizer seu nome' }));
    await user.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o nome.');
  });

  it('Remover nome tira o nome da saudação', async () => {
    const user = userEvent.setup();
    const { setDisplayName } = givePreload(
      'Ana',
      vi.fn(() => Promise.resolve({ ok: true })),
    );
    render(<Greeting now={now} />);

    await user.click(await screen.findByRole('button', { name: 'Alterar nome' }));
    await user.click(screen.getByRole('button', { name: 'Remover nome' }));

    expect(setDisplayName).toHaveBeenCalledWith(null);
    expect(await screen.findByRole('button', { name: 'Dizer seu nome' })).toBeInTheDocument();
    expect(screen.getByText('Boa tarde')).toBeInTheDocument();
  });
});
