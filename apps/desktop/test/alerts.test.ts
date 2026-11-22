import type { TerminalSummary } from '@project-hub/contracts';
import type { Mission, ProjectRecord } from '@project-hub/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createAlertService,
  recordNotifications,
  type AlertNotification,
  type AlertServiceDeps,
  type AlertWindow,
} from '../src/main/alerts';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Corrigir login',
    objective: 'SEGREDO no objetivo',
    context: 'SEGREDO no contexto',
    acceptanceCriteria: [],
    status: 'waiting_approval',
    priority: 'normal',
    agentProfileId: 'a',
    executionProfileId: 'e',
    altersCode: true,
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  } as Mission;
}

function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    name: 'loja',
    path: 'C:/loja',
    normalizedPath: 'c:/loja',
    repositoryKind: 'git',
    isFavorite: false,
    trusted: true,
    createdAt: '2026-11-17T10:00:00.000Z',
    updatedAt: '2026-11-17T10:00:00.000Z',
    nickname: 'Loja',
    ...overrides,
  };
}

function terminal(overrides: Partial<TerminalSummary> = {}): TerminalSummary {
  return {
    id: 't1',
    kind: 'shell',
    title: 'Claude 1',
    projectId: 'p1',
    projectName: 'loja',
    state: 'waiting',
    provider: 'claude',
    origin: 'new',
    startedAt: '2026-11-17T10:00:00.000Z',
    ...overrides,
  } as TerminalSummary;
}

function withoutNickname(): ProjectRecord {
  const { nickname: _nickname, ...rest } = project();
  return rest;
}

type FakeNotification = AlertNotification & {
  options: { title: string; body: string };
  shown: boolean;
  closed: boolean;
  emit(event: 'click' | 'close'): void;
};

function harness(
  options: {
    mission?: Mission | undefined;
    project?: ProjectRecord;
    terminals?: TerminalSummary[];
    focused?: boolean;
    minimized?: boolean;
    vaultWaiting?: (mission: Mission) => boolean;
    now?: Date;
  } = {},
) {
  const notifications: FakeNotification[] = [];
  const opened: unknown[] = [];
  const win = {
    focused: options.focused ?? false,
    minimized: options.minimized ?? true,
    destroyed: false,
    isFocused: () => win.focused,
    isMinimized: () => win.minimized,
    isDestroyed: () => win.destroyed,
    flashFrame: vi.fn(),
    show: vi.fn(),
    restore: vi.fn(),
    focus: vi.fn(),
  };
  const missionValue = 'mission' in options ? options.mission : mission();
  const deps: AlertServiceDeps = {
    missions: { getMission: (id) => (missionValue?.id === id ? missionValue : undefined) },
    projects: { get: (id) => (id === 'p1' ? (options.project ?? project()) : undefined) },
    terminals: { list: () => Promise.resolve({ ok: true, data: options.terminals ?? [] }) },
    window: () => (win.destroyed ? undefined : (win as AlertWindow)),
    createNotification: (notificationOptions) => {
      const listeners = new Map<string, () => void>();
      const created: FakeNotification = {
        options: notificationOptions,
        shown: false,
        closed: false,
        show() {
          created.shown = true;
        },
        close() {
          created.closed = true;
        },
        on(event, listener) {
          listeners.set(event, listener);
        },
        emit(event) {
          listeners.get(event)?.();
        },
      };
      notifications.push(created);
      return created;
    },
    publishOpen: (event) => opened.push(event),
    ...(options.vaultWaiting === undefined ? {} : { vaultWaiting: options.vaultWaiting }),
    ...(options.now === undefined ? {} : { now: () => options.now as Date }),
  };
  return { service: createAlertService(deps), notifications, opened, win };
}

describe('createAlertService', () => {
  it('missão pedindo aprovação, com a janela minimizada: notifica com o título, o projeto e o motivo, e pisca', async () => {
    const { service, notifications, win } = harness();

    await service.notify({ kind: 'mission', id: 'm1' });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.options).toEqual({
      title: 'Corrigir login',
      body: 'Loja · Pede a sua aprovação',
    });
    expect(notifications[0]?.shown).toBe(true);
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it('a pergunta e a falha têm frases próprias, e o projeto sem apelido usa o nome', async () => {
    const question = harness({ mission: mission({ status: 'waiting_input' }) });
    await question.service.notify({ kind: 'mission', id: 'm1' });
    expect(question.notifications[0]?.options.body).toBe('Loja · Fez uma pergunta');

    const failed = harness({
      mission: mission({ status: 'failed' }),
      project: withoutNickname(),
    });
    await failed.service.notify({ kind: 'mission', id: 'm1' });
    expect(failed.notifications[0]?.options.body).toBe('loja · Falhou');
  });

  it('a missão que espera o cofre avisa com a frase do cofre', async () => {
    const waiting = harness({
      mission: mission({ status: 'queued' }),
      vaultWaiting: () => true,
    });
    await waiting.service.notify({ kind: 'mission', id: 'm1' });
    expect(waiting.notifications[0]?.options.body).toBe('Loja · Destranque o cofre para continuar');

    const queued = harness({ mission: mission({ status: 'queued' }), vaultWaiting: () => false });
    await queued.service.notify({ kind: 'mission', id: 'm1' });
    expect(queued.notifications).toHaveLength(0);
  });

  it('não leva nada da missão além do título', async () => {
    const { service, notifications } = harness();

    await service.notify({ kind: 'mission', id: 'm1' });

    const { title, body } = notifications[0]!.options;
    expect(title).not.toContain('SEGREDO');
    expect(body).not.toContain('SEGREDO');
  });

  it('terminal avulso aguardando: notifica com o nome do terminal', async () => {
    const { service, notifications } = harness({ terminals: [terminal()] });

    await service.notify({ kind: 'terminal', id: 't1' });

    expect(notifications[0]?.options).toEqual({ title: 'Claude 1', body: 'Loja · Aguarda você' });
  });

  it.each([
    ['a janela está focada e não minimizada', { focused: true, minimized: false }],
    ['a missão está em revisão', { mission: mission({ status: 'review' }) }],
    ['a missão não existe', { mission: undefined }],
    ['o projeto está silenciado', { project: project({ muted: true }) }],
  ])('não notifica a missão quando %s', async (_name, options) => {
    const { service, notifications, win } = harness(options);

    await service.notify({ kind: 'mission', id: 'm1' });

    expect(notifications).toHaveLength(0);
    expect(win.flashFrame).not.toHaveBeenCalled();
  });

  it.each([
    ['o terminal é de uma missão', terminal({ missionId: 'm1' })],
    ['o terminal está rodando', terminal({ state: 'running' })],
  ])('não notifica o terminal quando %s', async (_name, item) => {
    const { service, notifications } = harness({ terminals: [item] });

    await service.notify({ kind: 'terminal', id: 't1' });

    expect(notifications).toHaveLength(0);
  });

  it('o aviso repetido de um item substitui o anterior', async () => {
    const { service, notifications } = harness();

    await service.notify({ kind: 'mission', id: 'm1' });
    await service.notify({ kind: 'mission', id: 'm1' });

    expect(notifications).toHaveLength(2);
    expect(notifications[0]?.closed).toBe(true);
    expect(notifications[1]?.shown).toBe(true);
    expect(notifications[1]?.closed).toBe(false);
  });

  it('o clique traz a janela e pede para abrir o item', async () => {
    const { service, notifications, opened, win } = harness({ terminals: [terminal()] });
    await service.notify({ kind: 'terminal', id: 't1' });

    notifications[0]?.emit('click');

    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(opened).toEqual([{ kind: 'terminal', projectId: 'p1', id: 't1' }]);
  });

  it('o clique com a janela já destruída não lança erro nem pede para abrir', async () => {
    const { service, notifications, opened, win } = harness();
    await service.notify({ kind: 'mission', id: 'm1' });
    win.destroyed = true;

    expect(() => notifications[0]?.emit('click')).not.toThrow();
    expect(opened).toEqual([]);
  });

  it('windowFocused para de piscar', () => {
    const { service, win } = harness();

    service.windowFocused();

    expect(win.flashFrame).toHaveBeenCalledWith(false);
  });
});

describe('notifyAccountSwitch', () => {
  const NOW = new Date('2026-11-17T12:00:00.000Z');
  const RESET = '2026-11-17T14:10:00.000Z';
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  it('avisa a troca pelo limite com as duas contas e a hora', () => {
    const { service, notifications, win } = harness({
      mission: mission({ status: 'running' }),
      now: NOW,
    });

    service.notifyAccountSwitch({
      missionId: 'm1',
      cause: 'limit',
      fromName: 'Trabalho',
      toName: 'Pessoal',
      resetsAt: RESET,
    });

    expect(notifications.map((item) => item.options)).toEqual([
      {
        title: 'Corrigir login',
        body: `Loja · Limite da conta Trabalho acabou (renova às ${clock(RESET)}). A missão continuou na conta Pessoal.`,
      },
    ]);
    expect(notifications[0]?.shown).toBe(true);
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  it('na abertura da tarefa, diz que a conta está sem limite e onde a missão vai rodar', () => {
    const { service, notifications } = harness({
      mission: mission({ status: 'running' }),
      project: withoutNickname(),
    });

    service.notifyAccountSwitch({
      missionId: 'm1',
      cause: 'opening',
      fromName: 'Trabalho',
      toName: 'Pessoal',
    });

    expect(notifications[0]?.options.body).toBe(
      'loja · A conta Trabalho está sem limite. A missão vai rodar na conta Pessoal.',
    );
  });

  it('o clique abre a missão', () => {
    const { service, notifications, opened } = harness({ mission: mission({ status: 'running' }) });
    service.notifyAccountSwitch({ missionId: 'm1', cause: 'limit', fromName: 'A', toName: 'B' });

    notifications[0]?.emit('click');

    expect(opened).toEqual([{ kind: 'mission', projectId: 'p1', id: 'm1' }]);
  });

  it('não avisa projeto silenciado, janela atenta nem missão que sumiu', () => {
    const notice = { missionId: 'm1', cause: 'limit' as const, fromName: 'A', toName: 'B' };
    const muted = harness({ project: project({ muted: true }) });
    muted.service.notifyAccountSwitch(notice);
    expect(muted.notifications).toEqual([]);

    const focused = harness({ focused: true, minimized: false });
    focused.service.notifyAccountSwitch(notice);
    expect(focused.notifications).toEqual([]);

    const gone = harness({ mission: undefined });
    gone.service.notifyAccountSwitch(notice);
    expect(gone.notifications).toEqual([]);
  });
});

describe('recordNotifications (testes de ponta a ponta)', () => {
  it('guarda o título e o texto de cada notificação mostrada, sem mostrar nada', () => {
    const shown: { title: string; body: string }[] = [];
    const create = recordNotifications(shown);

    const notification = create({ title: 'Revisar', body: 'Loja · Falhou' });
    notification.on('click', () => undefined);
    expect(shown).toEqual([]);
    notification.show();
    notification.close();

    expect(shown).toEqual([{ title: 'Revisar', body: 'Loja · Falhou' }]);
  });
});
