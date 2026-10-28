// CLI falso do `claude` interativo para os testes de ponta a ponta do gasto de tokens. Roda num terminal do
// app, no Electron como Node (`APP_AGENT_SCRIPT` + `ELECTRON_RUN_AS_NODE=1`, só com `PROJECT_HUB_ENV=test`).
// Dispara os hooks da configuração `--settings` pelo mesmo comando que o Claude Code usaria (o script real
// do app, que posta o evento no receptor), e grava o transcript onde o Claude Code o gravaria:
// `<CLAUDE_CONFIG_DIR>/projects/<pasta>/<session_id>.jsonl`, com os subagentes em
// `<session_id>/subagents/agent-<id>.jsonl`. Os números são sintéticos.
//
// Roteiro: SessionStart (antes de o transcript existir) -> primeira parte do gasto -> espera o teste
// liberar a segunda -> segunda parte (uma resposta repetida, uma nova e um subagente) -> Stop -> SessionEnd.
// A espera é por um arquivo na pasta de dados do Claude Code, e não por um tempo fixo: o teste só libera
// depois de ver o primeiro total na tela. O teto da espera garante que o processo sempre termina.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Arquivo que o teste cria para liberar a segunda parte (dentro de `CLAUDE_CONFIG_DIR`): `fake-agent/liberar-segunda-parte`. */
const GATE_FILE = ['fake-agent', 'liberar-segunda-parte'];
/** Teto da espera pelo teste, em ms. Passado ele, a segunda parte sai sozinha. */
const GATE_CEILING_MS = 45_000;
const GATE_POLL_MS = 100;

const configDir = process.env.CLAUDE_CONFIG_DIR;
if (configDir === undefined || configDir === '') {
  // Sem a pasta do teste, o transcript iria para o `~/.claude` de verdade. Não grava nada.
  console.error('fake-claude-agent: CLAUDE_CONFIG_DIR não foi definido.');
  process.exit(2);
}

const args = process.argv.slice(2);
const settings = JSON.parse(readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));

const sessionId = randomUUID();
const projectFolder = join(configDir, 'projects', 'C--projeto-falso');
const transcript = join(projectFolder, `${sessionId}.jsonl`);
const subagentTranscript = join(projectFolder, sessionId, 'subagents', 'agent-falso1.jsonl');

/** Linha de resposta do transcript. `write` é a escrita de cache de 5 minutos e de 1 hora. */
function answer(id, { input, output, cacheRead, write5m = 0, write1h = 0 }) {
  return (
    JSON.stringify({
      type: 'assistant',
      message: {
        id,
        model: 'claude-sonnet-5-5',
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: write5m + write1h,
          cache_creation: {
            ephemeral_5m_input_tokens: write5m,
            ephemeral_1h_input_tokens: write1h,
          },
        },
      },
    }) + '\n'
  );
}

// Respostas sintéticas (claude-sonnet-5-5: entrada USD 2 e saída USD 10 por milhão de tokens).
const FIRST = answer('msg_falso_a', {
  input: 12000,
  output: 3000,
  cacheRead: 200000,
  write5m: 20000,
});
const SECOND = answer('msg_falso_b', {
  input: 8000,
  output: 2000,
  cacheRead: 100000,
  write1h: 10000,
});
const SUBAGENT = answer('msg_falso_sub', { input: 5000, output: 1200, cacheRead: 50000 });
/** Linha que não é resposta: o app a ignora. */
const USER_LINE = JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }) + '\n';

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGate() {
  const gate = join(configDir, ...GATE_FILE);
  const deadline = Date.now() + GATE_CEILING_MS;
  while (!existsSync(gate) && Date.now() < deadline) await sleep(GATE_POLL_MS);
}

// O hook de início sai antes de o arquivo do transcript existir, como no Claude Code.
fire('SessionStart', { source: 'startup' });

// Primeira parte: a mesma resposta duas vezes (o app conta uma).
mkdirSync(dirname(transcript), { recursive: true });
writeFileSync(transcript, USER_LINE + FIRST + FIRST, 'utf8');

await waitForGate();

// Segunda parte: a primeira resposta de novo (já contada), uma resposta nova e um subagente.
appendFileSync(transcript, FIRST + USER_LINE + SECOND, 'utf8');
mkdirSync(dirname(subagentTranscript), { recursive: true });
writeFileSync(subagentTranscript, SUBAGENT, 'utf8');

fire('Stop');
fire('SessionEnd', { reason: 'other' });
process.exit(0);
