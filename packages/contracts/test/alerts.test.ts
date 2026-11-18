import { describe, expect, it } from 'vitest';
import { alertNotifyInputSchema, alertOpenEventSchema } from '../src/alerts';
import { CHANNELS } from '../src/channels';
import { projectSummarySchema, setProjectMutedInputSchema } from '../src/project';
import { responseSchemas } from '../src/responses';

describe('alertNotifyInputSchema', () => {
  it('aceita uma missão ou um terminal pelo id', () => {
    expect(alertNotifyInputSchema.parse({ kind: 'mission', id: 'm1' })).toEqual({
      kind: 'mission',
      id: 'm1',
    });
    expect(alertNotifyInputSchema.safeParse({ kind: 'terminal', id: 't1' }).success).toBe(true);
  });

  it('recusa outro tipo e id vazio', () => {
    expect(alertNotifyInputSchema.safeParse({ kind: 'session', id: 't1' }).success).toBe(false);
    expect(alertNotifyInputSchema.safeParse({ kind: 'mission', id: '' }).success).toBe(false);
  });

  it('recusa texto: o renderer não escolhe o que a notificação diz', () => {
    expect(
      alertNotifyInputSchema.safeParse({ kind: 'mission', id: 'm1', title: 'x' }).success,
    ).toBe(false);
  });
});

describe('alertOpenEventSchema', () => {
  it('aceita o item com o projeto', () => {
    expect(
      alertOpenEventSchema.safeParse({ kind: 'terminal', projectId: 'p1', id: 't1' }).success,
    ).toBe(true);
    expect(alertOpenEventSchema.safeParse({ kind: 'terminal', id: 't1' }).success).toBe(false);
  });
});

describe('silêncio do projeto', () => {
  it('setProjectMutedInputSchema exige booleano', () => {
    expect(setProjectMutedInputSchema.safeParse({ projectId: 'p1', muted: true }).success).toBe(
      true,
    );
    expect(setProjectMutedInputSchema.safeParse({ projectId: 'p1', muted: 'sim' }).success).toBe(
      false,
    );
  });

  it('projectSummarySchema aceita o projeto com e sem muted', () => {
    const base = {
      id: 'p1',
      name: 'Loja',
      path: 'C:/loja',
      repositoryKind: 'git',
      available: true,
    };
    expect(projectSummarySchema.safeParse({ ...base, muted: true }).success).toBe(true);
    expect(projectSummarySchema.safeParse(base).success).toBe(true);
  });
});

describe('canais dos avisos', () => {
  it('têm nome versionado e resposta vazia nos pedidos', () => {
    expect(CHANNELS.alertsNotify).toBe('alerts:notify:v1');
    expect(CHANNELS.alertsOpen).toBe('alerts:open:v1');
    expect(CHANNELS.terminalsChanged).toBe('terminals:changed:v1');
    expect(CHANNELS.projectsSetMuted).toBe('projects:set-muted:v1');
    expect(
      responseSchemas[CHANNELS.alertsNotify].safeParse({ ok: true, data: undefined }).success,
    ).toBe(true);
    expect(
      responseSchemas[CHANNELS.projectsSetMuted].safeParse({ ok: true, data: undefined }).success,
    ).toBe(true);
  });
});
