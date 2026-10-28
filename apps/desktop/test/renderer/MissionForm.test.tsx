import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MissionForm, titleFrom } from '../../src/renderer/components/MissionForm';

function renderForm(props: Partial<Parameters<typeof MissionForm>[0]> = {}) {
  const submit = vi.fn();
  const view = render(<MissionForm onSubmit={submit} projectHasGit {...props} />);
  return { submit, ...view };
}

describe('MissionForm: compositor', () => {
  it('abre com o foco no objetivo, que é o texto principal', () => {
    renderForm();

    expect(screen.getByLabelText('Objetivo')).toHaveFocus();
  });

  it('Enter no campo de critério vira um item da lista, e o campo limpa', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Critérios de aceite'), 'Testes passam{enter}');

    const lista = screen.getByRole('list', { name: 'Pronto quando' });
    expect(within(lista).getByText('Testes passam')).toBeInTheDocument();
    expect(screen.getByLabelText('Critérios de aceite')).toHaveValue('');
  });

  it('Enter com o campo vazio ou repetido não cria item', async () => {
    const user = userEvent.setup();
    renderForm();

    const campo = screen.getByLabelText('Critérios de aceite');
    await user.type(campo, '   {enter}');
    expect(screen.queryByRole('list', { name: 'Pronto quando' })).not.toBeInTheDocument();
    await user.type(campo, 'A{enter}A{enter}');
    expect(within(screen.getByRole('list', { name: 'Pronto quando' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('cada critério tem o próprio botão de remover, com o texto no nome', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Critérios de aceite'), 'A{enter}B{enter}');
    await user.click(screen.getByRole('button', { name: 'Remover critério A' }));

    const lista = screen.getByRole('list', { name: 'Pronto quando' });
    expect(within(lista).queryByText('A')).not.toBeInTheDocument();
    expect(within(lista).getByText('B')).toBeInTheDocument();
  });

  it('Criar envia os valores aparados, com o critério digitado sem Enter e a opção marcada', async () => {
    const user = userEvent.setup();
    const { submit } = renderForm();

    await user.type(screen.getByLabelText('Título'), '  Login com Google  ');
    await user.type(screen.getByLabelText('Objetivo'), '  Aceitar a conta Google  ');
    await user.type(screen.getByLabelText('Critérios de aceite'), 'Botão aparece{enter}Testes passam');
    await user.click(screen.getByLabelText('Altera código'));
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(submit).toHaveBeenCalledWith({
      title: 'Login com Google',
      objective: 'Aceitar a conta Google',
      acceptanceCriteria: ['Botão aparece', 'Testes passam'],
      altersCode: true,
      orchestrate: false,
    });
  });

  it('Criar e orquestrar envia com orchestrate, e mostra o aviso de cota ligado ao botão', async () => {
    const user = userEvent.setup();
    const { submit } = renderForm();

    await user.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await user.type(screen.getByLabelText('Critérios de aceite'), 'Testes passam');
    const orquestrar = screen.getByRole('button', { name: 'Criar e orquestrar' });
    expect(orquestrar).toHaveAccessibleDescription('Orquestrar usa a cota do seu Claude.');
    await user.click(orquestrar);

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ orchestrate: true }));
  });

  it('sem título, usa a primeira linha do objetivo', async () => {
    const user = userEvent.setup();
    const { submit } = renderForm();

    await user.type(screen.getByLabelText('Objetivo'), 'Corrigir o login{enter}Detalhes aqui');
    await user.type(screen.getByLabelText('Critérios de aceite'), 'Testes passam');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Corrigir o login' }));
  });

  it('a opção começa desmarcada', () => {
    renderForm();

    expect(screen.getByLabelText('Altera código')).not.toBeChecked();
  });
});

describe('MissionForm: validação', () => {
  it('sem objetivo não envia, avisa junto do campo e leva o foco a ele', async () => {
    const user = userEvent.setup();
    const { submit } = renderForm();

    await user.type(screen.getByLabelText('Critérios de aceite'), 'Testes passam');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(screen.getByText('Informe o objetivo da missão.')).toBeInTheDocument();
    expect(screen.getByLabelText('Objetivo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Objetivo')).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it('sem critério não envia, avisa e leva o foco ao campo de critério', async () => {
    const user = userEvent.setup();
    const { submit } = renderForm();

    await user.type(screen.getByLabelText('Objetivo'), 'Corrigir o login');
    await user.click(screen.getByRole('button', { name: 'Criar e orquestrar' }));

    expect(screen.getByText('Informe ao menos um critério de aceite')).toBeInTheDocument();
    expect(screen.getByLabelText('Critérios de aceite')).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it('objetivo só com espaços conta como vazio', async () => {
    const user = userEvent.setup();
    const { submit } = renderForm();

    await user.type(screen.getByLabelText('Objetivo'), '   ');
    await user.type(screen.getByLabelText('Critérios de aceite'), 'Testes passam');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(submit).not.toHaveBeenCalled();
  });

  it('depois do primeiro envio, a mensagem some assim que o campo é corrigido', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'Criar' }));
    expect(screen.getByText('Informe o objetivo da missão.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Objetivo'), 'x');

    expect(screen.queryByText('Informe o objetivo da missão.')).not.toBeInTheDocument();
  });

  it('o que foi digitado continua no formulário depois de um envio recusado', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Título'), 'Login');
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(screen.getByLabelText('Título')).toHaveValue('Login');
  });
});

describe('MissionForm: rodapé', () => {
  it('Cancelar chama onCancel e fica antes de Criar e de Criar e orquestrar', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    renderForm({ onCancel: cancel });

    const botoes = screen.getAllByRole('button').map((button) => button.textContent);
    expect(botoes.slice(-3)).toEqual(['Cancelar', 'Criar', 'Criar e orquestrar']);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('só Criar e orquestrar usa o botão principal', () => {
    renderForm();

    expect(screen.getByRole('button', { name: 'Criar e orquestrar' })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'Criar' })).not.toHaveClass('btn-primary');
  });

  it('sem blocos numerados nem dicas por campo', () => {
    const { container } = renderForm();

    expect(container.querySelector('.field-hint, .check__hint, .form-section')).toBeNull();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });
});

describe('MissionForm: projeto sem Git', () => {
  it('mostra o aviso e desabilita os dois botões de criar', () => {
    renderForm({ projectHasGit: false });

    expect(screen.getByRole('alert')).toHaveTextContent('não é um repositório Git');
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Criar e orquestrar' })).toBeDisabled();
  });
});

describe('titleFrom', () => {
  it('prefere o título digitado, aparado', () => {
    expect(titleFrom('  Login  ', 'Outro')).toBe('Login');
  });

  it('sem título, usa a primeira linha do objetivo e corta em 80 caracteres', () => {
    expect(titleFrom('', 'Primeira\nSegunda')).toBe('Primeira');
    expect(titleFrom('', 'x'.repeat(100))).toBe(`${'x'.repeat(80)}…`);
  });
});
