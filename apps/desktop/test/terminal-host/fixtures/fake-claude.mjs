// CLI falso para o teste de integração do adaptador. Registra os argumentos, dispara os hooks da
// configuração `--settings` pelo mesmo comando que o Claude Code usaria, e espera linhas pela entrada.
// A linha "/exit" dispara SessionEnd e encerra. Qualquer outra linha dispara Stop.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify(args));
const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));

function fire(event, extra = {}) {
  for (const group of settings.hooks[event] ?? []) {
    for (const hook of group.hooks) {
      spawnSync(hook.command, {
        shell: true,
        input: JSON.stringify({
          hook_event_name: event,
          session_id: 'sessao-teste',
          cwd: process.cwd(),
          ...extra,
        }),
        env: process.env,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    }
  }
}

fire('SessionStart');
fire('Notification', { message: 'Precisa da sua permissão' });
fire('PreToolUse', {
  tool_use_id: 'tool-1',
  tool_name: 'Bash',
  tool_input: { command: 'echo oi' },
});
fire('PostToolUse', { tool_use_id: 'tool-1', tool_name: 'Bash' });

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  let match;
  while ((match = /[\r\n]/.exec(pending)) !== null) {
    const line = pending.slice(0, match.index).trim();
    pending = pending.slice(match.index + 1);
    if (line === '') continue;
    if (line === '/exit') {
      fire('SessionEnd');
      process.exit(0);
    }
    fire('Stop');
  }
});
