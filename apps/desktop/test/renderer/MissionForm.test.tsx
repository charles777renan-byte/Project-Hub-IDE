import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MissionForm } from '../../src/renderer/components/MissionForm';

describe('MissionForm', () => {
  it('exige ao menos um critério e não chama a API sem ele', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} projectHasGit />);

    await userEvent.type(screen.getByLabelText('Título'), 'Ajustar login');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(screen.getByText('Informe ao menos um critério de aceite')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('linhas em branco não contam como critério', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} projectHasGit />);

    await userEvent.type(screen.getByLabelText('Título'), 'Ajustar login');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await userEvent.type(screen.getByLabelText('Critérios de aceite'), '   {enter}{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(screen.getByText('Informe ao menos um critério de aceite')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('título e objetivo vazios também impedem o envio, com a mensagem de cada campo', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} projectHasGit />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(screen.getByText('Informe o título da missão.')).toBeInTheDocument();
    expect(screen.getByText('Informe o objetivo da missão.')).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true');
    expect(submit).not.toHaveBeenCalled();
  });

  it('envia os valores aparados, com um critério por linha não vazia e as opções marcadas', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} projectHasGit />);

    await userEvent.type(screen.getByLabelText('Título'), '  Ajustar login  ');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await userEvent.type(
      screen.getByLabelText('Critérios de aceite'),
      'Login funciona{enter}  {enter}Testes passam',
    );
    await userEvent.click(screen.getByLabelText('Esta missão altera código'));
    await userEvent.click(screen.getByLabelText('Só criar, sem abrir'));
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
    render(<MissionForm onSubmit={vi.fn()} projectHasGit />);

    expect(screen.getByLabelText('Esta missão altera código')).not.toBeChecked();
    expect(screen.getByLabelText('Só criar, sem abrir')).not.toBeChecked();
  });

  describe('projeto sem Git', () => {
    const WARNING =
      'Este projeto não é um repositório Git. Toda missão roda num worktree, e o worktree precisa de Git. Inicialize o Git na pasta para criar missões aqui.';

    it('mostra o aviso e desabilita Criar missão, mesmo sem "altera código" marcado', () => {
      render(<MissionForm onSubmit={vi.fn()} projectHasGit={false} />);

      expect(screen.getByRole('alert')).toHaveTextContent(WARNING);
      expect(screen.getByLabelText('Esta missão altera código')).not.toBeChecked();
      expect(screen.getByRole('button', { name: 'Criar missão' })).toBeDisabled();
    });

    it('não envia, mesmo com todos os campos preenchidos e o formulário enviado direto', async () => {
      const submit = vi.fn();
      render(<MissionForm onSubmit={submit} projectHasGit={false} />);

      await userEvent.type(screen.getByLabelText('Título'), 'Documentar');
      await userEvent.type(screen.getByLabelText('Objetivo'), 'Escrever o guia');
      await userEvent.type(screen.getByLabelText('Critérios de aceite'), 'Guia pronto');
      fireEvent.submit(screen.getByRole('form', { name: 'Nova missão' }));

      expect(submit).not.toHaveBeenCalled();
    });

    it('marcar "altera código" não muda o bloqueio', async () => {
      const submit = vi.fn();
      render(<MissionForm onSubmit={submit} projectHasGit={false} />);

      await userEvent.click(screen.getByLabelText('Esta missão altera código'));

      expect(screen.getByRole('button', { name: 'Criar missão' })).toBeDisabled();
      expect(submit).not.toHaveBeenCalled();
    });

    it('com Git, o aviso não aparece e a missão é enviada', async () => {
      const submit = vi.fn();
      render(<MissionForm onSubmit={submit} projectHasGit />);

      expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Criar missão' })).toBeEnabled();

      await userEvent.type(screen.getByLabelText('Título'), 'Documentar');
      await userEvent.type(screen.getByLabelText('Objetivo'), 'Escrever o guia');
      await userEvent.type(screen.getByLabelText('Critérios de aceite'), 'Guia pronto');
      await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

      expect(submit).toHaveBeenCalledTimes(1);
    });
  });
});

// Validação com react-hook-form e zod: o formulário guarda o que foi digitado quando há erro, leva o foco
// ao primeiro campo inválido e, depois do primeiro envio, atualiza a mensagem a cada tecla.
describe('MissionForm: validação com react-hook-form e zod', () => {
  it('título vazio não envia e mantém os outros campos preenchidos', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} projectHasGit />);

    await userEvent.type(screen.getByLabelText('Objetivo'), 'Gravar o arquivo');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(await screen.findByText('Informe o título da missão.')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Objetivo')).toHaveValue('Gravar o arquivo');
  });

  it('o foco vai para o primeiro campo inválido', async () => {
    render(<MissionForm onSubmit={vi.fn()} projectHasGit />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveFocus());
  });

  it('título só com espaços conta como vazio', async () => {
    const submit = vi.fn();
    render(<MissionForm onSubmit={submit} projectHasGit />);

    await userEvent.type(screen.getByLabelText('Título'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(await screen.findByText('Informe o título da missão.')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('depois do primeiro envio, a mensagem some assim que o campo é corrigido', async () => {
    render(<MissionForm onSubmit={vi.fn()} projectHasGit />);

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));
    expect(await screen.findByText('Informe o título da missão.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Título'), 'Ajustar login');

    await waitFor(() =>
      expect(screen.queryByText('Informe o título da missão.')).not.toBeInTheDocument(),
    );
  });
});
