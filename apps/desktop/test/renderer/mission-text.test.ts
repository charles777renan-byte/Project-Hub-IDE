import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Icons from '../../src/renderer/components/Icon';
import { MISSION_STATUS_VALUES, type MissionEventDto } from '@project-hub/contracts';
import {
  conversationEvents,
  decisionAnnouncement,
  decisionTextOf,
  dependencyText,
  formatTime,
  missionTabCounts,
  needsDecision,
  primaryActionOf,
  ROLE_DESCRIPTIONS,
  roleLabel,
  statusFamily,
  statusIcon,
  statusLabel,
  statusTone,
  stepStatus,
  verificationOutcome,
  verificationSummary,
  worktreeName,
  type MissionStatus,
} from '../../src/renderer/mission-text';

/**
 * Cada estado mantém o seu sentido na cor, igual ao da marca de estado (●◐✓✕○) na barra lateral: lima roda
 * ou concluiu, amarelo (warn) aguarda, vermelho falhou, e a pausa e o resto ficam neutros (muted).
 */
describe('tom dos estados da missão', () => {
  const expected: Record<MissionStatus, ReturnType<typeof statusTone>> = {
    draft: 'muted',
    planned: 'warn',
    queued: 'warn',
    running: 'lime',
    waiting_approval: 'warn',
    waiting_input: 'warn',
    paused: 'muted',
    review: 'warn',
    succeeded: 'lime',
    failed: 'red',
    cancelled: 'muted',
  };

  it.each(Object.entries(expected) as [MissionStatus, string][])('%s é %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});

/**
 * O vocabulário da missão (A6): onze rótulos, um por estado do domínio, e a família de cada um. A cor
 * sai da família: espera da pessoa em âmbar (warn), execução em lima, falha em vermelho, rascunho e
 * pausa em neutro. "Planejando" não é estado: é só o indicador transitório do plano.
 */
describe('vocabulário dos estados da missão', () => {
  const expected: Record<MissionStatus, { label: string; family: string }> = {
    draft: { label: 'Rascunho', family: 'neutral' },
    planned: { label: 'Aguarda aprovação do plano', family: 'waiting' },
    queued: { label: 'Plano aprovado, aguardando início', family: 'waiting' },
    running: { label: 'Em execução', family: 'running' },
    waiting_approval: { label: 'Aguarda sua aprovação', family: 'waiting' },
    waiting_input: { label: 'Aguarda sua resposta', family: 'waiting' },
    paused: { label: 'Pausada', family: 'neutral' },
    review: { label: 'Aguarda sua revisão', family: 'waiting' },
    succeeded: { label: 'Concluída', family: 'done' },
    failed: { label: 'Falhou', family: 'failed' },
    cancelled: { label: 'Cancelada', family: 'neutral' },
  };

  it('há um rótulo para cada um dos onze estados do domínio, e todos são diferentes', () => {
    expect(MISSION_STATUS_VALUES).toHaveLength(11);
    const labels = MISSION_STATUS_VALUES.map((status) => statusLabel(status));
    expect(new Set(labels).size).toBe(11);
    expect(Object.keys(expected).sort()).toEqual([...MISSION_STATUS_VALUES].sort());
  });

  it.each(Object.entries(expected) as [MissionStatus, { label: string; family: string }][])(
    '%s tem o rótulo e a família certos',
    (status, { label, family }) => {
      expect(statusLabel(status)).toBe(label);
      expect(statusFamily(status)).toBe(family);
    },
  );

  it('a cor segue a família: espera em warn, execução e conclusão em lima, falha em red, resto em muted', () => {
    const toneOf = (family: string) => {
      const tones = new Set(
        MISSION_STATUS_VALUES.filter((status) => statusFamily(status) === family).map((status) =>
          statusTone(status),
        ),
      );
      return [...tones];
    };
    expect(toneOf('waiting')).toEqual(['warn']);
    expect(toneOf('running')).toEqual(['lime']);
    expect(toneOf('done')).toEqual(['lime']);
    expect(toneOf('failed')).toEqual(['red']);
    expect(toneOf('neutral')).toEqual(['muted']);
  });

  it('a aprovação do plano e a aprovação de uma ação protegida têm rótulos distintos', () => {
    expect(statusLabel('planned')).toBe('Aguarda aprovação do plano');
    expect(statusLabel('waiting_approval')).toBe('Aguarda sua aprovação');
    expect(statusLabel('planned')).not.toBe(statusLabel('waiting_approval'));
  });
});

/**
 * O ícone de cada estado da missão, num ponto só. O estado `draft` fica sem ícone (o selo mantém o ponto);
 * os que esperam o início dividem o relógio, o que espera uma resposta tem o círculo com interrogação, e
 * o que pede a aprovação tem o escudo.
 */
describe('ícone dos estados da missão', () => {
  const expected: Record<MissionStatus, string | undefined> = {
    draft: undefined,
    planned: 'Clock',
    queued: 'Clock',
    running: 'LoaderCircle',
    waiting_approval: 'ShieldQuestionMark',
    waiting_input: 'CircleQuestionMark',
    paused: 'CirclePause',
    review: 'Eye',
    succeeded: 'CircleCheck',
    failed: 'CircleAlert',
    cancelled: 'CircleSlash',
  };

  it.each(Object.entries(expected) as [MissionStatus, string | undefined][])(
    '%s usa %s',
    (status, name) => {
      const icon = statusIcon(status);
      if (name === undefined) {
        expect(icon).toBeUndefined();
        return;
      }
      // Um nome que o Icon.tsx não exporta daria `undefined` dos dois lados e passaria à toa.
      expect(Icons[name as keyof typeof Icons]).toBeDefined();
      expect(icon).toBe(Icons[name as keyof typeof Icons]);
    },
  );
});

describe('resultado de uma verificação', () => {
  it('verificationOutcome devolve empty quando nenhum teste rodou', () => {
    expect(verificationOutcome({ passed: 0, failed: 0 })).toBe('empty');
    expect(verificationOutcome({ passed: 3, failed: 0 })).toBe('passed');
    expect(verificationOutcome({ passed: 3, failed: 1 })).toBe('failed');
    expect(verificationOutcome({ passed: 0, failed: 2 })).toBe('failed');
  });
});

describe('rótulo dos estados das etapas', () => {
  it.each([
    ['pending', 'Pendente'],
    ['running', 'Em execução'],
    ['blocked', 'Bloqueada'],
    ['succeeded', 'Concluída'],
    ['failed', 'Falhou'],
    ['skipped', 'Ignorada'],
  ] as const)('%s tem o rótulo %s', (status, label) => {
    expect(stepStatus(status).label).toBe(label);
  });
});

describe('tom dos estados das etapas', () => {
  it.each([
    ['pending', 'muted'],
    ['running', 'lime'],
    ['blocked', 'violet'],
    ['succeeded', 'muted'],
    ['failed', 'red'],
    ['skipped', 'muted'],
  ] as const)('%s é %s', (status, tone) => {
    expect(stepStatus(status).tone).toBe(tone);
  });
});

function event(overrides: Partial<MissionEventDto>): MissionEventDto {
  return {
    id: 'ev',
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'message.delta',
    severity: 'info',
    actor: 'agent',
    payload: {},
    sequence: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('ação principal do resumo da missão', () => {
  it.each([
    ['draft', 'generate_plan'],
    ['planned', 'approve_plan'],
    ['queued', 'start'],
    // Esperando a decisão, os controles são os da própria decisão (cartões, resposta, revisão), não uma ação principal.
    ['waiting_approval', undefined],
    ['waiting_input', undefined],
    ['paused', 'resume'],
    ['failed', 'retry'],
    ['cancelled', 'retry'],
    ['running', undefined],
    ['succeeded', undefined],
  ] as const)('%s tem %s', (status, action) => {
    expect(primaryActionOf(status)).toBe(action);
  });
});

describe('verificationSummary', () => {
  const run = (id: string, sequence: number, command: string, passed: number, failed: number) =>
    event({
      id,
      sequence,
      eventType: 'verification.completed',
      payload: { command, passed, failed, durationMs: 10 },
    });

  it('sem verificação nenhuma, nenhum teste rodou', () => {
    expect(verificationSummary([])).toEqual({ kind: 'none' });
    expect(verificationSummary([event({})])).toEqual({ kind: 'none' });
  });

  it('um payload malformado não conta como verificação', () => {
    const broken = event({ eventType: 'verification.completed', payload: { command: 'x' } });
    expect(verificationSummary([broken])).toEqual({ kind: 'none' });
  });

  it('comando que não contou teste algum é uma verificação vazia', () => {
    expect(verificationSummary([run('a', 1, 'pnpm test', 0, 0)])).toEqual({ kind: 'empty' });
  });

  it('vale a última rodada de cada comando, e as rodadas de comandos diferentes somam', () => {
    const summary = verificationSummary([
      run('b', 2, 'pnpm test', 9, 0),
      run('a', 1, 'pnpm test', 3, 2),
      run('c', 3, 'pnpm lint', 1, 1),
    ]);
    expect(summary).toEqual({ kind: 'ran', passed: 10, total: 11, failed: true });
  });

  it('sem falhas, não marca falha', () => {
    expect(verificationSummary([run('a', 1, 'pnpm test', 14, 0)])).toEqual({
      kind: 'ran',
      passed: 14,
      total: 14,
      failed: false,
    });
  });
});

describe('worktreeName', () => {
  it.each([
    ['C:\\Users\\ana\\worktrees\\app\\05d0-criar-arquivo', '05d0-criar-arquivo'],
    ['/home/ana/worktrees/app/05d0-criar-arquivo', '05d0-criar-arquivo'],
    ['C:\\worktrees\\m1\\', 'm1'],
    ['m1', 'm1'],
  ])('%s vira %s', (path, name) => {
    expect(worktreeName(path)).toBe(name);
  });
});

describe('missionTabCounts', () => {
  const run = (passed: number, failed: number) =>
    event({
      eventType: 'verification.completed',
      payload: { command: 'pnpm test', passed, failed, durationMs: 10 },
    });

  it('sem diff e sem verificação, nenhuma aba tem contagem', () => {
    expect(missionTabCounts({ diff: undefined, events: [] })).toEqual({});
  });

  it('Alterações conta os arquivos só quando há algum, e marca a lista cortada com +', () => {
    const counts = (count: number, truncated: boolean) =>
      missionTabCounts({ diff: { count, truncated }, events: [] }).diff;
    expect(counts(0, false)).toBeUndefined();
    expect(counts(1, false)).toEqual({ value: '1', label: '1 arquivo alterado' });
    expect(counts(4, false)).toEqual({ value: '4', label: '4 arquivos alterados' });
    expect(counts(1, true)).toEqual({ value: '1+', label: '1+ arquivos alterados' });
  });

  it('Testes mostra passaram/total só quando a verificação contou testes', () => {
    const tests = (events: MissionEventDto[]) =>
      missionTabCounts({ diff: undefined, events }).tests;
    expect(tests([])).toBeUndefined();
    expect(tests([run(0, 0)])).toBeUndefined();
    expect(tests([run(12, 2)])).toEqual({ value: '12/14', label: '12 de 14 testes passaram' });
  });
});

describe('conversationEvents', () => {
  it('mantém a história da missão e deixa o detalhe técnico para os Logs', () => {
    const types = [
      'mission.created',
      'plan.generated',
      'mission.status_changed',
      'message.delta',
      'input.requested',
      'input.provided',
      'approval.requested',
      'approval.decided',
      'approval.expired',
      'session.completed',
      'execution.interrupted',
      'worktree.created',
      'execution.started',
      'session.started',
      'tool.requested',
      'tool.completed',
      'verification.completed',
      'usage.updated',
    ];
    const kept = conversationEvents(
      types.map((eventType, index) => event({ id: eventType, eventType, sequence: index })),
    ).map((item) => item.eventType);

    // A mudança de situação sai da Conversa: o chip do cabeçalho é o único lugar que mostra a situação.
    expect(kept).not.toContain('mission.status_changed');
    expect(kept).toEqual(types.slice(0, 11).filter((type) => type !== 'mission.status_changed'));
  });
});

/**
 * Os horários dos testes não levam `Z`: são lidos no fuso local, igual ao relógio fixo. Assim a
 * expectativa vale em qualquer fuso, sem fixar `TZ` (o projeto não fixa).
 */
describe('formatTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T15:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra agora para eventos de menos de um minuto', () => {
    expect(formatTime('2026-10-21T14:59:40')).toBe('agora');
  });

  it('mostra há N min para eventos de menos de uma hora', () => {
    expect(formatTime('2026-10-21T14:55:00')).toBe('há 5 min');
  });

  it('mostra só o horário no mesmo dia', () => {
    expect(formatTime('2026-10-21T09:10:00')).toBe('09:10');
  });

  it('mostra data e hora para evento antigo, sem horas relativas', () => {
    expect(formatTime('2026-10-19T14:02:00')).toBe('19/10 14:02');
  });

  it('com exatamente uma hora, já não usa minutos relativos', () => {
    expect(formatTime('2026-10-21T14:00:00')).toBe('14:00');
    expect(formatTime('2026-10-21T14:00:01')).toBe('há 59 min');
  });

  it('um evento de ontem a menos de uma hora ainda mostra há N min', () => {
    vi.setSystemTime(new Date('2026-10-21T00:10:00'));

    expect(formatTime('2026-10-20T23:50:00')).toBe('há 20 min');
  });

  it('um evento de ontem a mais de uma hora mostra a data', () => {
    vi.setSystemTime(new Date('2026-10-21T00:10:00'));

    expect(formatTime('2026-10-20T22:00:00')).toBe('20/10 22:00');
  });

  it('com 40 horas de idade, mostra data e hora e nunca horas relativas', () => {
    expect(formatTime('2026-10-19T23:00:00')).toBe('19/10 23:00');
    expect(formatTime('2026-10-19T23:00:00')).not.toContain('há');
  });

  it('um horário um pouco à frente do relógio (diferença entre máquinas) mostra agora', () => {
    expect(formatTime('2026-10-21T15:00:30')).toBe('agora');
  });

  it('um horário ilegível volta como veio, sem quebrar a tela', () => {
    expect(formatTime('não é data')).toBe('não é data');
  });
});

describe('papel e dependência da tarefa', () => {
  const steps = [
    { id: 'a', position: 1, title: 'A', status: 'pending' as const, agent: 'claude-code' as const },
    { id: 'b', position: 2, title: 'B', status: 'pending' as const, agent: 'claude-code' as const },
    {
      id: 'c',
      position: 3,
      title: 'C',
      status: 'pending' as const,
      agent: 'claude-code' as const,
      dependsOn: ['a', 'b'],
    },
  ];

  it('traduz o papel e deixa vazio quando a etapa não é tarefa', () => {
    expect(roleLabel('database')).toBe('Banco de dados');
    expect(roleLabel(undefined)).toBeUndefined();
  });

  it('descreve as dependências pelo número no plano', () => {
    expect(dependencyText({ ...steps[1]!, dependsOn: ['a'] }, steps)).toBe('depois de 1');
    expect(dependencyText(steps[2]!, steps)).toBe('depois de 1 e 2');
    expect(dependencyText(steps[0]!, steps)).toBeUndefined();
  });

  it('descreve cada papel numa linha, para o cartão do quadro do orquestrador', () => {
    expect(ROLE_DESCRIPTIONS).toEqual({
      frontend: 'Interface e componentes',
      backend: 'APIs e lógica do sistema',
      database: 'Modelagem e consultas',
      docs: 'README e guias de uso',
      qa: 'Testes e verificação',
      general: 'Tarefas gerais',
    });
  });
});

describe('bloco Sua decisão: textos', () => {
  const all: readonly MissionStatus[] = [
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

  it('toda situação tem uma frase, e as da tabela são as da spec', () => {
    for (const status of all) expect(decisionTextOf(status)).not.toBe('');
    expect(decisionTextOf('queued')).toBe(
      'Inicie a missão para o Orquestrador distribuir as tarefas entre os agentes.',
    );
    expect(decisionTextOf('running')).toBe('O Orquestrador está acompanhando as tarefas.');
  });

  it('só aprovação, resposta e revisão esperam uma decisão da pessoa', () => {
    expect(all.filter((status) => needsDecision(status))).toEqual([
      'waiting_approval',
      'waiting_input',
      'review',
    ]);
  });

  it('o anúncio lista uma frase por aprovação pendente, mais a resposta ou a revisão', () => {
    const approval = (title: string) => ({ title }) as never;
    const view = (status: MissionStatus, titles: string[] = []) => ({
      mission: { status } as never,
      pendingApprovals: titles.map(approval),
    });

    expect(decisionAnnouncement(view('running'))).toBe('');
    expect(decisionAnnouncement(view('waiting_approval', ['Gravar', 'Rodar']))).toBe(
      'Aguardando você: aprovação, Gravar. Aguardando você: aprovação, Rodar.',
    );
    expect(decisionAnnouncement(view('waiting_input'))).toBe(
      'Aguardando você: o agente espera uma resposta.',
    );
    expect(decisionAnnouncement(view('review'))).toBe(
      'Aguardando você: a conclusão espera a sua revisão.',
    );
  });
});
