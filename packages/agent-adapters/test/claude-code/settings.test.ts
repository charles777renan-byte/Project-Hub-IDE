import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  buildHookSettings,
  hookCommand,
  mapHookEntry,
  writeSettingsFile,
} from '../../src/claude-code/settings';

const at = '2026-10-21T12:00:00.000Z';

describe('configuração de hooks', () => {
  it('liga todos os eventos ao mesmo script, com barras normais no caminho', () => {
    const settings = buildHookSettings('C:\\Dados do App\\hook.cjs');

    expect(Object.keys(settings.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]?.[0]?.hooks[0]).toEqual({
        type: 'command',
        command: 'node "C:/Dados do App/hook.cjs"',
      });
    }
  });

  it('recusa caminho com aspas, que quebraria o comando', () => {
    expect(() => hookCommand('C:\\a"b\\hook.cjs')).toThrow(/aspas/);
  });

  it('grava o arquivo da execução com a mesma configuração', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-settings-'));
    try {
      const file = writeSettingsFile(dir, 'exec-1', 'C:/app/hook.cjs');
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(buildHookSettings('C:/app/hook.cjs'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mapHookEntry', () => {
  it('converte o início da sessão', () => {
    expect(
      mapHookEntry({ seq: 1, receivedAt: at, payload: { hook_event_name: 'SessionStart', session_id: 'abc' } }),
    ).toEqual({ type: 'session.started', sessionId: 'abc', at });
  });

  it('converte um aviso do Claude Code em pedido de entrada, com a mensagem', () => {
    expect(
      mapHookEntry({
        seq: 2,
        receivedAt: at,
        payload: { hook_event_name: 'Notification', message: 'Precisa da sua permissão' },
      }),
    ).toEqual({
      type: 'input.requested',
      request: { id: 'notification-2', prompt: 'Precisa da sua permissão' },
      at,
    });
  });

  it('converte o uso e o resultado de uma ferramenta', () => {
    expect(
      mapHookEntry({
        seq: 3,
        receivedAt: at,
        payload: { hook_event_name: 'PreToolUse', tool_use_id: 't1', tool_name: 'Bash', tool_input: { command: 'ls' } },
      }),
    ).toEqual({
      type: 'tool.requested',
      call: { callId: 't1', name: 'Bash', input: { command: 'ls' } },
      at,
    });
    expect(
      mapHookEntry({ seq: 4, receivedAt: at, payload: { hook_event_name: 'PostToolUse', tool_use_id: 't1' } }),
    ).toEqual({ type: 'tool.completed', callId: 't1', result: { ok: true }, at });
  });

  it('converte a resposta concluída e o fim da sessão', () => {
    expect(mapHookEntry({ seq: 5, receivedAt: at, payload: { hook_event_name: 'Stop' } })).toEqual({
      type: 'message.completed',
      messageId: 'stop-5',
      at,
    });
    expect(mapHookEntry({ seq: 6, receivedAt: at, payload: { hook_event_name: 'SessionEnd' } })).toEqual({
      type: 'session.completed',
      result: { summary: '' },
      at,
    });
  });

  it('usa valores de reserva quando um campo falta, e ignora evento que não entra no contrato', () => {
    expect(mapHookEntry({ seq: 7, receivedAt: at, payload: { hook_event_name: 'SessionStart' } })).toEqual({
      type: 'session.started',
      sessionId: 'sessao-7',
      at,
    });
    expect(mapHookEntry({ seq: 8, receivedAt: at, payload: { hook_event_name: 'UserPromptSubmit' } })).toBeUndefined();
  });
});
