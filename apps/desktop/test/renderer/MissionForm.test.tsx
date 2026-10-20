import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MissionForm } from '../../src/renderer/components/MissionForm';

describe('MissionForm', () => {
  it('exige ao menos um critério e não chama a API sem ele', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} />);

    await userEvent.type(screen.getByLabelText('Título'), 'Ajustar login');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(screen.getByText('Informe ao menos um critério de aceite')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('linhas em branco não contam como critério', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} />);

    await userEvent.type(screen.getByLabelText('Título'), 'Ajustar login');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await userEvent.type(screen.getByLabelText('Critérios de aceite'), '   {enter}{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(screen.getByText('Informe ao menos um critério de aceite')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('título e objetivo vazios também impedem o envio, com a mensagem de cada campo', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(screen.getByText('Informe o título da missão.')).toBeInTheDocument();
    expect(screen.getByText('Informe o objetivo da missão.')).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true');
    expect(submit).not.toHaveBeenCalled();
  });

  it('envia os valores aparados, com um critério por linha não vazia e as opções marcadas', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} />);

    await userEvent.type(screen.getByLabelText('Título'), '  Ajustar login  ');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await userEvent.type(
      screen.getByLabelText('Critérios de aceite'),
      'Login funciona{enter}  {enter}Testes passam',
    );
    await userEvent.click(screen.getByLabelText('Esta missão altera código'));
    await userEvent.click(screen.getByLabelText('Somente planejar'));
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(submit).toHaveBeenCalledWith({
      title: 'Ajustar login',
      objective: 'Corrigir o login',
      acceptanceCriteria: ['Login funciona', 'Testes passam'],
      altersCode: true,
      planOnly: true,
    });
  });

  it('as opções começam desmarcadas', () => {
    render(<MissionForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Esta missão altera código')).not.toBeChecked();
    expect(screen.getByLabelText('Somente planejar')).not.toBeChecked();
  });
});
