import { describe, expect, it } from 'vitest';
import * as Icons from '../../src/renderer/components/Icon';
import type { MissionEventDto } from '@project-hub/contracts';
import {
  conversationEvents,
  missionTabCounts,
  primaryActionOf,
  statusIcon,
  statusTone,
  stepStatus,
  verificationOutcome,
  verificationSummary,
  worktreeName,
  type MissionStatus,
} from '../../src/renderer/mission-text';

/**
 * Cada estado mantém o seu sentido na cor, igual ao da marca de estado (●◐✓✕○) na barra lateral: lima roda
 * ou concluiu, amarelo (warn) aguarda, vermelho falhou, laranja pausou (aparência neutra), e o resto fica
 * neutro (muted).
 */
describe('tom dos estados da missão', () => {
  const expected: Record<MissionStatus, ReturnType<typeof statusTone>> = {
    draft: 'muted',
    planned: 'warn',
    queued: 'warn',
    running: 'lime',
    waiting_approval: 'warn',
    waiting_input: 'warn',
    paused: 'orange',
    succeeded: 'lime',
    failed: 'red',
    cancelled: 'muted',
  };

  it.each(Object.entries(expected) as [MissionStatus, string][])('%s é %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
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
    // Esperando a decisão, o banner "Aguardando você" é o único convite: o resumo não tem ação principal.
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
  const step = (id: string) => ({ id, position: 1, title: id, status: 'pending' as const });
  const run = (passed: number, failed: number) =>
    event({
      eventType: 'verification.completed',
      payload: { command: 'pnpm test', passed, failed, durationMs: 10 },
    });

  it('sem plano, sem diff e sem verificação, nenhuma aba tem contagem', () => {
    expect(missionTabCounts({ steps: [], diff: undefined, events: [] })).toEqual({});
  });

  it('Plano conta as etapas, no singular e no plural', () => {
    expect(missionTabCounts({ steps: [step('a')], diff: undefined, events: [] }).plan).toEqual({
      value: '1',
      label: '1 etapa',
    });
    expect(
      missionTabCounts({ steps: [step('a'), step('b')], diff: undefined, events: [] }).plan,
    ).toEqual({ value: '2', label: '2 etapas' });
  });

  it('Diff conta os arquivos só quando há algum, e marca a lista cortada com +', () => {
    const counts = (count: number, truncated: boolean) =>
      missionTabCounts({ steps: [], diff: { count, truncated }, events: [] }).diff;
    expect(counts(0, false)).toBeUndefined();
    expect(counts(1, false)).toEqual({ value: '1', label: '1 arquivo alterado' });
    expect(counts(4, false)).toEqual({ value: '4', label: '4 arquivos alterados' });
    expect(counts(1, true)).toEqual({ value: '1+', label: '1+ arquivos alterados' });
  });

  it('Testes mostra passaram/total só quando a verificação contou testes', () => {
    const tests = (events: MissionEventDto[]) =>
      missionTabCounts({ steps: [], diff: undefined, events }).tests;
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

    expect(kept).toEqual(types.slice(0, 11));
  });
});
