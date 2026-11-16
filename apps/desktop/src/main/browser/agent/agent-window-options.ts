/** Tamanho da página de um agente enquanto ela vive em segundo plano. */
export const AGENT_PAGE_SIZE = { width: 1280, height: 800 } as const;

/**
 * Opções da janela de apoio: sem moldura, sem foco, fora da barra de tarefas e fora de qualquer monitor. Fica num
 * arquivo só de dados para o teste de ponta a ponta abrir uma janela igual dentro do app construído.
 */
export const SUPPORT_WINDOW_OPTIONS = {
  show: false,
  frame: false,
  focusable: false,
  skipTaskbar: true,
  resizable: false,
  x: -30000,
  y: -30000,
  width: AGENT_PAGE_SIZE.width,
  height: AGENT_PAGE_SIZE.height,
} as const;
