// CLI falso do `claude` interativo para o teste de ponta a ponta da verificação. Roda num terminal do app, no
// Electron como Node (`APP_AGENT_SCRIPT` + `ELECTRON_RUN_AS_NODE=1`, só com `PROJECT_HUB_ENV=test`). Dispara os
// hooks da configuração `--settings` pelo mesmo comando que o Claude Code usaria (o script real do app, que
// posta o evento no receptor), no formato que o Claude Code envia para um comando de terminal.
//
// Roteiro: SessionStart -> um comando que não é de teste -> `pnpm test` que falha (PostToolUseFailure) ->
// `pnpm test` que passa, com uma saída maior que o limite de um registro do receptor (40 kB), para provar
// que o resumo no final da saída chega mesmo assim -> Stop -> SessionEnd. Nenhum comando é executado.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

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

function bash(id, command) {
  return {
    tool_name: 'Bash',
    tool_use_id: id,
    tool_input: { command, description: 'Comando do roteiro' },
  };
}

fire('SessionStart', { source: 'startup' });

// Um comando comum: fecha a ferramenta, sem verificação.
fire('PreToolUse', bash('toolu_falso_1', 'git status'));
fire('PostToolUse', {
  ...bash('toolu_falso_1', 'git status'),
  tool_response: { stdout: 'nada a commitar', stderr: '', interrupted: false, isImage: false },
  duration_ms: 40,
});

// Os testes falham: o Claude Code avisa pela falha da ferramenta, com a saída no erro.
fire('PreToolUse', bash('toolu_falso_2', 'pnpm test'));
fire('PostToolUseFailure', {
  ...bash('toolu_falso_2', 'pnpm test'),
  error: [
    'Exit code 1',
    ' FAIL  test/login.test.ts > entra com a senha certa',
    ' Test Files  1 failed (1)',
    '      Tests  1 failed | 2 passed (3)',
  ].join('\n'),
  is_interrupt: false,
  duration_ms: 1500,
});

// Os testes passam, com uma saída longa: o resumo fica no final.
const longOutput = [
  ...Array.from({ length: 3000 }, (_, index) => ` ✓ test/arquivo-${index}.test.ts (1 test) 2ms`),
  ' Test Files  3 passed (3)',
  '      Tests  12 passed (12)',
].join('\n');
fire('PreToolUse', bash('toolu_falso_3', 'pnpm test'));
fire('PostToolUse', {
  ...bash('toolu_falso_3', 'pnpm test'),
  tool_response: { stdout: longOutput, stderr: '', interrupted: false, isImage: false },
  duration_ms: 2300,
});

// A resposta final indica o critério que os testes comprovam, na linha que o prompt da missão pede.
fire('Stop', {
  stop_hook_active: false,
  last_assistant_message: [
    'Corrigi o login e rodei os testes: 12 passaram.',
    '',
    '**Critérios comprovados:** 1',
  ].join('\n'),
});
fire('SessionEnd', { reason: 'other' });
process.exit(0);
