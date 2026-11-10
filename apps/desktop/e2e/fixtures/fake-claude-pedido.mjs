// CLI falso do `claude` aberto pelo menu "Abrir terminal", para o teste de ponta a ponta do estado "Aguardando".
// Roda no Node do PATH (`APP_PANEL_CLAUDE_SCRIPT`, só com `PROJECT_HUB_ENV=test`). Dispara os hooks da configuração
// `--settings` pelo mesmo comando que o Claude Code usaria (o script real do app, que posta o evento no receptor).
// Não grava transcript: o teste é do estado, não do gasto.
//
// Roteiro, comandado pelo que o teste digita no terminal (uma linha por passo):
//   pronto -> "pedir" dispara PermissionRequest -> qualquer linha dispara PostToolUse -> "sair" encerra a sessão.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
const sessionId = randomUUID();

function fire(event, extra = {}) {
  for (const group of settings.hooks[event] ?? []) {
    for (const hook of group.hooks) {
      spawnSync(hook.command, {
        shell: true,
        input: JSON.stringify({
          hook_event_name: event,
          session_id: sessionId,
          cwd: process.cwd(),
          ...extra,
        }),
        env: process.env,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    }
  }
}

fire('SessionStart', { source: 'startup' });
console.log('claude-falso: pronto');

let asking = false;
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const text = line.trim();
  if (asking) {
    asking = false;
    fire('PostToolUse', {
      tool_name: 'Bash',
      tool_response: { stdout: 'conteúdo que não vai para o log' },
    });
    console.log('claude-falso: ferramenta-terminou');
    return;
  }
  if (text === 'pedir') {
    asking = true;
    fire('PermissionRequest', {
      tool_name: 'Bash',
      tool_input: { command: 'comando que não vai para o log' },
    });
    console.log('claude-falso: permitir-comando?');
    return;
  }
  if (text === 'sair') {
    fire('SessionEnd', { reason: 'other' });
    process.exit(0);
  }
});
