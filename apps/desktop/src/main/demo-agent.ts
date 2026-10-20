import { createSimulatedAdapter, type SimulatedStep } from '@project-hub/agent-adapters';

/**
 * Roteiro fixo do agente simulado (R166): uma mensagem, um arquivo gravado no worktree, um pedido de
 * aprovação e uma última mensagem. É a única fonte de agente desta etapa; agentes reais entram depois
 * pelo mesmo contrato (seção 13.5).
 */
const DEMO_SCRIPT: SimulatedStep[] = [
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
    event: { type: 'message.delta', content: 'Alteração concluída. Nada mais a fazer.' },
  },
];

/** Adaptador do agente simulado com o roteiro de demonstração. */
export function createDemoAgent() {
  return createSimulatedAdapter({ script: DEMO_SCRIPT });
}
