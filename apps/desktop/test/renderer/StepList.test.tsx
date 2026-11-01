import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionStepDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { StepList } from '../../src/renderer/components/mission/StepList';

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
    status: 'running',
    role: 'frontend',
    agent: 'claude-code',
    dependsOn: ['s1'],
    description: 'Montar a tela de login com os campos de e-mail e senha.',
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

type StepListProps = Parameters<typeof StepList>[0];

function triggerOf(title: string) {
  return screen.getByRole('button', { name: `Ações da tarefa ${title}` });
}

function elementOf(props: Partial<StepListProps> = {}) {
  return (
    <StepList
      steps={STEPS}
      agentName="Claude"
      onRename={vi.fn()}
      onMove={vi.fn()}
      onRemove={vi.fn()}
      onViewDescription={vi.fn()}
      {...props}
    />
  );
}

/** Troca a ordem das duas primeiras etapas, como a lista nova que volta da página. */
const SWAPPED: MissionStepDto[] = [
  { ...STEPS[1]!, position: 1 },
  { ...STEPS[0]!, position: 2 },
  STEPS[2]!,
];

/** Fim da chamada em curso da lista de `BusyAfterRename`. */
let finishCall: () => void = () => {};

/** Lista cujo `onRename` deixa a página ocupada no mesmo evento que fecha o campo, como a página real. */
function BusyAfterRename({ onRename }: { onRename: StepListProps['onRename'] }) {
  const [busy, setBusy] = useState(false);
  finishCall = () => setBusy(false);
  return elementOf({
    disabled: busy,
    onRename: (id, edit) => {
      onRename(id, edit);
      setBusy(true);
    },
  });
}

function setup(props: Partial<Parameters<typeof StepList>[0]> = {}) {
  const handlers = {
    onRename: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onViewDescription: vi.fn(),
  };
  const view = render(<StepList steps={STEPS} agentName="Claude" {...handlers} {...props} />);
  return { ...handlers, ...view };
}

describe('StepList', () => {
  it('lista vazia mostra a mensagem de vazio', () => {
    setup({ steps: [] });

    expect(screen.getByText(/Ainda não há plano/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('o nome do agente aparece uma vez, no cabeçalho', () => {
    setup();

    expect(screen.getAllByText(/Claude/)).toHaveLength(1);
    const list = screen.getByRole('list', { name: 'Etapas do plano' });
    expect(within(list).queryByText(/Claude/)).toBeNull();
    expect(screen.getByText(/Claude/).closest('li')).toBeNull();
  });

  it('cada linha tem um único gatilho de menu "⋯"', async () => {
    const user = userEvent.setup();
    setup();

    for (const row of screen.getAllByRole('listitem')) {
      const buttons = within(row).getAllByRole('button');
      const triggers = buttons.filter((button) => button.textContent === '⋯');
      expect(triggers).toHaveLength(1);
      expect(within(row).queryByRole('button', { name: /Renomear$|Remover$/ })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Renomear/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remover/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Montar a tela' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Ver descrição', 'Renomear', 'Subir', 'Descer', 'Remover']);
  });

  it('o menu da primeira não tem Subir e o da última não tem Descer', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Criar API' }));
    expect(screen.queryByRole('menuitem', { name: 'Subir' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Descer' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Escrever testes' }));
    expect(screen.queryByRole('menuitem', { name: 'Descer' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Subir' })).toBeInTheDocument();
  });

  it('duplo clique no título entra em renomear; Enter salva; Escape cancela', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Criar API'));
    const field = screen.getByRole('textbox', { name: 'Novo nome da tarefa Criar API' });
    expect(field).toHaveValue('Criar API');
    expect(field).toHaveFocus();
    await user.type(field, ' de login{Enter}');
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('s1', { title: 'Criar API de login' });
    expect(screen.queryByRole('textbox')).toBeNull();

    onRename.mockClear();
    await user.dblClick(screen.getByText('Montar a tela'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' x{Escape}');
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Montar a tela')).toBeInTheDocument();
  });

  it('Enter com o nome vazio ou igual ao atual não envia nada', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), '{Enter}');
    expect(onRename).not.toHaveBeenCalled();

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(
      screen.getByRole('textbox', { name: /Novo nome/ }),
      '{Control>}a{/Control}{Backspace}{Enter}',
    );
    expect(onRename).not.toHaveBeenCalled();
  });

  it('renomear mostra também a descrição atual num campo próprio', async () => {
    const user = userEvent.setup();
    setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    expect(
      screen.getByRole('textbox', { name: 'Nova descrição da tarefa Montar a tela' }),
    ).toHaveValue('Montar a tela de login com os campos de e-mail e senha.');
    await user.keyboard('{Escape}');

    await user.dblClick(screen.getByText('Criar API'));
    expect(screen.getByRole('textbox', { name: 'Nova descrição da tarefa Criar API' })).toHaveValue(
      '',
    );
  });

  it('Salvar envia o título e a descrição nova', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' de entrada');
    const description = screen.getByRole('textbox', { name: /Nova descrição/ });
    await user.clear(description);
    await user.type(description, '  Mostrar o erro de senha.  ');
    await user.click(
      screen.getByRole('button', { name: 'Salvar alterações da tarefa Montar a tela' }),
    );

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('s2', {
      title: 'Montar a tela de entrada',
      description: 'Mostrar o erro de senha.',
    });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('só a descrição mudou: envia o título atual com a descrição', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), 'Rotas de login.');
    await user.click(screen.getByRole('button', { name: /^Salvar alterações/ }));

    expect(onRename).toHaveBeenCalledWith('s1', {
      title: 'Criar API',
      description: 'Rotas de login.',
    });
  });

  it('só o título mudou: a descrição fica fora do envio', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2{Enter}');

    const edit = onRename.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(edit).toEqual({ title: 'Montar a tela v2' });
    expect('description' in edit).toBe(false);
  });

  it('a descrição vazia é aceita e vai como texto vazio', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.clear(screen.getByRole('textbox', { name: /Nova descrição/ }));
    await user.click(screen.getByRole('button', { name: /^Salvar alterações/ }));

    expect(onRename).toHaveBeenCalledWith('s2', { title: 'Montar a tela', description: '' });
  });

  it('título vazio não salva, nem com a descrição mudada', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.clear(screen.getByRole('textbox', { name: /Novo nome/ }));
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), ' Mais.');
    const save = screen.getByRole('button', { name: /^Salvar alterações/ });
    expect(save).toBeDisabled();
    await user.click(save);
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), '{Enter}');

    expect(onRename).not.toHaveBeenCalled();
  });

  it('nada mudou: Salvar fica desabilitado', async () => {
    const user = userEvent.setup();
    setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    expect(screen.getByRole('button', { name: /^Salvar alterações/ })).toBeDisabled();
  });

  it('Enter na descrição quebra a linha e não salva; Escape nela cancela os dois campos', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' x');
    const description = screen.getByRole('textbox', { name: /Nova descrição/ });
    await user.click(description);
    // Passar do título à descrição não fecha a edição.
    expect(screen.getByRole('textbox', { name: /Novo nome/ })).toBeInTheDocument();
    await user.type(description, '{Enter}Outra linha.');
    expect(description).toHaveValue(
      'Montar a tela de login com os campos de e-mail e senha.\nOutra linha.',
    );
    expect(onRename).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Montar a tela')).toBeInTheDocument();

    // Reabrir começa do que está gravado, sem o rascunho anterior.
    await user.dblClick(screen.getByText('Montar a tela'));
    expect(screen.getByRole('textbox', { name: /Novo nome/ })).toHaveValue('Montar a tela');
    expect(screen.getByRole('textbox', { name: /Nova descrição/ })).toHaveValue(
      'Montar a tela de login com os campos de e-mail e senha.',
    );
  });

  it('Cancelar fecha a edição sem enviar nada', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), ' Mais.');
    await user.click(
      screen.getByRole('button', { name: 'Cancelar renomear tarefa Montar a tela' }),
    );

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('enquanto renomeia, a descrição aberta dá lugar ao campo', async () => {
    const user = userEvent.setup();
    setup({ expandedIds: new Set(['s2']) });

    expect(screen.getByText(/campos de e-mail e senha/, { selector: 'p' })).toBeInTheDocument();
    await user.dblClick(screen.getByText('Montar a tela'));
    expect(screen.queryByText(/campos de e-mail e senha/, { selector: 'p' })).toBeNull();
    expect(screen.getByRole('textbox', { name: /Nova descrição/ })).toBeInTheDocument();
  });

  it('o item Renomear do menu abre o campo, para quem não usa o mouse', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Criar API' }));
    await user.click(screen.getByRole('menuitem', { name: 'Renomear' }));

    expect(screen.getByRole('textbox', { name: 'Novo nome da tarefa Criar API' })).toHaveFocus();
  });

  it('título de 90 caracteres com acento e emoji fica inteiro no DOM e na dica title, com o ⋯ ao lado', () => {
    const title = `Ação 🚀 ${'configuração do módulo de autenticação '.repeat(3)}`.slice(0, 90);
    expect(title).toHaveLength(90);
    setup({ steps: [{ ...STEPS[0]!, title }] });

    const row = screen.getByRole('listitem');
    const text = within(row).getByText(title);
    // O corte é da CSS (reticências): o texto inteiro fica no DOM e na dica, sem fatiar o emoji.
    expect(text).toHaveClass('step-row__title');
    expect(text).toHaveAttribute('title', title);
    expect(text.textContent).toBe(title);
    // O menu é irmão do bloco do título, fora do elemento que encolhe, e segue acessível.
    const trigger = within(row).getByRole('button', { name: `Ações da tarefa ${title}` });
    expect(trigger).toBeVisible();
    expect(trigger).toHaveTextContent('⋯');
    expect(text.contains(trigger)).toBe(false);
    expect(trigger.parentElement).toBe(row);
    expect(row.querySelector('.step-row__main')?.contains(trigger)).toBe(false);
  });

  it('o status, a posição, o papel e a dependência aparecem na linha, sem repetir o agente', () => {
    setup();

    const row = screen.getByText('Montar a tela').closest('li')!;
    expect(within(row).getByText('Em execução')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('Frontend · depois de 1')).toBeInTheDocument();
    expect(within(row).queryByText(/Claude/)).toBeNull();
  });

  it('Ver descrição chama o tratador; a descrição aparece só nas linhas abertas', async () => {
    const user = userEvent.setup();
    const { onViewDescription, rerender, ...rest } = setup();

    expect(screen.queryByText(/campos de e-mail e senha/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Montar a tela' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ver descrição' }));
    expect(onViewDescription).toHaveBeenCalledWith('s2');

    rerender(
      <StepList
        steps={STEPS}
        agentName="Claude"
        onRename={rest.onRename}
        onMove={rest.onMove}
        onRemove={rest.onRemove}
        onViewDescription={onViewDescription}
        expandedIds={new Set(['s2'])}
      />,
    );
    expect(screen.getByText(/campos de e-mail e senha/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Montar a tela' }));
    expect(screen.getByRole('menuitem', { name: 'Ocultar descrição' })).toBeInTheDocument();
  });

  it('sem descrição, o menu não oferece Ver descrição', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Criar API' }));
    expect(screen.queryByRole('menuitem', { name: /descrição/ })).toBeNull();
  });

  it('Subir e Descer do menu chamam onMove com a direção', async () => {
    const user = userEvent.setup();
    const { onMove } = setup();

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Montar a tela' }));
    await user.click(screen.getByRole('menuitem', { name: 'Subir' }));
    expect(onMove).toHaveBeenLastCalledWith('s2', 'up');

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Montar a tela' }));
    await user.click(screen.getByRole('menuitem', { name: 'Descer' }));
    expect(onMove).toHaveBeenLastCalledWith('s2', 'down');
  });

  it('a alça move com Alt+setas, e setas sem Alt não movem; nas pontas não há movimento', async () => {
    const user = userEvent.setup();
    const { onMove } = setup();

    const handle = screen.getByRole('button', { name: /^Reordenar tarefa Montar a tela/ });
    handle.focus();
    await user.keyboard('{ArrowUp}{ArrowDown}');
    expect(onMove).not.toHaveBeenCalled();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(onMove).toHaveBeenLastCalledWith('s2', 'up');
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(onMove).toHaveBeenLastCalledWith('s2', 'down');

    onMove.mockClear();
    screen.getByRole('button', { name: /^Reordenar tarefa Criar API/ }).focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    screen.getByRole('button', { name: /^Reordenar tarefa Escrever testes/ }).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('Remover pede confirmação e só chama onRemove depois dela', async () => {
    const user = userEvent.setup();
    const { onRemove } = setup();

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Escrever testes' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remover' }));
    expect(onRemove).not.toHaveBeenCalled();
    const question = screen.getByRole('group', {
      name: 'Remover a tarefa Escrever testes do plano?',
    });

    await user.click(within(question).getByRole('button', { name: 'Voltar' }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole('group')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Escrever testes' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remover' }));
    await user.click(
      within(
        screen.getByRole('group', { name: 'Remover a tarefa Escrever testes do plano?' }),
      ).getByRole('button', { name: 'Remover' }),
    );
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('s3');
  });

  it('desabilitada, a lista não aceita edição: alça, menu e duplo clique ficam parados', async () => {
    const user = userEvent.setup();
    const { onRename } = setup({ disabled: true });

    expect(screen.getByRole('button', { name: 'Ações da tarefa Criar API' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Reordenar tarefa Criar API/ })).toBeDisabled();
    await user.dblClick(screen.getByText('Criar API'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('só leitura: sem alça nem edição; Ver descrição continua no menu', async () => {
    const user = userEvent.setup();
    setup({ editable: false });

    expect(screen.queryByRole('button', { name: /Reordenar/ })).toBeNull();
    await user.dblClick(screen.getByText('Criar API'));
    expect(screen.queryByRole('textbox')).toBeNull();
    // Só a tarefa com descrição tem menu: as outras não têm nada a oferecer.
    expect(screen.queryByRole('button', { name: 'Ações da tarefa Criar API' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ações da tarefa Montar a tela' }));
    expect(
      within(screen.getByRole('menu'))
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Ver descrição']);
  });

  it.each([
    ['Salvar', 'save'],
    ['Enter no título', 'enter'],
  ] as const)(
    '%s: o foco volta ao ⋯ da linha quando a chamada em curso termina',
    async (_name, how) => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      render(<BusyAfterRename onRename={onRename} />);

      await user.dblClick(screen.getByText('Criar API'));
      await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2');
      if (how === 'save') {
        await user.click(screen.getByRole('button', { name: /^Salvar alterações/ }));
      } else {
        await user.keyboard('{Enter}');
      }

      expect(onRename).toHaveBeenCalledWith('s1', { title: 'Criar API v2' });
      expect(triggerOf('Criar API')).toBeDisabled();
      act(() => finishCall());
      expect(triggerOf('Criar API')).toBeEnabled();
      expect(document.activeElement).toBe(triggerOf('Criar API'));
    },
  );

  it('Salvar, Cancelar e Esc devolvem o foco ao ⋯ da linha', async () => {
    const user = userEvent.setup();
    setup();

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2');
    await user.click(screen.getByRole('button', { name: /^Salvar alterações/ }));
    expect(triggerOf('Criar API')).toHaveFocus();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.click(
      screen.getByRole('button', { name: 'Cancelar renomear tarefa Montar a tela' }),
    );
    expect(triggerOf('Montar a tela')).toHaveFocus();

    await user.dblClick(screen.getByText('Escrever testes'));
    await user.keyboard('{Escape}');
    expect(triggerOf('Escrever testes')).toHaveFocus();
  });

  it('Subir e Descer pelo menu devolvem o foco ao ⋯ depois do estado ocupado', async () => {
    const user = userEvent.setup();
    const { rerender } = setup();

    await user.click(triggerOf('Montar a tela'));
    await user.click(screen.getByRole('menuitem', { name: 'Subir' }));
    rerender(elementOf({ disabled: true }));
    rerender(elementOf({ disabled: true, steps: SWAPPED }));
    rerender(elementOf({ steps: SWAPPED }));
    expect(document.activeElement).toBe(triggerOf('Montar a tela'));

    await user.click(triggerOf('Montar a tela'));
    await user.click(screen.getByRole('menuitem', { name: 'Descer' }));
    rerender(elementOf({ disabled: true, steps: SWAPPED }));
    rerender(elementOf({ disabled: true }));
    rerender(elementOf());
    expect(document.activeElement).toBe(triggerOf('Montar a tela'));
  });

  it('um Subir sem efeito não deixa pedido de foco pendente: o foco da pessoa em outro campo fica onde está', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const { rerender } = render(
      <>
        <input aria-label="Outro campo" />
        {elementOf({ onMove })}
      </>,
    );

    await user.click(triggerOf('Montar a tela'));
    await user.click(screen.getByRole('menuitem', { name: 'Subir' }));
    expect(onMove).toHaveBeenCalledWith('s2', 'up');
    // A chamada não mudou a ordem nem o disabled: a pessoa segue para outro campo.
    const other = screen.getByRole('textbox', { name: 'Outro campo' });
    await user.click(other);
    expect(other).toHaveFocus();

    // Uma mudança qualquer da lista (a ordem) não pode roubar o foco para o ⋯.
    rerender(
      <>
        <input aria-label="Outro campo" />
        {elementOf({ onMove, steps: SWAPPED })}
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Outro campo' })).toHaveFocus();
  });

  it('Alt+seta mantém o foco na alça depois de reordenar, mesmo com a lista ocupada no meio', async () => {
    const user = userEvent.setup();
    const { rerender } = setup();

    screen.getByRole('button', { name: /^Reordenar tarefa Montar a tela/ }).focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    rerender(elementOf({ disabled: true }));
    rerender(elementOf({ disabled: true, steps: SWAPPED }));
    rerender(elementOf({ steps: SWAPPED }));

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /^Reordenar tarefa Montar a tela/ }),
    );
  });

  it('Voltar na remoção devolve o foco ao ⋯ da linha', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(triggerOf('Escrever testes'));
    await user.click(screen.getByRole('menuitem', { name: 'Remover' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(triggerOf('Escrever testes')).toHaveFocus();
  });

  it('fora do estado planejado, o renomear e a remoção abertos se fecham e nada é enviado', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = setup({ onRename, onRemove });

    await user.dblClick(screen.getByText('Criar API'));
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), ' v2');
    rerender(elementOf({ onRename, onRemove, editable: false }));
    expect(screen.queryByRole('textbox')).toBeNull();
    rerender(elementOf({ onRename, onRemove }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();

    await user.click(triggerOf('Escrever testes'));
    await user.click(screen.getByRole('menuitem', { name: 'Remover' }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    rerender(elementOf({ onRename, onRemove, editable: false }));
    expect(screen.queryByRole('group')).toBeNull();
    rerender(elementOf({ onRename, onRemove }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('os limites do título (120) e da descrição (2000) vão no campo', async () => {
    const user = userEvent.setup();
    setup();

    await user.dblClick(screen.getByText('Criar API'));
    expect(screen.getByRole('textbox', { name: /Novo nome/ })).toHaveAttribute('maxlength', '120');
    expect(screen.getByRole('textbox', { name: /Nova descrição/ })).toHaveAttribute(
      'maxlength',
      '2000',
    );
  });

  it('só espaços a mais no título ou na descrição mantém o Salvar desabilitado', async () => {
    const user = userEvent.setup();
    const { onRename } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    const save = screen.getByRole('button', { name: /^Salvar alterações/ });
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), '   ');
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), '   ');
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), 'x');
    expect(save).toBeEnabled();
    await user.clear(screen.getByRole('textbox', { name: /Nova descrição/ }));
    await user.type(
      screen.getByRole('textbox', { name: /Nova descrição/ }),
      'Montar a tela de login com os campos de e-mail e senha.   ',
    );
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Novo nome/ }), '{Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('com a lista ocupada, os dois campos e o Salvar do renomear ficam desabilitados', async () => {
    const user = userEvent.setup();
    const { rerender } = setup();

    await user.dblClick(screen.getByText('Montar a tela'));
    await user.type(screen.getByRole('textbox', { name: /Nova descrição/ }), ' Mais.');
    rerender(elementOf({ disabled: true }));

    expect(screen.getByRole('textbox', { name: /Novo nome/ })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /Nova descrição/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Salvar alterações/ })).toBeDisabled();
  });
});
