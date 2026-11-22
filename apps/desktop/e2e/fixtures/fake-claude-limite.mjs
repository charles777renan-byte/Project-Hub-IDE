// CLI falso do `claude` interativo para o teste de ponta a ponta da troca automática de conta. Roda num terminal do
// app, no Electron como Node (`APP_AGENT_SCRIPT` + `ELECTRON_RUN_AS_NODE=1`, só com `PROJECT_HUB_ENV=test`).
// Dispara os hooks da configuração `--settings` pelo mesmo comando que o Claude Code usaria e grava o transcript
// onde o Claude Code o gravaria: `<CLAUDE_CONFIG_DIR>/projects/C--projeto-falso/<session_id>.jsonl`.
//
// Sempre grava os argumentos recebidos em `<CLAUDE_CONFIG_DIR>/fake-limite/args.json`.
// Com o marcador `<CLAUDE_CONFIG_DIR>/fake-limite/esgotada` (a conta sem limite): SessionStart, uma resposta e a
// linha de limite no formato novo, e fica vivo até ser encerrado, como o Claude Code esperando. Sem o marcador:
// SessionStart, uma resposta, Stop e SessionEnd, e sai. Os números e o texto são sintéticos.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Teto da espera depois do limite, em ms: o app encerra antes; passado ele, o processo sai sozinho. */
const ALIVE_CEILING_MS = 90_000;

const configDir = process.env.CLAUDE_CONFIG_DIR;
if (configDir === undefined || configDir === '') {
  // Sem a pasta do teste, o transcript iria para o `~/.claude` de verdade. Não grava nada.
  console.error('fake-claude-limite: CLAUDE_CONFIG_DIR não foi definido.');
  process.exit(2);
}

const args = process.argv.slice(2);
const own = join(configDir, 'fake-limite');
mkdirSync(own, { recursive: true });
writeFileSync(join(own, 'args.json'), JSON.stringify(args), 'utf8');
const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
const exhausted = existsSync(join(own, 'esgotada'));

const sessionId = randomUUID();
const transcript = join(configDir, 'projects', 'C--projeto-falso', `${sessionId}.jsonl`);

const USER_LINE =
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'continue' } }) + '\n';
const ANSWER =
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      id: `msg_falso_${sessionId.slice(0, 8)}`,
      model: 'claude-sonnet-5-5',
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0 },
    },
  }) + '\n';

/** A linha de limite, como as versões novas do Claude Code gravam: a hora de renovação vem em segundos. */
function limitLine() {
  const now = Date.now();
  const resetsAt = Math.floor((now + 2 * 3_600_000) / 1000);
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date(now).toISOString(),
      error: 'rate_limit',
      isApiErrorMessage: true,
      apiErrorParams: {
        rate_limit_info: { status: 'rejected', resetsAt, rateLimitType: 'five_hour' },
      },
      message: {
        id: `msg_limite_${sessionId.slice(0, 8)}`,
        model: '<synthetic>',
        content: [{ type: 'text', text: 'You have hit your session limit · resets 8pm' }],
      },
    }) + '\n'
  );
}

function fire(event, extra = {}) {
  for (const group of settings.hooks[event] ?? []) {
    for (const hook of group.hooks) {
      spawnSync(hook.command, {
        shell: true,
        input: JSON.stringify({
          hook_event_name: event,
          session_id: sessionId,
          transcript_path: transcript,
          cwd: process.cwd(),
          ...extra,
        }),
        env: process.env,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    }
  }
}

// O hook de início sai antes de o arquivo do transcript existir, como no Claude Code.
fire('SessionStart', { source: 'startup' });
mkdirSync(dirname(transcript), { recursive: true });

if (exhausted) {
  writeFileSync(transcript, USER_LINE + ANSWER + limitLine(), 'utf8');
  process.stdout.write('Limite de uso atingido. Esperando.\r\n');
  // Fica vivo, como o Claude Code parado no limite, até o app encerrar o terminal.
  setTimeout(() => process.exit(0), ALIVE_CEILING_MS);
} else {
  writeFileSync(transcript, USER_LINE + ANSWER, 'utf8');
  fire('Stop');
  fire('SessionEnd', { reason: 'other' });
  process.exit(0);
}
