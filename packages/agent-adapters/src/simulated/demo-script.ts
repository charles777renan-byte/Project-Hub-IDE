import type { SimulatedStep } from './simulated-adapter';

/**
 * Roteiro fixo do agente simulado (R166): uma mensagem, um arquivo gravado no worktree, um pedido de
 * aprovação, o resultado de uma verificação e uma última mensagem. É a única fonte de agente desta
 * etapa; agentes reais entram depois pelo mesmo contrato (seção 13.5).
 *
 * A verificação é simulada: nenhum comando roda, e o resultado é sempre o mesmo. Ela não informa
 * `criteria`, então nenhum critério de aceite da missão é marcado como verificado.
 */
export const DEMO_SCRIPT: SimulatedStep[] = [
  {
    type: 'emit',
    event: { type: 'message.delta', content: 'Vou aplicar o plano aprovado neste worktree.' },
  },
  {
    type: 'create-file',
    relativePath: 'project-hub-demo.md',
    content: '# Demonstração\n\nArquivo criado pelo agente simulado do Project Hub.\n',
  },
  { type: 'await-approval', description: 'Confirmar a gravação do arquivo de demonstração' },
  {
    type: 'emit',
    event: {
      type: 'verification.completed',
      command: 'pnpm test (simulado)',
      passed: 14,
      failed: 0,
      durationMs: 2300,
      output: 'Resultado simulado: nenhum comando foi executado.',
    },
  },
  {
    type: 'emit',
    event: { type: 'message.delta', content: 'Alteração concluída. Nada mais a fazer.' },
  },
];
