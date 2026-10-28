import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PlanPanel } from '../../src/renderer/components/PlanPanel';

function missionOf(status: MissionDto['status']): MissionDto {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    status,
    altersCode: false,
    acceptanceCriteria: [],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

const STEPS: MissionStepDto[] = [
  {
    id: 's1',
    position: 1,
    title: 'Criar API',
    status: 'pending',
    role: 'backend',
    agent: 'claude-code',
  },
  {
    id: 's2',
    position: 2,
    title: 'Montar a tela',
    status: 'pending',
    role: 'frontend',
    agent: 'claude-code',
    dependsOn: ['s1'],
  },
  {
    id: 's3',
    position: 3,
    title: 'Escrever testes',
    status: 'pending',
    role: 'qa',
    agent: 'claude-code',
  },
];

function setup(props: Partial<Parameters<typeof PlanPanel>[0]> = {}) {
  const onEditStep = vi.fn();
  render(
    <PlanPanel
      mission={missionOf('planned')}
      steps={STEPS}
      busy={false}
      planning={false}
      onEditStep={onEditStep}
      {...props}
    />,
  );
  return { onEditStep };
}

describe('PlanPanel: tabela', () => {
  it('mostra as colunas Tarefa, Agente e Status e o nome do agente por texto', () => {
    setup();

    const table = screen.getByRole('table', { name: 'Etapas do plano' });
    for (const name of ['Tarefa', 'Agente', 'Status']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    const row = within(table).getByRole('row', { name: /Criar API/ });
    expect(within(row).getByText('Criar API')).toBeInTheDocument();
    expect(within(row).getByLabelText('Programa da tarefa Criar API')).toHaveDisplayValue('Claude');
    expect(within(row).getByText('Pendente')).toBeInTheDocument();
  });

  it('com o plano vazio, convida a orquestrar', () => {
    setup({ steps: [] });

    expect(screen.getByText(/Clique em Orquestrar/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('PlanPanel: edição das tarefas', () => {
  it('renomear: o campo traz o título, salvar envia a edição e cancelar não envia nada', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    const field = screen.getByRole('textbox', { name: 'Novo nome da tarefa Criar API' });
    expect(field).toHaveValue('Criar API');
    await user.clear(field);
    await user.type(field, 'Criar a API de login');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações da tarefa Criar API' }));

    expect(onEditStep).toHaveBeenCalledTimes(1);
    expect(onEditStep).toHaveBeenCalledWith('s1', { op: 'rename', title: 'Criar a API de login' });
    expect(screen.queryByRole('textbox', { name: /Novo nome/ })).toBeNull();

    onEditStep.mockClear();
    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' x');
    await user.click(screen.getByRole('button', { name: 'Cancelar renomear tarefa Criar API' }));

    expect(onEditStep).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /Novo nome/ })).toBeNull();
    expect(screen.getByText('Criar API')).toBeInTheDocument();
  });

  it('renomear pelo teclado: Enter salva e Esc cancela', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Montar a tela' }));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' nova{Enter}');
    expect(onEditStep).toHaveBeenCalledWith('s2', { op: 'rename', title: 'Montar a tela nova' });

    onEditStep.mockClear();
    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Montar a tela' }));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), 'x{Escape}');
    expect(onEditStep).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /Novo nome/ })).toBeNull();
  });

  it('não salva nome vazio nem igual ao atual', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    const save = screen.getByRole('button', { name: 'Salvar alterações da tarefa Criar API' });
    expect(save).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: /Novo nome/ }));
    expect(save).toBeDisabled();
    expect(onEditStep).not.toHaveBeenCalled();
  });

  it('remover só chama a edição depois da confirmação', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    await user.click(screen.getByRole('button', { name: 'Remover tarefa Escrever testes' }));
    expect(onEditStep).not.toHaveBeenCalled();
    const question = screen.getByRole('group', {
      name: 'Remover a tarefa Escrever testes do plano?',
    });

    await user.click(within(question).getByRole('button', { name: 'Voltar' }));
    expect(onEditStep).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remover tarefa Escrever testes' }));
    await user.click(
      within(
        screen.getByRole('group', { name: 'Remover a tarefa Escrever testes do plano?' }),
      ).getByRole('button', { name: 'Remover' }),
    );
    expect(onEditStep).toHaveBeenCalledTimes(1);
    expect(onEditStep).toHaveBeenCalledWith('s3', { op: 'remove' });
  });

  it('mover envia a posição final; a primeira não sobe e a última não desce', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    expect(screen.queryByRole('button', { name: 'Subir tarefa Criar API' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Descer tarefa Escrever testes' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Subir tarefa Montar a tela' }));
    expect(onEditStep).toHaveBeenLastCalledWith('s2', { op: 'move', toPosition: 1 });

    await user.click(screen.getByRole('button', { name: 'Descer tarefa Montar a tela' }));
    expect(onEditStep).toHaveBeenLastCalledWith('s2', { op: 'move', toPosition: 3 });

    await user.click(screen.getByRole('button', { name: 'Descer tarefa Criar API' }));
    expect(onEditStep).toHaveBeenLastCalledWith('s1', { op: 'move', toPosition: 2 });
  });

  it('o seletor de programa tem Claude marcado e Codex e Gemini desabilitados, "em breve"', () => {
    setup();

    const select = screen.getByRole('combobox', { name: 'Programa da tarefa Criar API' });
    const claude = within(select).getByRole('option', { name: 'Claude' });
    const codex = within(select).getByRole('option', { name: /Codex/ });
    const gemini = within(select).getByRole('option', { name: /Gemini/ });
    expect(claude).toBeEnabled();
    expect(claude).toHaveProperty('selected', true);
    expect(codex).toBeDisabled();
    expect(codex).toHaveTextContent('em breve');
    expect(gemini).toBeDisabled();
    expect(gemini).toHaveTextContent('em breve');
  });

  it('com a página ocupada, os controles das tarefas ficam desabilitados', () => {
    setup({ busy: true });

    expect(screen.getByRole('button', { name: 'Renomear tarefa Criar API' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover tarefa Criar API' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subir tarefa Montar a tela' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Programa da tarefa Criar API' })).toBeDisabled();
  });

  it('ao subir a tarefa até o topo, o foco passa para o "Descer" dela, em vez de se perder', async () => {
    const user = userEvent.setup();
    const props = {
      mission: missionOf('planned'),
      busy: false,
      planning: false,
      onEditStep: vi.fn(),
    };
    const two = STEPS.slice(0, 2);
    const { rerender } = render(<PlanPanel {...props} steps={two} />);

    await user.click(screen.getByRole('button', { name: 'Subir tarefa Montar a tela' }));
    rerender(<PlanPanel {...props} busy steps={two} />);
    const swapped = [
      { ...two[1]!, position: 1 },
      { ...two[0]!, position: 2 },
    ];
    rerender(<PlanPanel {...props} busy steps={swapped} />);
    rerender(<PlanPanel {...props} steps={swapped} />);

    expect(screen.queryByRole('button', { name: 'Subir tarefa Montar a tela' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Descer tarefa Montar a tela' })).toHaveFocus();
  });

  it('Enter no campo de renomear não envia nada enquanto outra chamada está em curso', async () => {
    const user = userEvent.setup();
    const props = {
      mission: missionOf('planned'),
      steps: STEPS,
      planning: false,
      onEditStep: vi.fn(),
    };
    const { rerender } = render(<PlanPanel {...props} busy={false} />);

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' nova');
    rerender(<PlanPanel {...props} busy />);
    const field = screen.getByRole('textbox', { name: /Novo nome/ });
    expect(field).toBeDisabled();
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(props.onEditStep).not.toHaveBeenCalled();
  });

  it('enquanto planeja, mesmo sem busy, os controles das tarefas ficam desabilitados', () => {
    setup({ planning: true, busy: false });

    expect(screen.getByRole('button', { name: 'Renomear tarefa Criar API' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover tarefa Criar API' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subir tarefa Montar a tela' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descer tarefa Criar API' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Programa da tarefa Criar API' })).toBeDisabled();
  });

  it('depois de salvar ou cancelar o nome, o foco volta ao botão Renomear', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar renomear tarefa Criar API' }));

    expect(screen.getByRole('button', { name: 'Renomear tarefa Criar API' })).toHaveFocus();
  });
});

const LONG_DESCRIPTION =
  'Implementar o endpoint de login com validação de e-mail e senha, devolvendo o token da sessão e ' +
  'registrando a tentativa na auditoria. Cobrir os erros de credencial inválida e de conta bloqueada, ' +
  'e documentar o contrato da resposta no arquivo de rotas.';

describe('PlanPanel: descrição das tarefas', () => {
  const withDescriptions = (): MissionStepDto[] => [
    { ...STEPS[0]!, description: 'Fazer a API de login.' },
    { ...STEPS[1]!, description: LONG_DESCRIPTION },
    STEPS[2]!,
  ];

  it('mostra a descrição de cada tarefa, e nada para a que não tem', () => {
    setup({ steps: withDescriptions() });

    expect(screen.getByText('Fazer a API de login.')).toBeInTheDocument();
    expect(screen.getByText(LONG_DESCRIPTION)).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Escrever testes/ });
    expect(row.querySelector('.plan-row__description')).toBeNull();
  });

  it('a descrição curta aparece inteira, sem botão de recolher', () => {
    setup({ steps: withDescriptions() });

    expect(screen.queryByRole('button', { name: /descrição da tarefa Criar API/ })).toBeNull();
  });

  it('a descrição longa começa recolhida; Ver descrição abre e Ocultar fecha, com o título no nome', async () => {
    const user = userEvent.setup();
    setup({ steps: withDescriptions() });
    const text = screen.getByText(LONG_DESCRIPTION);
    expect(text).toHaveClass('plan-row__description--clamped');

    const show = screen.getByRole('button', { name: 'Ver descrição da tarefa Montar a tela' });
    expect(show).toHaveTextContent('Ver descrição');
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveAttribute('aria-controls', text.id);
    await user.click(show);

    expect(text).not.toHaveClass('plan-row__description--clamped');
    const hide = screen.getByRole('button', { name: 'Ocultar descrição da tarefa Montar a tela' });
    expect(hide).toHaveTextContent('Ocultar');
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    await user.click(hide);
    expect(text).toHaveClass('plan-row__description--clamped');
  });

  it('com a missão fora do estado planejado, a descrição aparece e continua só leitura', () => {
    setup({ mission: missionOf('running'), steps: withDescriptions() });

    expect(screen.getByText('Fazer a API de login.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Renomear/ })).toBeNull();
  });

  it('editar só a descrição envia o título atual com a descrição nova', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: withDescriptions() });

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    const field = screen.getByRole('textbox', { name: 'Nova descrição da tarefa Criar API' });
    expect(field).toHaveValue('Fazer a API de login.');
    expect(field).toHaveAttribute('maxlength', '2000');
    await user.clear(field);
    await user.type(field, '  Nova descrição.  ');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações da tarefa Criar API' }));

    expect(onEditStep).toHaveBeenCalledTimes(1);
    expect(onEditStep).toHaveBeenCalledWith('s1', {
      op: 'rename',
      title: 'Criar API',
      description: 'Nova descrição.',
    });
  });

  it('editar título e descrição envia os dois; apagar a descrição envia texto vazio', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: withDescriptions() });

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2');
    await user.clear(screen.getByRole('textbox', { name: /Nova descrição/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar alterações da tarefa Criar API' }));

    expect(onEditStep).toHaveBeenCalledWith('s1', {
      op: 'rename',
      title: 'Criar API v2',
      description: '',
    });
  });

  it('editar só o título não envia a descrição', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: withDescriptions() });

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações da tarefa Criar API' }));

    expect(onEditStep).toHaveBeenCalledTimes(1);
    const edit = onEditStep.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(edit).toEqual({ op: 'rename', title: 'Criar API v2' });
    expect('description' in edit).toBe(false);
  });

  it('escrever uma descrição numa tarefa que não tinha envia a descrição', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: withDescriptions() });

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Escrever testes' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Nova descrição da tarefa Escrever testes' }),
      'Cobrir o login.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Salvar alterações da tarefa Escrever testes' }),
    );

    expect(onEditStep).toHaveBeenCalledWith('s3', {
      op: 'rename',
      title: 'Escrever testes',
      description: 'Cobrir o login.',
    });
  });

  it('salvar fica desabilitado sem mudança, com só espaços a mais e com título vazio', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: withDescriptions() });

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    const save = screen.getByRole('button', { name: 'Salvar alterações da tarefa Criar API' });
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), '   ');
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), 'x');
    expect(save).toBeEnabled();
    await user.clear(screen.getByRole('textbox', { name: /Novo nome/ }));
    expect(save).toBeDisabled();
    expect(onEditStep).not.toHaveBeenCalled();
  });

  it('Enter no título salva; Enter na descrição é quebra de linha e não salva', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: withDescriptions() });

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), '{Enter}outra linha');
    expect(onEditStep).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Nova descrição/ })).toHaveValue(
      'Fazer a API de login.\noutra linha',
    );
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2{Enter}');

    expect(onEditStep).toHaveBeenCalledWith('s1', {
      op: 'rename',
      title: 'Criar API v2',
      description: 'Fazer a API de login.\noutra linha',
    });
  });

  it('Esc na descrição cancela sem enviar nada', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: withDescriptions() });

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), ' mais{Escape}');

    expect(onEditStep).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /Nova descrição/ })).toBeNull();
  });

  it.each([
    ['ocupada', { busy: true, planning: false }],
    ['planejando', { busy: false, planning: true }],
  ] as const)('com a página %s, a descrição não aceita edição nem envio', async (_name, locked) => {
    const user = userEvent.setup();
    const props = {
      mission: missionOf('planned'),
      steps: withDescriptions(),
      onEditStep: vi.fn(),
    };
    const { rerender } = render(<PlanPanel {...props} busy={false} planning={false} />);

    await user.click(screen.getByRole('button', { name: 'Renomear tarefa Criar API' }));
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), ' mais');
    rerender(<PlanPanel {...props} {...locked} />);
    const field = screen.getByRole('textbox', { name: /Nova descrição/ });

    expect(field).toBeDisabled();
    expect(screen.getByRole('button', { name: /Salvar alterações/ })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: /Novo nome/ }), { key: 'Enter' });
    expect(props.onEditStep).not.toHaveBeenCalled();
  });
});

describe('PlanPanel: planejamento em curso e erro', () => {
  it('enquanto planeja, mostra "Planejando…" numa região de status', () => {
    setup({ busy: true, planning: true });

    expect(screen.getByRole('status')).toHaveTextContent('Planejando…');
  });

  it('o erro aparece com role="alert"', () => {
    setup({ error: 'O Claude não respondeu a tempo.' });

    expect(screen.getByRole('alert')).toHaveTextContent('O Claude não respondeu a tempo.');
  });

  it('o painel não tem mais a instrução nem o Planejar de novo (vão para o bloco Sua decisão)', () => {
    setup();

    expect(screen.queryByRole('textbox', { name: 'Instrução para o novo plano' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Planejar de novo' })).toBeNull();
    expect(screen.queryByText('Planejar usa a cota do seu Claude.')).toBeNull();
  });

  // Mudaram para o bloco "Sua decisão" (Tarefa 7 da reestruturação): voltam a ser testados lá.
  it.todo('Planejar de novo envia a instrução e mostra o aviso da cota');
  it.todo('Planejar de novo sem instrução envia texto vazio');
  it.todo('enquanto planeja, o botão Planejar de novo mostra "Planejando…" e fica desabilitado');
  it.todo('com erro de planejamento, o Planejar de novo continua disponível');
});

describe('PlanPanel: fora do estado planejado', () => {
  it.each(['queued', 'running', 'succeeded', 'draft'] as const)(
    'com a missão em %s a tabela é só leitura',
    (status) => {
      setup({ mission: missionOf(status) });

      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByText('Criar API')).toBeInTheDocument();
      expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
      expect(screen.queryByText('Planejar usa a cota do seu Claude.')).toBeNull();
    },
  );
});
