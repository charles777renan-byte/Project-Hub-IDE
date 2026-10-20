/** Canais IPC (seção 13.4). O sufixo `:vN` versiona o contrato de cada canal (seção 13.1). */
export const CHANNELS = {
  appPing: 'app:ping:v1',
  projectsList: 'projects:list:v1',
  projectsAdd: 'projects:add:v1',
  projectsChooseDirectory: 'projects:choose-directory:v1',
  missionsCreate: 'missions:create:v1',
  missionsList: 'missions:list:v1',
  missionsGet: 'missions:get:v1',
  missionsPlan: 'missions:plan:v1',
  missionsApprovePlan: 'missions:approve-plan:v1',
  missionsStart: 'missions:start:v1',
  missionsCancel: 'missions:cancel:v1',
  missionsPause: 'missions:pause:v1',
  missionsResume: 'missions:resume:v1',
  /** Nova tentativa de missão `failed` ou `cancelled` (R180). Devolve a tentativa nova. */
  missionsRetry: 'missions:retry:v1',
  missionsProvideInput: 'missions:provide-input:v1',
  /** Evento da missão, do processo principal para o renderer. Não tem resposta. */
  missionsEvent: 'missions:event:v1',
  approvalsDecide: 'approvals:decide:v1',
} as const;
