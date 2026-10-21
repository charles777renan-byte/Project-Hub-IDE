import { createSimulatedAdapter, DEMO_SCRIPT } from '@project-hub/agent-adapters';

/** Adaptador do agente simulado com o roteiro de demonstração (`DEMO_SCRIPT`, em agent-adapters). */
export function createDemoAgent() {
  return createSimulatedAdapter({ script: DEMO_SCRIPT });
}
