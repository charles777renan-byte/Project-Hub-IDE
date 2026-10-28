// CLI falso do `claude -p` da leitura dos limites da assinatura, para os testes de ponta a ponta. Roda no
// Electron como Node (`APP_LIMITS_SCRIPT` + `ELECTRON_RUN_AS_NODE=1`, só com `PROJECT_HUB_ENV=test`).
// Imprime o que o CLI real imprime com `--output-format stream-json --verbose`: uma linha JSON por evento,
// com o `rate_limit_event` (janela de 5 horas em 16% e semanal em 13%) e o `result` no fim. As horas de
// renovação são relativas a agora, para ficarem sempre no futuro.

const now = Math.floor(Date.now() / 1000);
const FIVE_HOURS = 5 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

const events = [
  { type: 'system', subtype: 'init', model: 'claude-haiku', tools: [] },
  {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt: now + 3 * 60 * 60,
      rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: 0.16, resetsAt: now + 3 * 60 * 60, status: 'allowed' },
        seven_day: {
          utilization: 0.13,
          resetsAt: now + SEVEN_DAYS - FIVE_HOURS,
          status: 'allowed',
        },
      },
    },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 10,
    num_turns: 1,
    result: '.',
    total_cost_usd: 0,
  },
];

process.stdout.write(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
