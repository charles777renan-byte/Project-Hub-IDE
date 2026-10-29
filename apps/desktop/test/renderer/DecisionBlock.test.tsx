import { createRef, type ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionViewDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { DecisionBlock } from '../../src/renderer/components/mission/DecisionBlock';

type Status = MissionViewDto['mission']['status'];

const APPROVAL = {
  id: 'ap1',
  missionId: 'm1',
  executionId: 'e1',
  actionType: 'write_outside_worktree' as const,
  title: 'Gravar arquivo',
  rationale: 'O roteiro pediu.',
  affectedResources: ['C:\\app\\x.md'],
  status: 'pending' as const,
  requestedAt: '2026-10-20T09:00:00.000Z',
};

const CONCLUSION = {
  summary: 'Login corrigido.',
  verification: { passed: 12, failed: 0 },
  changedFiles: 3,
  gitState: 'uncommitted' as const,
};

function viewOf(status: Status, rest: Partial<MissionViewDto> = {}): MissionViewDto {
  return {
    mission: {
      id: 'm1',
      projectId: 'p1',
      title: 'Ajustar login',
      objective: 'Corrigir o login',
      status,
      altersCode: false,
      acceptanceCriteria: [],
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
    },
    project: { id: 'p1', name: 'app', path: 'C:\\app', defaultBranch: 'main' },
    steps: [],
    executions: [],
    pendingApprovals: [],
    events: [],
    ...rest,
  };
}

function inputEvent(prompt: string): MissionViewDto['events'][number] {
  return {
    id: 'ev1',
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'input.requested',
    severity: 'info',
    actor: 'agent',
    payload: { request: { id: 'entrada', prompt } },
    sequence: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
  };
}

function verificationEvent(
  id: string,
  sequence: number,
  payload: { command: string; passed: number; failed: number; criteria?: string[] },
  aggregateId = 'e1',
): MissionViewDto['events'][number] {
  return {
    id,
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId,
    eventType: 'verification.completed',
    severity: 'info',
    actor: 'agent',
    payload: { ...payload, durationMs: 5, criteria: payload.criteria ?? [] },
    sequence,
    createdAt: '2026-10-20T09:00:00.000Z',
  };
}

/** A conclusão de uma tentativa (`execution.concluded`): a última delas diz qual execução o resumo usa. */
function concludedEvent(
  id: string,
  sequence: number,
  aggregateId: string,
): MissionViewDto['events'][number] {
  return {
    id,
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId,
    eventType: 'execution.concluded',
    severity: 'info',
    actor: 'agent',
    payload: { changedFiles: 3, gitState: 'uncommitted' },
    sequence,
    createdAt: '2026-10-20T09:00:00.000Z',
  };
}

function handlersOf() {
  return {
    onGeneratePlan: vi.fn(),
    onApprovePlan: vi.fn(),
    onRequestNewPlan: vi.fn(),
    onStart: vi.fn(),
    onResume: vi.fn(),
    onRetry: vi.fn(),
    onDecide: vi.fn(),
    onAnswer: vi.fn(() => Promise.resolve(true)),
    onApproveReview: vi.fn(),
    onRequestChanges: vi.fn(() => Promise.resolve(true)),
  };
}

type Extra = Partial<
  Pick<ComponentProps<typeof DecisionBlock>, 'busy' | 'planning' | 'controlBusy' | 'error'>
>;

function setup(status: Status, props: Extra = {}, rest: Partial<MissionViewDto> = {}) {
  const handlers = handlersOf();
  const utils = render(
    <DecisionBlock
      view={viewOf(status, rest)}
      busy={props.busy ?? false}
      planning={props.planning ?? false}
      controlBusy={props.controlBusy ?? false}
      error={props.error}
      {...handlers}
    />,
  );
  return { handlers, ...utils };
}

function block(): HTMLElement {
  return screen.getByRole('region', { name: 'Sua decisão' });
}

const ALL_STATUS: readonly Status[] = [
  'draft',
  'planned',
  'queued',
  'running',
  'waiting_approval',
  'waiting_input',
  'paused',
  'review',
  'succeeded',
  'failed',
  'cancelled',
];

/** Por situação: a frase do bloco, o botão da ação principal e o comportamento que ele chama. */
const PRIMARY = [
  ['draft', 'Peça ao Orquestrador para montar o plano da missão.', 'Orquestrar', 'onGeneratePlan'],
  ['planned', 'Revise as tarefas e aprove o plano.', 'Aprovar plano', 'onApprovePlan'],
  [
    'queued',
    'Inicie a missão para o Orquestrador distribuir as tarefas entre os agentes.',
    'Iniciar missão',
    'onStart',
  ],
  ['paused', 'A missão está pausada. Retome para continuar.', 'Retomar', 'onResume'],
  ['failed', 'A execução terminou com falha.', 'Tentar de novo', 'onRetry'],
  ['cancelled', 'Missão cancelada.', 'Tentar de novo', 'onRetry'],
] as const;

describe('DecisionBlock: estrutura', () => {
  it('é a região "Sua decisão", nomeada pelo próprio título', () => {
    setup('draft');

    const region = block();
    const title = within(region).getByRole('heading', { level: 2, name: 'Sua decisão' });
    expect(region).toHaveAttribute('aria-labelledby', title.id);
    expect(title.id).not.toBe('');
    expect(region).not.toHaveAttribute('aria-label');
  });

  it.each(ALL_STATUS)('com a missão %s, o bloco tem uma frase além do título', (status) => {
    setup(status);

    const lines = [...block().querySelectorAll('p')].filter(
      (paragraph) => !paragraph.matches('.decision-announce') && paragraph.textContent !== '',
    );
    expect(lines.length).toBeGreaterThan(0);
  });

  it('o bloco recebe o foco (tabIndex -1) pela referência que a página passa', () => {
    const decisionRef = createRef<HTMLElement>();
    const handlers = handlersOf();
    render(
      <DecisionBlock
        view={viewOf('waiting_approval', { pendingApprovals: [APPROVAL] })}
        busy={false}
        planning={false}
        controlBusy={false}
        decisionRef={decisionRef}
        {...handlers}
      />,
    );

    expect(decisionRef.current).toBe(block());
    expect(block()).toHaveAttribute('tabindex', '-1');
  });
});

describe('DecisionBlock: ação principal por situação', () => {
  it.each(PRIMARY)(
    'com a missão %s, mostra "%s", o botão "%s" e ele chama o comportamento',
    async (status, text, label, handler) => {
      const user = userEvent.setup();
      const { handlers } = setup(status);

      expect(within(block()).getByText(text)).toBeInTheDocument();
      await user.click(within(block()).getByRole('button', { name: label }));

      expect(handlers[handler]).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['draft', 1],
    ['queued', 1],
    ['paused', 1],
    ['failed', 1],
    ['cancelled', 1],
  ] as const)('com a missão %s, a única ação é a principal (%i botão)', (status, count) => {
    setup(status);

    expect(screen.getAllByRole('button')).toHaveLength(count);
  });

  it.each(['running', 'succeeded'] as const)(
    'com a missão %s não há ação principal nem botão algum',
    (status) => {
      setup(status);

      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('em execução, diz que o Orquestrador acompanha as tarefas', () => {
    setup('running');

    expect(within(block()).getByText('O Orquestrador está acompanhando as tarefas.')).toBeVisible();
  });

  it('Aprovar plano leva a aparência de decisão', () => {
    setup('planned');

    expect(screen.getByRole('button', { name: 'Aprovar plano' })).toHaveClass('btn-decision');
  });

  it('Orquestrar mostra o aviso da cota, que descreve o botão', () => {
    setup('draft');

    expect(screen.getByRole('button', { name: 'Orquestrar' })).toHaveAccessibleDescription(
      'Planejar usa a cota do seu Claude.',
    );
  });

  it('o aviso da cota não aparece onde não há planejamento', () => {
    setup('queued');

    expect(screen.queryByText('Planejar usa a cota do seu Claude.')).toBeNull();
  });

  it('enquanto planeja, o Orquestrar mostra "Planejando…" e fica desabilitado', () => {
    setup('draft', { busy: true, planning: true });

    expect(screen.getByRole('button', { name: 'Planejando…' })).toBeDisabled();
  });

  it.each([
    ['queued', 'Iniciar missão'],
    ['failed', 'Tentar de novo'],
    ['draft', 'Orquestrar'],
  ] as const)('com uma chamada longa em curso, a missão %s desabilita "%s"', (status, label) => {
    setup(status, { busy: true });

    expect(screen.getByRole('button', { name: label })).toBeDisabled();
  });

  it('Retomar segue o bloqueio dos controles, não o das chamadas longas', () => {
    setup('paused', { busy: true });

    expect(screen.getByRole('button', { name: 'Retomar' })).toBeEnabled();
  });

  it('Retomar fica desabilitado com um controle em curso', () => {
    setup('paused', { controlBusy: true });

    expect(screen.getByRole('button', { name: 'Retomar' })).toBeDisabled();
  });
});

describe('DecisionBlock: plano gerado', () => {
  it('mostra Aprovar plano, a instrução opcional e Planejar de novo, com a frase de segurança', () => {
    setup('planned');

    const region = block();
    expect(within(region).getByRole('button', { name: 'Aprovar plano' })).toBeEnabled();
    expect(within(region).getByRole('button', { name: 'Planejar de novo' })).toBeEnabled();
    expect(
      within(region).getByRole('textbox', { name: 'Instrução para o novo plano' }),
    ).toBeInTheDocument();
    expect(within(region).getByText('Opcional. Diga o que o plano novo deve mudar.')).toBeVisible();
    expect(within(region).getByText('Nada muda no código antes da sua aprovação.')).toBeVisible();
  });

  it('a frase de segurança não aparece fora do plano gerado', () => {
    setup('queued');

    expect(screen.queryByText('Nada muda no código antes da sua aprovação.')).toBeNull();
  });

  it('Planejar de novo envia a instrução aparada e mostra o aviso da cota', async () => {
    const user = userEvent.setup();
    const { handlers } = setup('planned');

    expect(screen.getByText('Planejar usa a cota do seu Claude.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Planejar de novo' })).toHaveAccessibleDescription(
      'Planejar usa a cota do seu Claude.',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Instrução para o novo plano' }),
      '  Separe o banco da API  ',
    );
    await user.click(screen.getByRole('button', { name: 'Planejar de novo' }));

    expect(handlers.onRequestNewPlan).toHaveBeenCalledTimes(1);
    expect(handlers.onRequestNewPlan).toHaveBeenCalledWith('Separe o banco da API');
    expect(handlers.onApprovePlan).not.toHaveBeenCalled();
    expect(handlers.onGeneratePlan).not.toHaveBeenCalled();
  });

  it('sem instrução, Planejar de novo envia texto vazio (nunca o evento do clique)', async () => {
    const user = userEvent.setup();
    const { handlers } = setup('planned');

    await user.click(screen.getByRole('button', { name: 'Planejar de novo' }));

    expect(handlers.onRequestNewPlan).toHaveBeenCalledWith('');
  });

  it('a instrução aceita até 1000 caracteres, o limite do contrato', () => {
    setup('planned');

    expect(screen.getByRole('textbox', { name: 'Instrução para o novo plano' })).toHaveAttribute(
      'maxlength',
      '1000',
    );
  });

  it('enquanto planeja, o botão mostra "Planejando…" e fica desabilitado, com Aprovar plano também', () => {
    setup('planned', { busy: true, planning: true });

    expect(screen.getByRole('button', { name: 'Planejando…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Planejar de novo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aprovar plano' })).toBeDisabled();
  });

  it('com uma chamada em curso, Planejar de novo fica desabilitado', async () => {
    const user = userEvent.setup();
    const { handlers } = setup('planned', { busy: true });

    const button = screen.getByRole('button', { name: 'Planejar de novo' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(handlers.onRequestNewPlan).not.toHaveBeenCalled();
  });

  it('com erro de planejamento, Planejar de novo e Aprovar plano continuam disponíveis', () => {
    setup('planned', { error: 'O Claude não respondeu a tempo.' });

    expect(screen.getByRole('button', { name: 'Planejar de novo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Aprovar plano' })).toBeEnabled();
  });
});

describe('DecisionBlock: aprovações do agente', () => {
  it('o cartão da aprovação pendente mora no bloco, uma vez só, e a decisão vai para onDecide', async () => {
    const user = userEvent.setup();
    const { handlers } = setup('waiting_approval', {}, { pendingApprovals: [APPROVAL] });

    const card = within(block()).getByRole('region', { name: 'Gravar arquivo' });
    expect(screen.getAllByRole('region', { name: 'Gravar arquivo' })).toHaveLength(1);
    await user.click(within(card).getByRole('button', { name: 'Aprovar' }));
    await user.click(within(card).getByRole('button', { name: 'Recusar' }));

    expect(handlers.onDecide).toHaveBeenNthCalledWith(1, 'ap1', 'approved');
    expect(handlers.onDecide).toHaveBeenNthCalledWith(2, 'ap1', 'rejected');
  });

  it('com uma chamada em curso, os botões do cartão ficam desabilitados', () => {
    setup('waiting_approval', { busy: true }, { pendingApprovals: [APPROVAL] });

    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeDisabled();
  });

  it('sem aprovação pendente, o bloco não tem cartão', () => {
    setup('running');

    expect(screen.queryByText('Aprovação necessária')).toBeNull();
  });
});

describe('DecisionBlock: resposta ao agente', () => {
  it('a pergunta do agente nomeia a caixa; enviar chama onAnswer com o texto aparado e limpa a caixa', async () => {
    const user = userEvent.setup();
    const { handlers } = setup(
      'waiting_input',
      {},
      { events: [inputEvent('Qual o nome do arquivo?')] },
    );

    const form = within(block()).getByRole('form', { name: 'Resposta ao agente' });
    const answer = within(form).getByLabelText('Qual o nome do arquivo?');
    const send = within(form).getByRole('button', { name: 'Enviar resposta' });
    expect(send).toBeDisabled();
    await user.type(answer, '  notas.md  ');
    await user.click(send);

    expect(handlers.onAnswer).toHaveBeenCalledWith('notas.md');
    await vi.waitFor(() => expect(answer).toHaveValue(''));
  });

  it('se o envio falha (onAnswer devolve false), a resposta digitada continua na caixa', async () => {
    const user = userEvent.setup();
    const { handlers } = setup(
      'waiting_input',
      {},
      { events: [inputEvent('Qual o nome do arquivo?')] },
    );
    handlers.onAnswer.mockResolvedValueOnce(false);

    const answer = screen.getByLabelText('Qual o nome do arquivo?');
    await user.type(answer, 'notas.md');
    await user.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    expect(handlers.onAnswer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveValue('notas.md');
  });

  it('sem pergunta registrada, a caixa leva o texto padrão', () => {
    setup('waiting_input');

    expect(screen.getByLabelText('O agente aguarda a sua resposta.')).toBeInTheDocument();
  });

  it('com uma chamada em curso, Enviar resposta fica desabilitado', async () => {
    const user = userEvent.setup();
    setup('waiting_input', { busy: true });

    await user.type(screen.getByLabelText('O agente aguarda a sua resposta.'), 'x');
    expect(screen.getByRole('button', { name: 'Enviar resposta' })).toBeDisabled();
  });

  it('a referência da caixa recebe o textarea', () => {
    const answerRef = createRef<HTMLTextAreaElement>();
    const handlers = handlersOf();
    render(
      <DecisionBlock
        view={viewOf('waiting_input')}
        busy={false}
        planning={false}
        controlBusy={false}
        answerRef={answerRef}
        {...handlers}
      />,
    );

    expect(answerRef.current).toBe(screen.getByLabelText('O agente aguarda a sua resposta.'));
  });

  it('fora de waiting_input não há caixa de resposta', () => {
    setup('running');

    expect(screen.queryByRole('form', { name: 'Resposta ao agente' })).toBeNull();
  });
});

describe('DecisionBlock: revisão da conclusão', () => {
  it('mostra o resumo, Aprovar conclusão e Pedir ajustes, e aprovar chama onApproveReview', async () => {
    const user = userEvent.setup();
    const { handlers } = setup('review', {}, { conclusion: CONCLUSION });

    const region = block();
    expect(
      within(within(region).getByRole('region', { name: 'Resumo da conclusão' })).getByText(
        'Login corrigido.',
      ),
    ).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Aprovar conclusão' }));

    expect(handlers.onApproveReview).toHaveBeenCalledTimes(1);
  });

  it('Pedir ajustes exige texto e envia o pedido aparado; a caixa limpa quando aceito', async () => {
    const user = userEvent.setup();
    const { handlers } = setup('review');

    const form = within(block()).getByRole('form', { name: 'Pedir ajustes' });
    const adjust = within(form).getByRole('button', { name: 'Pedir ajustes' });
    expect(adjust).toBeDisabled();
    const field = within(form).getByLabelText('O que ajustar');
    await user.type(field, '  Trocar a função  ');
    await user.click(adjust);

    expect(handlers.onRequestChanges).toHaveBeenCalledWith('Trocar a função');
    await vi.waitFor(() => expect(field).toHaveValue(''));
  });

  it('se o pedido não é aceito, o texto continua na caixa', async () => {
    const user = userEvent.setup();
    const { handlers } = setup('review');
    handlers.onRequestChanges.mockResolvedValueOnce(false);

    const field = screen.getByLabelText('O que ajustar');
    await user.type(field, 'Trocar a função');
    await user.click(screen.getByRole('button', { name: 'Pedir ajustes' }));

    expect(handlers.onRequestChanges).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue('Trocar a função');
  });

  it('com uma chamada em curso, Aprovar conclusão e Pedir ajustes ficam desabilitados', async () => {
    const user = userEvent.setup();
    setup('review', { busy: true });

    await user.type(screen.getByLabelText('O que ajustar'), 'x');
    expect(screen.getByRole('button', { name: 'Aprovar conclusão' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pedir ajustes' })).toBeDisabled();
  });

  it('fora da revisão não há Aprovar conclusão nem Pedir ajustes', () => {
    setup('running');

    expect(screen.queryByRole('button', { name: 'Aprovar conclusão' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Pedir ajustes' })).toBeNull();
  });
});

describe('DecisionBlock: resumo da conclusão', () => {
  const SUMMARY = { name: 'Resumo da conclusão' };

  const UNCOMMITTED =
    'Há alterações sem commit na pasta da missão. Elas ainda não entraram no projeto.';
  const CLEAN = 'O trabalho está salvo na branch da missão. Ainda não entrou no projeto.';

  it('missão concluída mostra a frase final do agente e o próximo passo, com alterações sem commit', () => {
    setup('succeeded', {}, { conclusion: CONCLUSION });

    const summary = within(block()).getByRole('region', SUMMARY);
    expect(within(summary).getByText('Login corrigido.')).toBeInTheDocument();
    expect(within(summary).getByText(UNCOMMITTED)).toBeInTheDocument();
    expect(within(summary).queryByText(/Git:/)).toBeNull();
  });

  it('com o estado do Git limpo, o próximo passo diz que o trabalho está salvo na branch', () => {
    setup('succeeded', {}, { conclusion: { ...CONCLUSION, changedFiles: 0, gitState: 'clean' } });

    const summary = within(block()).getByRole('region', SUMMARY);
    expect(within(summary).getByText(CLEAN)).toBeInTheDocument();
    expect(within(summary).queryByText(UNCOMMITTED)).toBeNull();
    expect(summary.textContent).not.toMatch(/worktree/i);
  });

  it('o resumo não lista os arquivos alterados', () => {
    setup('succeeded', {}, { conclusion: CONCLUSION });

    const summary = within(block()).getByRole('region', SUMMARY);
    expect(within(summary).queryByText(/arquivo/)).toBeNull();
  });

  it('a linha de testes diz quantos passaram, sem falhas quando não há nenhuma', () => {
    setup('succeeded', {}, { conclusion: CONCLUSION });

    const summary = within(block()).getByRole('region', SUMMARY);
    expect(within(summary).getByText('Testes: 12 passaram')).toBeInTheDocument();
    expect(within(summary).queryByText(/falharam/)).toBeNull();
  });

  it('a linha de testes diz quantos falharam quando há falhas', () => {
    setup(
      'succeeded',
      {},
      { conclusion: { ...CONCLUSION, verification: { passed: 12, failed: 2 } } },
    );

    expect(screen.getByText('Testes: 12 passaram, 2 falharam')).toBeInTheDocument();
  });

  it('sem verificação registrada, a linha de testes diz isso', () => {
    setup(
      'succeeded',
      {},
      {
        conclusion: {
          summary: 'Login corrigido.',
          changedFiles: 3,
          gitState: 'uncommitted',
        },
      },
    );

    expect(screen.getByText('Testes: nenhuma verificação registrada.')).toBeInTheDocument();
  });

  it('a linha de critérios conta só os critérios da missão comprovados por verificação que passou', () => {
    setup(
      'succeeded',
      {},
      {
        mission: {
          ...viewOf('succeeded').mission,
          acceptanceCriteria: [
            { id: 'c1', position: 1, text: 'Login funciona' },
            { id: 'c2', position: 2, text: 'Logout funciona' },
            { id: 'c3', position: 3, text: 'Senha expira' },
          ],
        },
        conclusion: CONCLUSION,
        events: [
          // Texto com espaços nas bordas: conta depois de aparado.
          verificationEvent('v1', 1, {
            command: 'pnpm test',
            passed: 3,
            failed: 0,
            criteria: ['  Login funciona  '],
          }),
          // Com falha: não comprova.
          verificationEvent('v2', 2, {
            command: 'pnpm lint',
            passed: 2,
            failed: 1,
            criteria: ['Senha expira'],
          }),
          // Texto que não é critério da missão: não entra na conta.
          verificationEvent('v3', 3, {
            command: 'pnpm build',
            passed: 1,
            failed: 0,
            criteria: ['Critério fora da missão'],
          }),
        ],
      },
    );

    expect(screen.getByText('Critérios: 1 de 3 verificados.')).toBeInTheDocument();
  });

  it('sem verificação, a linha de critérios mostra zero verificados', () => {
    setup(
      'succeeded',
      {},
      {
        mission: {
          ...viewOf('succeeded').mission,
          acceptanceCriteria: [
            { id: 'c1', position: 1, text: 'Login funciona' },
            { id: 'c2', position: 2, text: 'Logout funciona' },
          ],
        },
        conclusion: CONCLUSION,
      },
    );

    expect(screen.getByText('Critérios: 0 de 2 verificados.')).toBeInTheDocument();
  });

  it('o critério verificado numa tentativa anterior não conta na conclusão de outra execução', () => {
    const twoAttempts = {
      mission: {
        ...viewOf('review').mission,
        acceptanceCriteria: [
          { id: 'c1', position: 1, text: 'Login funciona' },
          { id: 'c2', position: 2, text: 'Logout funciona' },
        ],
      },
      // A tentativa 1 passa e comprova o primeiro critério; a tentativa 2 conclui sem verificação.
      conclusion: { summary: 'Login corrigido.', changedFiles: 3, gitState: 'uncommitted' as const },
      events: [
        verificationEvent('v1', 1, { command: 'pnpm test', passed: 3, failed: 0, criteria: ['Login funciona'] }),
        concludedEvent('k1', 2, 'e1'),
        concludedEvent('k2', 3, 'e2'),
      ],
    };
    setup('review', {}, twoAttempts);

    const summary = within(block()).getByRole('region', { name: 'Resumo da conclusão' });
    expect(within(summary).getByText('Testes: nenhuma verificação registrada.')).toBeInTheDocument();
    expect(within(summary).getByText('Critérios: 0 de 2 verificados.')).toBeInTheDocument();
  });

  it('na conclusão de uma execução, conta a verificação dela e não a de outra tentativa', () => {
    setup(
      'review',
      {},
      {
        mission: {
          ...viewOf('review').mission,
          acceptanceCriteria: [
            { id: 'c1', position: 1, text: 'Login funciona' },
            { id: 'c2', position: 2, text: 'Logout funciona' },
          ],
        },
        conclusion: { summary: 'Login corrigido.', changedFiles: 3, gitState: 'uncommitted' },
        events: [
          verificationEvent('v1', 1, { command: 'pnpm test', passed: 3, failed: 0, criteria: ['Login funciona'] }),
          concludedEvent('k1', 2, 'e1'),
          // A tentativa 2 é a que concluiu: a verificação dela comprova o segundo critério.
          verificationEvent(
            'v2',
            3,
            { command: 'pnpm test', passed: 4, failed: 0, criteria: ['Logout funciona'] },
            'e2',
          ),
          concludedEvent('k2', 4, 'e2'),
        ],
      },
    );

    expect(screen.getByText('Critérios: 1 de 2 verificados.')).toBeInTheDocument();
  });

  it('com zero testes contados, a linha de testes não mostra "0 passaram"', () => {
    setup(
      'succeeded',
      {},
      { conclusion: { ...CONCLUSION, verification: { passed: 0, failed: 0 } } },
    );

    const summary = within(block()).getByRole('region', { name: 'Resumo da conclusão' });
    expect(within(summary).getByText('Testes: nenhum teste contado.')).toBeInTheDocument();
    expect(within(summary).queryByText(/0 passaram/)).toBeNull();
  });

  it('sem critério na missão, a linha de critérios não aparece', () => {
    setup('succeeded', {}, { conclusion: CONCLUSION });

    const summary = within(block()).getByRole('region', { name: 'Resumo da conclusão' });
    expect(within(summary).queryByText(/Critérios:/)).toBeNull();
    expect(within(summary).getByText('Testes: 12 passaram')).toBeInTheDocument();
  });

  it('o texto vindo do agente entra como texto, não como HTML', () => {
    setup(
      'succeeded',
      {},
      { conclusion: { ...CONCLUSION, summary: '<img src=x onerror=alert(1)> pronto' } },
    );

    const summary = within(block()).getByRole('region', SUMMARY);
    expect(summary.querySelector('img')).toBeNull();
    expect(within(summary).getByText('<img src=x onerror=alert(1)> pronto')).toBeInTheDocument();
  });

  it.each(['cancelled', 'failed', 'running', 'planned'] as const)(
    'missão %s não mostra o resumo, mesmo que chegue um',
    (status) => {
      setup(status, {}, { conclusion: CONCLUSION });

      expect(screen.queryByRole('region', SUMMARY)).toBeNull();
      expect(screen.queryByText('Login corrigido.')).toBeNull();
    },
  );

  it('missão concluída sem resumo (missão antiga) mostra só a frase da situação', () => {
    setup('succeeded');

    expect(screen.queryByRole('region', SUMMARY)).toBeNull();
    expect(within(block()).getByText('Missão concluída.')).toBeInTheDocument();
  });
});

describe('DecisionBlock: falha de uma ação', () => {
  it.each(ALL_STATUS)(
    'com a missão %s, o erro da ação aparece como alerta dentro do bloco',
    (status) => {
      setup(status, { error: 'A ação falhou.' });

      const alert = within(block()).getByRole('alert');
      expect(alert).toHaveTextContent('A ação falhou.');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    },
  );

  it('o alerta fica junto dos botões, depois deles', () => {
    setup('queued', { error: 'Não foi possível criar o worktree da missão.' });

    const button = screen.getByRole('button', { name: 'Iniciar missão' });
    const alert = screen.getByRole('alert');
    expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sem erro, não há alerta', () => {
    setup('queued');

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('DecisionBlock: aviso para o leitor de tela', () => {
  function announce(): HTMLElement {
    const region = document.querySelector<HTMLElement>('[role="status"].decision-announce');
    if (region === null) throw new Error('A região de anúncio não existe.');
    return region;
  }

  it('a região de anúncio já existe, educada e vazia, sem decisão pendente', () => {
    setup('running');

    const region = announce();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    expect(block()).toContainElement(region);
  });

  it('a região é escondida só visualmente (o leitor de tela a lê)', () => {
    setup('waiting_approval', {}, { pendingApprovals: [APPROVAL] });

    expect(announce()).toHaveClass('visually-hidden');
  });

  it('com uma aprovação pendente, anuncia o título dela', () => {
    setup('waiting_approval', {}, { pendingApprovals: [APPROVAL] });

    expect(announce()).toHaveTextContent('Aguardando você: aprovação, Gravar arquivo.');
  });

  it('com o agente pedindo resposta, anuncia a resposta', () => {
    setup('waiting_input');

    expect(announce()).toHaveTextContent('Aguardando você: o agente espera uma resposta.');
  });

  it('em revisão, anuncia a revisão', () => {
    setup('review');

    expect(announce()).toHaveTextContent('Aguardando você: a conclusão espera a sua revisão.');
  });

  it.each(['draft', 'planned', 'queued', 'running', 'paused', 'succeeded', 'failed'] as const)(
    'com a missão %s e nada pendente, nada é anunciado',
    (status) => {
      setup(status);

      expect(announce()).toBeEmptyDOMElement();
    },
  );

  it('a decisão que chega entra na mesma região, sem ela ser refeita', () => {
    const handlers = handlersOf();
    const props = { busy: false, planning: false, controlBusy: false, ...handlers };
    const { rerender } = render(<DecisionBlock view={viewOf('running')} {...props} />);
    const region = announce();
    expect(region).toBeEmptyDOMElement();

    rerender(
      <DecisionBlock
        view={viewOf('waiting_approval', { pendingApprovals: [APPROVAL] })}
        {...props}
      />,
    );

    expect(announce()).toBe(region);
    expect(region).toHaveTextContent('Aguardando você: aprovação, Gravar arquivo.');
  });
});
