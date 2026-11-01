import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
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

async function openMenu(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: `Ações da tarefa ${title}` }));
}

/** Fim da chamada em curso do `BusyAfterEdit`. */
let finishEdit: () => void = () => {};

/** O plano com a página ocupada a partir de cada edição, como na tela da missão. */
function BusyAfterEdit({ onEditStep }: { onEditStep: (stepId: string, edit: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  finishEdit = () => setBusy(false);
  return (
    <PlanPanel
      mission={missionOf('planned')}
      steps={STEPS}
      busy={busy}
      planning={false}
      onEditStep={(stepId, edit) => {
        onEditStep(stepId, edit);
        setBusy(true);
      }}
    />
  );
}

describe('PlanPanel: lista de etapas', () => {
  it('mostra as etapas numa lista, com o agente só no cabeçalho', () => {
    setup();

    const list = screen.getByRole('list', { name: 'Etapas do plano' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Criar API')).toBeInTheDocument();
    expect(within(list).getAllByText('Pendente')).toHaveLength(3);
    expect(screen.getAllByText(/Claude/)).toHaveLength(1);
    expect(screen.getByText('Agente: Claude')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('com o plano vazio, convida a orquestrar', () => {
    setup({ steps: [] });

    expect(screen.getByText(/Clique em Orquestrar/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('não mostra o quadro do orquestrador fora do planejamento', () => {
    setup();

    expect(screen.queryByRole('region', { name: 'Quadro do orquestrador' })).toBeNull();
  });
});

describe('PlanPanel: edição das tarefas', () => {
  it('renomear por duplo clique envia só o título novo; Esc não envia nada', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    await user.dblClick(screen.getByText('Criar API'));
    const field = screen.getByRole('textbox', { name: 'Novo nome da tarefa Criar API' });
    expect(field).toHaveValue('Criar API');
    await user.type(field, ' de login{Enter}');
    expect(onEditStep).toHaveBeenCalledTimes(1);
    expect(onEditStep).toHaveBeenCalledWith('s1', { op: 'rename', title: 'Criar API de login' });
    expect(screen.queryByRole('textbox')).toBeNull();

    onEditStep.mockClear();
    await user.dblClick(screen.getByText('Montar a tela'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), 'x{Escape}');
    expect(onEditStep).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('com a descrição intocada, o envio do rename não a leva: ela fica como está', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: [{ ...STEPS[0]!, description: 'Fazer a API.' }] });

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2{Enter}');

    const edit = onEditStep.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(edit).toEqual({ op: 'rename', title: 'Criar API v2' });
    expect('description' in edit).toBe(false);
  });

  it('renomear com a descrição trocada envia o título e a descrição', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ steps: [{ ...STEPS[0]!, description: 'Fazer a API.' }] });

    await user.dblClick(screen.getByText('Criar API'));
    const description = screen.getByRole('textbox', {
      name: 'Nova descrição da tarefa Criar API',
    });
    expect(description).toHaveValue('Fazer a API.');
    await user.clear(description);
    await user.type(description, 'Fazer a API de login.');
    await user.click(screen.getByRole('button', { name: 'Salvar alterações da tarefa Criar API' }));

    expect(onEditStep).toHaveBeenCalledTimes(1);
    expect(onEditStep).toHaveBeenCalledWith('s1', {
      op: 'rename',
      title: 'Criar API',
      description: 'Fazer a API de login.',
    });
  });

  it('remover só chama a edição depois da confirmação', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    await openMenu(user, 'Escrever testes');
    await user.click(screen.getByRole('menuitem', { name: 'Remover' }));
    expect(onEditStep).not.toHaveBeenCalled();
    const question = screen.getByRole('group', {
      name: 'Remover a tarefa Escrever testes do plano?',
    });

    await user.click(within(question).getByRole('button', { name: 'Voltar' }));
    expect(onEditStep).not.toHaveBeenCalled();

    await openMenu(user, 'Escrever testes');
    await user.click(screen.getByRole('menuitem', { name: 'Remover' }));
    await user.click(
      within(
        screen.getByRole('group', { name: 'Remover a tarefa Escrever testes do plano?' }),
      ).getByRole('button', { name: 'Remover' }),
    );
    expect(onEditStep).toHaveBeenCalledTimes(1);
    expect(onEditStep).toHaveBeenCalledWith('s3', { op: 'remove' });
  });

  it('mover pelo menu envia a posição final; a primeira não sobe e a última não desce', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    await openMenu(user, 'Criar API');
    expect(screen.queryByRole('menuitem', { name: 'Subir' })).toBeNull();
    await user.keyboard('{Escape}');
    await openMenu(user, 'Escrever testes');
    expect(screen.queryByRole('menuitem', { name: 'Descer' })).toBeNull();
    await user.keyboard('{Escape}');

    await openMenu(user, 'Montar a tela');
    await user.click(screen.getByRole('menuitem', { name: 'Subir' }));
    expect(onEditStep).toHaveBeenLastCalledWith('s2', { op: 'move', toPosition: 1 });

    await openMenu(user, 'Montar a tela');
    await user.click(screen.getByRole('menuitem', { name: 'Descer' }));
    expect(onEditStep).toHaveBeenLastCalledWith('s2', { op: 'move', toPosition: 3 });

    await openMenu(user, 'Criar API');
    await user.click(screen.getByRole('menuitem', { name: 'Descer' }));
    expect(onEditStep).toHaveBeenLastCalledWith('s1', { op: 'move', toPosition: 2 });
  });

  it('a alça move com Alt+setas e envia a posição final', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup();

    screen.getByRole('button', { name: /^Reordenar tarefa Montar a tela/ }).focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(onEditStep).toHaveBeenLastCalledWith('s2', { op: 'move', toPosition: 1 });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(onEditStep).toHaveBeenLastCalledWith('s2', { op: 'move', toPosition: 3 });
  });

  it('com a página ocupada, os controles das tarefas ficam desabilitados', async () => {
    const user = userEvent.setup();
    setup({ busy: true });

    expect(screen.getByRole('button', { name: 'Ações da tarefa Criar API' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Reordenar tarefa Criar API/ })).toBeDisabled();
    await user.dblClick(screen.getByText('Criar API'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Enter no campo de renomear não envia nada se a página ficar ocupada no meio', async () => {
    const user = userEvent.setup();
    const props = {
      mission: missionOf('planned'),
      steps: STEPS,
      planning: false,
      onEditStep: vi.fn(),
    };
    const { rerender } = render(<PlanPanel {...props} busy={false} />);

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' nova');
    rerender(<PlanPanel {...props} busy />);
    const field = screen.getByRole('textbox', { name: /Novo nome/ });
    expect(field).toBeDisabled();
    field.focus();
    await user.keyboard('{Enter}');

    expect(props.onEditStep).not.toHaveBeenCalled();
  });
});

describe('PlanPanel: foco depois da edição', () => {
  it('Salvar o nome devolve o foco ao ⋯ da linha quando a página deixa de estar ocupada', async () => {
    const user = userEvent.setup();
    const onEditStep = vi.fn();
    render(<BusyAfterEdit onEditStep={onEditStep} />);

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2');
    await user.click(screen.getByRole('button', { name: /^Salvar alterações/ }));

    expect(onEditStep).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Ações da tarefa Criar API' })).toBeDisabled();
    act(() => finishEdit());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Ações da tarefa Criar API' }),
    );
  });

  it('Cancelar e Esc devolvem o foco ao ⋯ da linha', async () => {
    const user = userEvent.setup();
    setup();

    await user.dblClick(screen.getByText('Criar API'));
    await user.click(screen.getByRole('button', { name: 'Cancelar renomear tarefa Criar API' }));
    expect(screen.getByRole('button', { name: 'Ações da tarefa Criar API' })).toHaveFocus();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Ações da tarefa Montar a tela' })).toHaveFocus();
  });

  it('Alt+seta na alça mantém o foco nela depois de a ordem trocar', async () => {
    const user = userEvent.setup();
    const props = { mission: missionOf('planned'), planning: false, onEditStep: vi.fn() };
    const { rerender } = render(<PlanPanel {...props} busy={false} steps={STEPS} />);
    const swapped = [{ ...STEPS[1]!, position: 1 }, { ...STEPS[0]!, position: 2 }, STEPS[2]!];

    screen.getByRole('button', { name: /^Reordenar tarefa Montar a tela/ }).focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    rerender(<PlanPanel {...props} busy steps={STEPS} />);
    rerender(<PlanPanel {...props} busy steps={swapped} />);
    rerender(<PlanPanel {...props} busy={false} steps={swapped} />);

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /^Reordenar tarefa Montar a tela/ }),
    );
  });

  it('Voltar na remoção devolve o foco ao ⋯ da linha', async () => {
    const user = userEvent.setup();
    setup();

    await openMenu(user, 'Escrever testes');
    await user.click(screen.getByRole('menuitem', { name: 'Remover' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(screen.getByRole('button', { name: 'Ações da tarefa Escrever testes' })).toHaveFocus();
  });
});

const DESCRIBED: MissionStepDto[] = [
  { ...STEPS[0]!, description: 'Fazer a API de login.' },
  STEPS[1]!,
  STEPS[2]!,
];

describe('PlanPanel: descrição das tarefas', () => {
  it('a descrição começa fechada; Ver descrição abre e Ocultar descrição fecha', async () => {
    const user = userEvent.setup();
    setup({ steps: DESCRIBED });
    expect(screen.queryByText('Fazer a API de login.')).toBeNull();

    await openMenu(user, 'Criar API');
    await user.click(screen.getByRole('menuitem', { name: 'Ver descrição' }));
    expect(screen.getByText('Fazer a API de login.')).toBeInTheDocument();

    await openMenu(user, 'Criar API');
    await user.click(screen.getByRole('menuitem', { name: 'Ocultar descrição' }));
    expect(screen.queryByText('Fazer a API de login.')).toBeNull();
  });

  it('só a tarefa com descrição oferece Ver descrição', async () => {
    const user = userEvent.setup();
    setup({ steps: DESCRIBED });

    await openMenu(user, 'Montar a tela');
    expect(screen.queryByRole('menuitem', { name: /descrição/ })).toBeNull();
  });

  it('com a missão fora do estado planejado, a descrição abre e continua só leitura', async () => {
    const user = userEvent.setup();
    const { onEditStep } = setup({ mission: missionOf('running'), steps: DESCRIBED });

    await openMenu(user, 'Criar API');
    expect(screen.queryByRole('menuitem', { name: 'Remover' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Ver descrição' }));

    expect(screen.getByText('Fazer a API de login.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onEditStep).not.toHaveBeenCalled();
  });
});

describe('PlanPanel: planejamento em curso e erro', () => {
  it('enquanto planeja, mostra "Planejando…" e só o quadro do orquestrador, sem a lista', () => {
    const { onEditStep } = setup({ busy: true, planning: true });

    expect(screen.getByRole('status')).toHaveTextContent('Planejando…');
    expect(screen.getByRole('region', { name: 'Quadro do orquestrador' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Etapas do plano' })).toBeNull();
    expect(screen.queryByText('Criar API', { selector: '.step-row__title' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Ações da tarefa/ })).toBeNull();
    expect(onEditStep).not.toHaveBeenCalled();
  });

  it('enquanto planeja sem tarefas, mostra o quadro e nem a lista nem o plano vazio', () => {
    setup({ planning: true, steps: [] });

    expect(screen.getByRole('status')).toHaveTextContent('Planejando…');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/Clique em Orquestrar/)).toBeNull();
  });

  it('o plano vazio só aparece fora do planejamento', () => {
    setup({ planning: false, steps: [] });

    expect(screen.getByText(/Clique em Orquestrar/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Quadro do orquestrador' })).toBeNull();
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
  // A instrução, o aviso da cota e o Planejar de novo (com os bloqueios e a falha) são do bloco
  // "Sua decisão": testados em DecisionBlock.test.tsx e MissionPage.test.tsx.
});

describe('PlanPanel: fora do estado planejado', () => {
  it.each(['queued', 'running', 'succeeded', 'draft'] as const)(
    'com a missão em %s a lista é só leitura',
    (status) => {
      setup({ mission: missionOf(status) });

      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByText('Criar API')).toBeInTheDocument();
      expect(screen.getAllByText(/Claude/)).toHaveLength(1);
      expect(screen.queryByText('Planejar usa a cota do seu Claude.')).toBeNull();
    },
  );
});
