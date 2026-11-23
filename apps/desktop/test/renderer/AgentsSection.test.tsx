import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentsDto,
  AppResult,
  ExecutionProfileDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { AgentsSection } from '../../src/renderer/components/settings/AgentsSection';

// A seção Agentes: os programas que o app sabe abrir, com o teste de cada um, e os perfis de execução das missões.

const A = '11111111-1111-4111-8111-111111111111';

const ok = <T,>(data: T): Promise<AppResult<T>> => Promise.resolve({ ok: true, data });
const fail = (message: string): Promise<AppResult<never>> =>
  Promise.resolve({
    ok: false,
    error: { code: 'VALIDATION_FAILED', message, retryable: false },
  } as AppResult<never>);

const BUILT_IN: ExecutionProfileDto = {
  id: 'padrao',
  name: 'Padrão do programa',
  builtIn: true,
  isDefault: true,
};
const FAST: ExecutionProfileDto = {
  id: A,
  name: 'Rápido',
  builtIn: false,
  isDefault: false,
  model: 'haiku',
  effort: 'low',
  permissionMode: 'acceptEdits',
};

function dto(profiles: ExecutionProfileDto[] = [BUILT_IN]): AgentsDto {
  return {
    programs: [
      { provider: 'claude', label: 'Claude Code', installed: true, role: 'missions' },
      { provider: 'codex', label: 'Codex', installed: false, role: 'panels' },
    ],
    profiles,
  };
}

function setup(initial: AgentsDto = dto()) {
  let current = initial;
  const agents = {
    get: vi.fn(() => ok(current)),
    testProgram: vi.fn(() => ok({ version: '2.1.330 (Claude Code)' })),
    addProfile: vi.fn(() => ok(FAST)),
    updateProfile: vi.fn(() => ok(undefined)),
    removeProfile: vi.fn(() => ok(undefined)),
    setDefaultProfile: vi.fn(() => ok(undefined)),
  };
  window.projectHub = { agents } as unknown as ProjectHubApi;
  render(<AgentsSection />);
  return {
    agents,
    /** O que a próxima leitura devolve. */
    next(data: AgentsDto) {
      current = data;
    },
  };
}

const programRow = async (name: string) =>
  (await screen.findByText(name, { selector: '.agent-row__name-text' })).closest('li')!;
const profileRow = async (name: string) =>
  (await screen.findByText(name, { selector: '.agent-row__name-text' })).closest('li')!;

async function openMenu(name: string) {
  const row = await profileRow(name);
  await userEvent.click(within(row).getByRole('button', { name: `Mais ações do perfil ${name}` }));
}

afterEach(() => {
  delete (window as { projectHub?: unknown }).projectHub;
});

describe('AgentsSection: programas', () => {
  it('mostra cada programa com o estado e o que ele faz no app', async () => {
    setup();

    const claude = await programRow('Claude Code');
    expect(within(claude).getByText('Instalado')).toBeInTheDocument();
    expect(within(claude).getByText('Missões e painéis')).toBeInTheDocument();

    const codex = await programRow('Codex');
    expect(within(codex).getByText('Não instalado')).toBeInTheDocument();
    expect(within(codex).getByText('Painéis')).toBeInTheDocument();
  });

  it('o programa que não está instalado não tem teste', async () => {
    setup();

    const codex = await programRow('Codex');
    expect(within(codex).queryByRole('button', { name: 'Testar Codex' })).toBeNull();
  });

  it('Testar roda o programa e mostra a versão', async () => {
    const h = setup();

    const claude = await programRow('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Testar Claude Code' }));

    expect(h.agents.testProgram).toHaveBeenCalledWith({ provider: 'claude' });
    expect(await within(claude).findByRole('status')).toHaveTextContent(
      'Respondeu: 2.1.330 (Claude Code)',
    );
  });

  it('o teste que falha diz o motivo na linha do programa', async () => {
    const h = setup();
    h.agents.testProgram.mockReturnValueOnce(fail('Claude Code não respondeu ao teste.'));

    const claude = await programRow('Claude Code');
    await userEvent.click(within(claude).getByRole('button', { name: 'Testar Claude Code' }));

    expect(await within(claude).findByRole('alert')).toHaveTextContent(
      'Claude Code não respondeu ao teste.',
    );
  });
});

describe('AgentsSection: perfis', () => {
  it('lista o perfil embutido e os da pessoa, com o resumo das opções e a marca de padrão', async () => {
    setup(dto([BUILT_IN, FAST]));

    const builtIn = await profileRow('Padrão do programa');
    expect(within(builtIn).getByText('Padrão')).toBeInTheDocument();
    expect(
      within(builtIn).getByText('O Claude Code abre com as opções dele, sem nada fixado.'),
    ).toBeInTheDocument();

    const fast = await profileRow('Rápido');
    expect(within(fast).getByText('Haiku · esforço baixo · Aceitar edições')).toBeInTheDocument();
    expect(within(fast).queryByText('Padrão')).toBeNull();
  });

  it('o perfil embutido não se edita nem se remove', async () => {
    setup(
      dto([
        { ...BUILT_IN, isDefault: false },
        { ...FAST, isDefault: true },
      ]),
    );

    await openMenu('Padrão do programa');

    expect(await screen.findByRole('menuitem', { name: 'Tornar padrão' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Remover perfil' })).toBeNull();
  });

  it('cria um perfil com o nome e as opções escolhidas, e relê a lista', async () => {
    const h = setup();
    await screen.findByText('Padrão do programa', { selector: '.agent-row__name-text' });
    h.next(dto([BUILT_IN, FAST]));

    await userEvent.click(screen.getByRole('button', { name: 'Novo perfil' }));
    const form = screen.getByRole('form', { name: 'Novo perfil de execução' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Nome do perfil' }), 'Rápido');
    await userEvent.click(
      within(within(form).getByRole('radiogroup', { name: 'Modelo' })).getByRole('radio', {
        name: 'Haiku',
      }),
    );
    await userEvent.click(
      within(within(form).getByRole('radiogroup', { name: 'Modo de permissão' })).getByRole(
        'radio',
        { name: 'Aceitar edições' },
      ),
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Criar perfil' }));

    await waitFor(() =>
      expect(h.agents.addProfile).toHaveBeenCalledWith({
        name: 'Rápido',
        model: 'haiku',
        permissionMode: 'acceptEdits',
      }),
    );
    expect(await profileRow('Rápido')).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('cada opção começa em "Padrão", e as setas trocam a escolha', async () => {
    setup();

    await userEvent.click(await screen.findByRole('button', { name: 'Novo perfil' }));
    const effort = screen.getByRole('radiogroup', { name: 'Esforço' });
    const standard = within(effort).getByRole('radio', { name: 'Padrão' });
    expect(standard).toBeChecked();
    expect(standard).toHaveAttribute('tabindex', '0');

    standard.focus();
    await userEvent.keyboard('{ArrowRight}');

    const low = within(effort).getByRole('radio', { name: 'Baixo' });
    expect(low).toBeChecked();
    expect(low).toHaveFocus();
    expect(standard).toHaveAttribute('tabindex', '-1');
  });

  it('a falha ao criar aparece junto do nome, sem fechar o formulário', async () => {
    const h = setup();
    h.agents.addProfile.mockReturnValueOnce(fail('Já existe um perfil com esse nome.'));

    await userEvent.click(await screen.findByRole('button', { name: 'Novo perfil' }));
    const name = screen.getByRole('textbox', { name: 'Nome do perfil' });
    await userEvent.type(name, 'Rápido{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe um perfil com esse nome.',
    );
    expect(name).toHaveValue('Rápido');
    expect(name).toHaveAccessibleDescription('Já existe um perfil com esse nome.');
  });

  it('a falha ao criar pelo botão devolve o foco ao nome, e o Esc ainda fecha o formulário', async () => {
    const h = setup();
    h.agents.addProfile.mockReturnValueOnce(fail('Já existe um perfil com esse nome.'));

    await userEvent.click(await screen.findByRole('button', { name: 'Novo perfil' }));
    const name = screen.getByRole('textbox', { name: 'Nome do perfil' });
    await userEvent.type(name, 'Rápido');
    await userEvent.click(screen.getByRole('button', { name: 'Criar perfil' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe um perfil com esse nome.',
    );
    await waitFor(() => expect(name).toHaveFocus());

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('editar abre o formulário com o perfil e grava as mudanças', async () => {
    const h = setup(dto([BUILT_IN, FAST]));

    await openMenu('Rápido');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const form = screen.getByRole('form', { name: 'Editar o perfil Rápido' });
    expect(within(form).getByRole('textbox', { name: 'Nome do perfil' })).toHaveValue('Rápido');
    expect(
      within(within(form).getByRole('radiogroup', { name: 'Modelo' })).getByRole('radio', {
        name: 'Haiku',
      }),
    ).toBeChecked();

    await userEvent.click(
      within(within(form).getByRole('radiogroup', { name: 'Esforço' })).getByRole('radio', {
        name: 'Padrão',
      }),
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(h.agents.updateProfile).toHaveBeenCalledWith({
        id: A,
        name: 'Rápido',
        model: 'haiku',
        permissionMode: 'acceptEdits',
      }),
    );
  });

  it('tornar padrão manda o id do perfil', async () => {
    const h = setup(dto([BUILT_IN, FAST]));

    await openMenu('Rápido');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tornar padrão' }));

    await waitFor(() => expect(h.agents.setDefaultProfile).toHaveBeenCalledWith({ id: A }));
  });

  it('remover pergunta antes, diz o que acontece com as missões e só então remove', async () => {
    const h = setup(dto([BUILT_IN, FAST]));

    await openMenu('Rápido');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remover perfil' }));

    expect(
      screen.getByText(
        'Remover o perfil Rápido? As missões que o usam voltam ao Padrão do programa.',
      ),
    ).toBeInTheDocument();
    expect(h.agents.removeProfile).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Remover perfil' }));

    await waitFor(() => expect(h.agents.removeProfile).toHaveBeenCalledWith({ id: A }));
  });

  it('Esc fecha o formulário sem enviar', async () => {
    const h = setup();

    await userEvent.click(await screen.findByRole('button', { name: 'Novo perfil' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Nome do perfil' }), 'x{Escape}');

    expect(screen.queryByRole('form')).toBeNull();
    expect(h.agents.addProfile).not.toHaveBeenCalled();
  });
});

describe('AgentsSection: leitura', () => {
  it('a leitura que falha diz isso e deixa tentar de novo', async () => {
    const agents = {
      get: vi.fn().mockReturnValueOnce(fail('x')).mockReturnValue(ok(dto())),
    };
    window.projectHub = { agents } as unknown as ProjectHubApi;
    render(<AgentsSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler os agentes.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await programRow('Claude Code')).toBeInTheDocument();
  });
});
