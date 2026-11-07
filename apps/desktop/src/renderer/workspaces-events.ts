/**
 * Evento da janela disparado quando a lista de workspaces abertos muda (abrir ou fechar uma aba). Quem
 * lê a lista (`useOpenWorkspaces`) ouve e recarrega. Fica num módulo próprio para que quem dispara não
 * dependa de quem ouve.
 */
export const WORKSPACES_CHANGED_EVENT = 'project-hub:workspaces-changed';

/**
 * Pedido de retomada de uma sessão do histórico. A aba Sessões não tem o workspace do projeto, e quem tem
 * (o `useWorkspace` da aba Terminais) ouve este evento e responde pelo próprio layout: grava a resposta em
 * `answer` (`null` = ok; texto = erro). Quem não é o projeto do pedido não responde.
 */
export const RESUME_SESSION_REQUEST_EVENT = 'project-hub:resume-session-request';

/** O aviso quando nenhum workspace do projeto está na tela para receber o pedido. */
export const RESUME_NEEDS_WORKSPACE = 'Abra a aba Terminais do projeto para retomar a sessão.';

export type ResumeSessionRequest = {
  projectId: string;
  sessionId: string;
  answer?: Promise<string | null>;
};

/** Envia o pedido de retomada e devolve a resposta do workspace (ou o aviso, se nenhum respondeu). */
export function requestResumeSession(projectId: string, sessionId: string): Promise<string | null> {
  const request: ResumeSessionRequest = { projectId, sessionId };
  window.dispatchEvent(
    new CustomEvent<ResumeSessionRequest>(RESUME_SESSION_REQUEST_EVENT, { detail: request }),
  );
  return request.answer ?? Promise.resolve(RESUME_NEEDS_WORKSPACE);
}
