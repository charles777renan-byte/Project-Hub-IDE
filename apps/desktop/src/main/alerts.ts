import type { AlertNotifyInput, AlertOpenEvent } from '@project-hub/contracts';
import type { MissionRepository, ProjectRepository } from '@project-hub/application';
import type { TerminalService } from './terminals';

/** A parte do `Notification` do Electron que o serviço usa. Os testes trocam por um dublê. */
export type AlertNotification = {
  show(): void;
  close(): void;
  on(event: 'click' | 'close', listener: () => void): void;
};

/** A parte da janela principal que o serviço usa. */
export type AlertWindow = {
  isFocused(): boolean;
  isMinimized(): boolean;
  isDestroyed(): boolean;
  flashFrame(flag: boolean): void;
  show(): void;
  restore(): void;
  focus(): void;
};

export type AlertServiceDeps = {
  missions: Pick<MissionRepository, 'getMission'>;
  projects: Pick<ProjectRepository, 'get'>;
  terminals: Pick<TerminalService, 'list'>;
  window: () => AlertWindow | undefined;
  createNotification: (options: { title: string; body: string }) => AlertNotification;
  publishOpen: (event: AlertOpenEvent) => void;
};

export type AlertService = {
  /** Mostra a notificação do item, se ele ainda espera, se o projeto não está silenciado e se a janela está sem foco. */
  notify(input: AlertNotifyInput): Promise<void>;
  /** A janela ganhou o foco: para de piscar. */
  windowFocused(): void;
};

/**
 * Frases fixas do motivo. A notificação nunca leva texto que venha do agente, de um comando ou de um arquivo
 * (RF-OBS-009): só o nome do item, o nome do projeto e uma destas frases.
 */
export const ALERT_REASONS = {
  waiting_approval: 'Pede a sua aprovação',
  waiting_input: 'Fez uma pergunta',
  failed: 'Falhou',
  terminal: 'Aguarda você',
} as const;

type MissionReason = Exclude<keyof typeof ALERT_REASONS, 'terminal'>;

function missionReason(status: string): MissionReason | undefined {
  return status === 'waiting_approval' || status === 'waiting_input' || status === 'failed'
    ? status
    : undefined;
}

/** O que a notificação diz e para onde o clique leva, já conferido contra o estado atual. */
type Alert = { projectId: string; title: string; reason: string };

/**
 * A notificação dos testes de ponta a ponta: guarda o título e o texto em `shown` e não mostra nada. Sem ela, toda
 * suíte que leva uma missão a esperar encheria a área de trabalho e a Central de Ações de quem roda os testes.
 */
export function recordNotifications(
  shown: { title: string; body: string }[],
): AlertServiceDeps['createNotification'] {
  return (options) => ({
    show: () => {
      shown.push({ title: options.title, body: options.body });
    },
    close: () => undefined,
    on: () => undefined,
  });
}

/**
 * Avisos do sistema (RF-OBS-008 a RF-OBS-011). O renderer diz só qual item passou a esperar; o serviço relê o item,
 * porque o renderer pode estar uma leitura atrasado, e monta o texto com os dados daqui. Um aviso novo de um item
 * substitui o anterior desse item: no Windows a notificação vai para a Central de Ações sem um `close` confiável, e
 * esperar por ele deixaria o item mudo.
 */
export function createAlertService(deps: AlertServiceDeps): AlertService {
  const shown = new Map<string, AlertNotification>();

  async function resolve(input: AlertNotifyInput): Promise<Alert | undefined> {
    if (input.kind === 'mission') {
      const mission = deps.missions.getMission(input.id);
      const reason = mission === undefined ? undefined : missionReason(mission.status);
      if (mission === undefined || reason === undefined) return undefined;
      return { projectId: mission.projectId, title: mission.title, reason: ALERT_REASONS[reason] };
    }
    const listed = await deps.terminals.list();
    if (!listed.ok) return undefined;
    const terminal = listed.data.find((item) => item.id === input.id);
    if (
      terminal === undefined ||
      terminal.missionId !== undefined ||
      terminal.state !== 'waiting'
    ) {
      return undefined;
    }
    return { projectId: terminal.projectId, title: terminal.title, reason: ALERT_REASONS.terminal };
  }

  function attentive(win: AlertWindow): boolean {
    return win.isFocused() && !win.isMinimized();
  }

  function open(key: string, event: AlertOpenEvent, notification: AlertNotification): void {
    if (shown.get(key) === notification) shown.delete(key);
    const win = deps.window();
    if (win === undefined || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    deps.publishOpen(event);
  }

  return {
    async notify(input) {
      const before = deps.window();
      if (before === undefined || before.isDestroyed() || attentive(before)) return;
      const alert = await resolve(input);
      if (alert === undefined) return;
      const project = deps.projects.get(alert.projectId);
      if (project === undefined || project.muted === true) return;
      // A leitura dos terminais é assíncrona: a janela pode ter ganhado o foco, ou sumido, nesse meio-tempo.
      const win = deps.window();
      if (win === undefined || win.isDestroyed() || attentive(win)) return;

      const key = `${input.kind}:${input.id}`;
      shown.get(key)?.close();
      const notification = deps.createNotification({
        title: alert.title,
        body: `${project.nickname ?? project.name} · ${alert.reason}`,
      });
      const event: AlertOpenEvent = { kind: input.kind, projectId: alert.projectId, id: input.id };
      notification.on('click', () => open(key, event, notification));
      notification.on('close', () => {
        if (shown.get(key) === notification) shown.delete(key);
      });
      shown.set(key, notification);
      notification.show();
      win.flashFrame(true);
    },
    windowFocused() {
      const win = deps.window();
      if (win !== undefined && !win.isDestroyed()) win.flashFrame(false);
    },
  };
}
