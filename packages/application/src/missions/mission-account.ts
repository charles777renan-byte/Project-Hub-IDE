import type { Mission } from '@project-hub/domain';
import type { AccountDirectory } from '../ports';

/** A frase de toda ação de missão que pede uma conta que já não vale. Nunca vira "rodar na Principal". */
export const ACCOUNT_UNAVAILABLE = 'A conta foi removida.';

/** A conta de uma missão como a tela a mostra. `accountId` nulo é a Principal. */
export type MissionAccountView = {
  accountId: string | null;
  accountName: string;
  /** A conta foi removida: a missão não planeja nem inicia até a pessoa escolher outra. */
  accountRemoved: boolean;
  /**
   * A conta não troca agora: a missão já começou ou está sendo iniciada, ou o plano está sendo gerado. A missão
   * que falhou ou foi cancelada destrava, para a nova tentativa poder rodar em outra conta.
   */
  accountLocked: boolean;
};

export type MissionAccountDeps = {
  accounts: Pick<AccountDirectory, 'labelOf'>;
  /** O plano da missão está sendo gerado agora (o orquestrador sabe). */
  isPlanning(missionId: string): boolean;
  /**
   * A missão tem uma execução em andamento, desde o pedido de início (o orquestrador sabe). O início só é gravado
   * depois de preparar a pasta e abrir o agente; nesse intervalo a conta já foi lida e não pode mudar.
   */
  isRunning(missionId: string): boolean;
};

export function missionAccountOf(
  deps: MissionAccountDeps,
  mission: Pick<Mission, 'id' | 'accountId' | 'startedAt' | 'status'>,
): MissionAccountView {
  const accountId = mission.accountId ?? null;
  const label = deps.accounts.labelOf('claude', accountId);
  // Parada sem volta na mesma tentativa: a próxima abre outra execução, e pode ser em outra conta.
  const stopped = mission.status === 'failed' || mission.status === 'cancelled';
  return {
    accountId,
    accountName: label.name,
    accountRemoved: label.removed,
    accountLocked:
      (mission.startedAt !== undefined && !stopped) ||
      deps.isPlanning(mission.id) ||
      deps.isRunning(mission.id),
  };
}

/** A missão com os campos da conta, na forma que o contrato da tela pede. */
export function withMissionAccount<M extends Mission>(
  deps: MissionAccountDeps,
  mission: M,
): M & MissionAccountView {
  return { ...mission, ...missionAccountOf(deps, mission) };
}
