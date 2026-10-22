import type { ClaudeHooks } from '@project-hub/agent-adapters';
import type { TerminalHostClient } from '../terminal-host/client';

type HookRecord = Awaited<ReturnType<ClaudeHooks['readAfter']>>[number];

/**
 * Receptor de hooks do processo de terminais, visto do app: registrar a execução, soltá-la e ler os
 * eventos por posição, tudo pelo pipe. Reabre a conexão quando ela cai.
 */
export function createRemoteHooks(connect: () => Promise<TerminalHostClient>): ClaudeHooks {
  let client: TerminalHostClient | undefined;

  async function call(body: Parameters<TerminalHostClient['request']>[0]) {
    if (client === undefined || client.isClosed) client = await connect();
    return client.request(body);
  }

  return {
    async registerExecution(executionId) {
      const data = await call({ type: 'hook.register', executionId });
      if (typeof data['token'] !== 'string' || typeof data['url'] !== 'string') {
        throw new Error('resposta de registro de hook fora do formato');
      }
      return { token: data['token'], url: data['url'] };
    },
    async unregisterExecution(executionId) {
      await call({ type: 'hook.unregister', executionId });
    },
    async readAfter(executionId, afterSeq) {
      const data = await call({ type: 'hook.read', executionId, afterSeq });
      return Array.isArray(data['records']) ? (data['records'] as HookRecord[]) : [];
    },
  };
}
