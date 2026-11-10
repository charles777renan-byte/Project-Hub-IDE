import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HOOK_EVENTS,
  buildHookSettings,
  hookCommand,
  mapHookEntry,
  writeHookScript,
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

  it('liga só os eventos pedidos, quando a lista vem', () => {
    const settings = buildHookSettings('C:/app/hook.cjs', ['SessionStart', 'SessionEnd']);

    expect(Object.keys(settings.hooks).sort()).toEqual(['SessionEnd', 'SessionStart']);
    expect(settings.hooks['SessionStart']?.[0]?.hooks[0]).toEqual({
      type: 'command',
      command: 'node "C:/app/hook.cjs"',
    });
  });

  it('grava o arquivo só com os eventos pedidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-settings-'));
    try {
      const file = writeSettingsFile(dir, 'painel-1', 'C:/app/hook.cjs', [
        'SessionStart',
        'SessionEnd',
      ]);
      const written = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, unknown> };
      expect(Object.keys(written.hooks).sort()).toEqual(['SessionEnd', 'SessionStart']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('mapHookEntry', () => {
  it('converte o início da sessão', () => {
    expect(
      mapHookEntry({
        seq: 1,
        receivedAt: at,
        payload: { hook_event_name: 'SessionStart', session_id: 'abc' },
      }),
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
        payload: {
          hook_event_name: 'PreToolUse',
          tool_use_id: 't1',
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
        },
      }),
    ).toEqual({
      type: 'tool.requested',
      call: { callId: 't1', name: 'Bash', input: { command: 'ls' } },
      at,
    });
    expect(
      mapHookEntry({
        seq: 4,
        receivedAt: at,
        payload: { hook_event_name: 'PostToolUse', tool_use_id: 't1' },
      }),
    ).toEqual({ type: 'tool.completed', callId: 't1', result: { ok: true }, at });
  });

  it('converte a resposta concluída e o fim da sessão', () => {
    expect(mapHookEntry({ seq: 5, receivedAt: at, payload: { hook_event_name: 'Stop' } })).toEqual({
      type: 'message.completed',
      messageId: 'stop-5',
      at,
    });
    expect(
      mapHookEntry({ seq: 6, receivedAt: at, payload: { hook_event_name: 'SessionEnd' } }),
    ).toEqual({
      type: 'session.completed',
      result: { summary: '' },
      at,
    });
  });

  it('usa valores de reserva quando um campo falta, e ignora evento que não entra no contrato', () => {
    expect(
      mapHookEntry({ seq: 7, receivedAt: at, payload: { hook_event_name: 'SessionStart' } }),
    ).toEqual({
      type: 'session.started',
      sessionId: 'sessao-7',
      at,
    });
    expect(
      mapHookEntry({ seq: 8, receivedAt: at, payload: { hook_event_name: 'UserPromptSubmit' } }),
    ).toBeUndefined();
  });
});

describe('script de hook', () => {
  /** Roda o script de verdade contra um receptor local e devolve o corpo que chegou. */
  async function send(payload: Record<string, unknown>, env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'ph-hook-'));
    const bodies: string[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      request.on('end', () => {
        bodies.push(body);
        response.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const script = writeHookScript(dir);
      // O receptor roda neste mesmo processo: o script precisa rodar sem travar o laço de eventos.
      const child = spawn(process.execPath, [script], {
        env: { ...process.env, PROJECT_HUB_HOOK_URL: `http://127.0.0.1:${port}/hooks/t1`, ...env },
      });
      child.stdin.end(JSON.stringify(payload));
      const status = await new Promise((resolve) => child.on('exit', resolve));
      expect(status).toBe(0);
      return JSON.parse(bodies[0] ?? 'null') as Record<string, unknown> | null;
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const full = {
    hook_event_name: 'PostToolUse',
    session_id: 's1',
    transcript_path: '/t/s1.jsonl',
    notification_type: 'permission_prompt',
    reason: 'clear',
    source: 'startup',
    tool_name: 'Bash',
    tool_input: { command: 'segredo' },
    tool_response: { stdout: 'saída longa' },
    prompt: 'o que a pessoa digitou',
    message: 'texto do aviso',
    last_assistant_message: 'resposta',
  };

  it('sem o modo enxuto, envia o evento inteiro (a missão lê a ferramenta e a mensagem)', async () => {
    expect(await send(full, {})).toEqual(full);
  });

  it('no modo enxuto, envia só os campos que o painel lê', async () => {
    expect(await send(full, { PROJECT_HUB_HOOK_SLIM: '1' })).toEqual({
      hook_event_name: 'PostToolUse',
      session_id: 's1',
      transcript_path: '/t/s1.jsonl',
      notification_type: 'permission_prompt',
      reason: 'clear',
      source: 'startup',
    });
  });
});
