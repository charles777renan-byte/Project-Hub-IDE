import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from '@project-hub/agent-sdk';

/** Eventos de hook que o Claude Code dispara e que o app grava. */
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'Stop',
  'Notification',
  'PreToolUse',
  'PostToolUse',
] as const;

/** Um evento de hook gravado pelo receptor do processo de terminais. */
export type HookRecord = {
  seq: number;
  receivedAt: string;
  payload: Record<string, unknown>;
};

const HOOK_SCRIPT_NAME = 'project-hub-hook.cjs';

/**
 * Script que cada hook executa. Lê o JSON do evento pela entrada padrão e envia ao receptor do app, com
 * o endereço e o token que o terminal recebeu pelo ambiente. Nunca falha: um erro sai com código 0, para
 * o hook não travar nem derrubar o agente.
 */
export const HOOK_SCRIPT_SOURCE = `// Hook do Project Hub: envia o evento do Claude Code ao receptor do app.
// Qualquer erro sai com código 0: o hook não pode travar nem derrubar o agente.
const http = require('node:http');

try {
  const url = new URL(process.env.PROJECT_HUB_HOOK_URL);
  const token = process.env.PROJECT_HUB_HOOK_TOKEN || '';
  let body = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    body += chunk;
  });
  process.stdin.on('end', () => {
    const request = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 3000,
      },
      (response) => {
        response.resume();
        response.on('end', () => process.exit(0));
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => process.exit(0));
    request.end(body);
  });
} catch {
  process.exit(0);
}
`;

/**
 * Grava o script de hook na pasta de configuração e devolve o caminho dele. Regrava a cada chamada, para
 * o conteúdo acompanhar a versão do app.
 */
export function writeHookScript(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, HOOK_SCRIPT_NAME);
  writeFileSync(file, HOOK_SCRIPT_SOURCE, 'utf8');
  return file;
}

/**
 * Comando de um hook. O caminho sai com barras normais e vai entre aspas, para aguentar espaço e acento
 * tanto no cmd quanto no bash. Aspas dentro do caminho são recusadas.
 */
export function hookCommand(scriptPath: string): string {
  if (scriptPath.includes('"')) throw new Error('caminho do hook com aspas não é aceito');
  return `node "${scriptPath.replaceAll('\\', '/')}"`;
}

/** Configuração de hooks de uma execução: todos os eventos apontam para o mesmo script. */
export function buildHookSettings(scriptPath: string): {
  hooks: Record<string, { hooks: { type: 'command'; command: string }[] }[]>;
} {
  const group = { hooks: [{ type: 'command' as const, command: hookCommand(scriptPath) }] };
  return { hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, [group]])) };
}

/** Grava a configuração de hooks da execução e devolve o caminho do arquivo. */
export function writeSettingsFile(dir: string, executionId: string, scriptPath: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${executionId}.settings.json`);
  writeFileSync(file, JSON.stringify(buildHookSettings(scriptPath), null, 2), 'utf8');
  return file;
}

/**
 * Converte um evento de hook no evento normalizado do agente. Evento que não entra no contrato devolve
 * undefined. Campo que falta ganha um valor de reserva, para o evento sair mesmo assim.
 */
export function mapHookEntry(record: HookRecord): AgentEvent | undefined {
  const { payload, seq, receivedAt: at } = record;
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value !== '' ? value : fallback;
  switch (payload['hook_event_name']) {
    case 'SessionStart':
      return { type: 'session.started', sessionId: text(payload['session_id'], `sessao-${seq}`), at };
    case 'Notification':
      return {
        type: 'input.requested',
        request: {
          id: `notification-${seq}`,
          prompt: text(payload['message'], 'O Claude Code está aguardando você.'),
        },
        at,
      };
    case 'PreToolUse':
      return {
        type: 'tool.requested',
        call: {
          callId: text(payload['tool_use_id'], `tool-${seq}`),
          name: text(payload['tool_name'], 'desconhecida'),
          input: isRecord(payload['tool_input']) ? payload['tool_input'] : {},
        },
        at,
      };
    case 'PostToolUse':
      return {
        type: 'tool.completed',
        callId: text(payload['tool_use_id'], `tool-${seq}`),
        result: { ok: true },
        at,
      };
    case 'Stop':
      return { type: 'message.completed', messageId: `stop-${seq}`, at };
    case 'SessionEnd':
      return { type: 'session.completed', result: { summary: '' }, at };
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
