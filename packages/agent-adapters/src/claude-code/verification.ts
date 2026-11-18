import type { AgentEvent } from '@project-hub/agent-sdk';
import type { HookRecord } from './settings';

/**
 * Verificação lida do que o agente rodou. O Claude Code avisa, por hook, cada comando de terminal que
 * termina (`PostToolUse`) ou falha (`PostToolUseFailure`). Quando o comando é de teste, a contagem sai do
 * resumo que o executor imprime. Nada é executado pelo app, e nada é inventado: sem resumo legível, um
 * comando que passou sai 0 de 0 (não prova nada), e um que falhou conta como uma checagem que falhou.
 */

/** Ferramentas do Claude Code que rodam comando de terminal. */
const SHELL_TOOLS: readonly unknown[] = ['Bash', 'PowerShell'];

/** Tamanho máximo do comando gravado no evento. */
const MAX_COMMAND_CHARS = 300;

/** Tamanho máximo da saída gravada no evento: o final, onde fica o resumo. */
export const MAX_VERIFICATION_OUTPUT_CHARS = 8_000;

/** Opções do gerenciador de pacotes antes do script: `-r`, `--filter x`, `--filter=x`, `-C pasta`. */
const OPTIONS = String.raw`(?:-\S+\s+(?:[^-\s]\S*\s+)?)*`;
/** Quem chama um executor instalado no projeto. */
const LAUNCHER = String.raw`(?:(?:npx|bunx|pnpm\s+exec|pnpm\s+dlx|yarn\s+dlx|yarn)\s+)?`;

/** Comandos de teste, conferidos no começo de cada parte do comando. `go` tem contagem própria. */
const TEST_COMMANDS: readonly { pattern: RegExp; kind: TestCommandKind }[] = [
  // Script `test`, `test:e2e`, `test-unit` do projeto.
  {
    pattern: new RegExp(
      String.raw`^(?:pnpm|npm|yarn|bun)\s+${OPTIONS}(?:run\s+${OPTIONS})?test(?:[:._-]\S*)?(?=\s|$)`,
    ),
    kind: 'other',
  },
  { pattern: new RegExp(String.raw`^${LAUNCHER}(?:vitest|jest|mocha|ava)(?=\s|$)`), kind: 'other' },
  { pattern: new RegExp(String.raw`^${LAUNCHER}playwright\s+test(?=\s|$)`), kind: 'other' },
  {
    pattern: /^(?:(?:python[\d.]*|py)\s+-m\s+|uv\s+run\s+|poetry\s+run\s+)?pytest(?=\s|$)/,
    kind: 'other',
  },
  { pattern: /^(?:python[\d.]*|py)\s+-m\s+unittest(?=\s|$)/, kind: 'other' },
  { pattern: /^go\s+test(?=\s|$)/, kind: 'go' },
  { pattern: /^cargo\s+(?:test|nextest\s+run)(?=\s|$)/, kind: 'other' },
  { pattern: /^dotnet\s+test(?=\s|$)/, kind: 'other' },
  {
    pattern: /^(?:\.[\\/])?(?:mvnw?|gradlew?)(?:\.cmd|\.bat)?\s+(?:\S+\s+)*test(?=\s|$)/,
    kind: 'other',
  },
  { pattern: /^(?:deno|bun)\s+test(?=\s|$)/, kind: 'other' },
  { pattern: /^node\s+--test(?=\s|$)/, kind: 'other' },
  { pattern: /^(?:bundle\s+exec\s+)?rspec(?=\s|$)/, kind: 'other' },
  { pattern: /^(?:\.\/)?(?:vendor\/bin\/)?phpunit(?=\s|$)/, kind: 'other' },
  { pattern: /^make\s+(?:test|check)(?=\s|$)/, kind: 'other' },
];

export type TestCommandKind = 'go' | 'other';

/** Variáveis de ambiente antes do comando: `CI=1 pnpm test`. */
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

/**
 * O tipo do comando de teste, ou undefined quando o comando não roda testes. Cada parte do comando
 * (separada por `&&`, `||`, `;`, `|` ou quebra de linha) é conferida pelo começo: `cd app && pnpm test`
 * vale, `echo "pnpm test"` não.
 */
export function testCommandKind(command: string): TestCommandKind | undefined {
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const start = part
      .trim()
      .replace(/^\(+\s*/, '')
      .replace(ENV_PREFIX, '');
    const match = TEST_COMMANDS.find(({ pattern }) => pattern.test(start));
    if (match !== undefined) return match.kind;
  }
  return undefined;
}

export function isTestCommand(command: string): boolean {
  return testCommandKind(command) !== undefined;
}

// eslint-disable-next-line no-control-regex -- as cores do terminal começam pelo caractere de escape.
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
/** Prefixo que o `pnpm -r` põe em cada linha: a pasta do pacote (ou `.`), o script e dois-pontos. */
const PNPM_PREFIX = /^(?:\.|[\w@.-]+(?:\/[\w@.-]+)+) [\w:.-]+: +/;
const PASSED = /(\d+) (?:passed|passing)\b/g;
const FAILED = /(\d+) (?:failed|failing|errors?)\b/g;
/** Há alguma contagem de aprovados ou de falhos no texto. Sem a marca `g`, para o `test` não guardar posição. */
const COUNT = /\d+ (?:passed|passing|failed|failing|errors?)\b/;

function sum(text: string, pattern: RegExp): number {
  let total = 0;
  for (const match of text.matchAll(pattern)) total += Number(match[1]);
  return total;
}

/**
 * Conta os testes pelo resumo que o executor imprime. Só linhas com forma de resumo entram, e os resumos
 * de vários pacotes se somam. Sem nenhuma, devolve undefined.
 *
 * - Vitest e Jest: a linha `Tests`, e não a de arquivos (`Test Files`, `Test Suites`).
 * - pytest, Playwright e Mocha: a linha que começa pela contagem (`3 passed, 1 failed in 0.1s`, `10 passed`).
 * - cargo: `test result: ok. 5 passed; 0 failed`.
 * - `node --test`: `# pass 5`, `# fail 0`.
 * - dotnet: `Failed: 1, Passed: 5`.
 * - Maven e Gradle: a última linha `Tests run: 7, Failures: 1, Errors: 1, Skipped: 1`.
 * - `go test`: os testes do modo detalhado (`--- PASS`), ou os pacotes (`ok pacote 0.1s`) sem ele.
 */
export function countTests(
  output: string,
  kind: TestCommandKind = 'other',
): { passed: number; failed: number } | undefined {
  let passed = 0;
  let failed = 0;
  let found = false;
  let surefire: { passed: number; failed: number } | undefined;
  const go = { tests: { passed: 0, failed: 0 }, packages: { passed: 0, failed: 0 } };
  const add = (morePassed: number, moreFailed: number): void => {
    passed += morePassed;
    failed += moreFailed;
    found = true;
  };

  for (const raw of output.replace(ANSI, '').split(/\r?\n/)) {
    if (kind === 'go') {
      // Só o teste de primeiro nível: os subtestes vêm recuados e já estão contados no pai.
      const test = /^--- (PASS|FAIL): /.exec(raw);
      if (test !== null) go.tests[test[1] === 'PASS' ? 'passed' : 'failed'] += 1;
      if (/^ok\s+\S+\s+(?:[\d.]+s|\(cached\))/.test(raw)) go.packages.passed += 1;
      if (/^FAIL\s+\S+\s+(?:[\d.]+s|\[)/.test(raw)) go.packages.failed += 1;
      continue;
    }
    const line = raw.trim().replace(PNPM_PREFIX, '').trim();

    const run = /Tests run: (\d+), Failures: (\d+), Errors: (\d+)(?:, Skipped: (\d+))?/.exec(line);
    if (run !== null) {
      const broken = Number(run[2]) + Number(run[3]);
      surefire = {
        passed: Math.max(0, Number(run[1]) - broken - Number(run[4] ?? 0)),
        failed: broken,
      };
      continue;
    }
    const tests = /^Tests:?\s+(.+)$/.exec(line);
    if (tests?.[1] !== undefined) {
      if (COUNT.test(tests[1])) add(sum(tests[1], PASSED), sum(tests[1], FAILED));
      continue;
    }
    const counted = line.replace(/^=+ /, '');
    if (/^\d+ (?:passed|passing|failed|failing|errors?)\b/.test(counted)) {
      add(sum(counted, PASSED), sum(counted, FAILED));
      continue;
    }
    const cargo = /^test result: \w+\. (\d+) passed; (\d+) failed/.exec(line);
    if (cargo !== null) {
      add(Number(cargo[1]), Number(cargo[2]));
      continue;
    }
    const tap = /^(?:#|ℹ) (pass|fail) (\d+)$/.exec(line);
    if (tap !== null) {
      add(tap[1] === 'pass' ? Number(tap[2]) : 0, tap[1] === 'fail' ? Number(tap[2]) : 0);
      continue;
    }
    const dotnet = /Failed:\s*(\d+),\s*Passed:\s*(\d+)/.exec(line);
    if (dotnet !== null) add(Number(dotnet[2]), Number(dotnet[1]));
  }

  if (kind === 'go') {
    const counts = go.tests.passed + go.tests.failed > 0 ? go.tests : go.packages;
    return counts.passed + counts.failed > 0 ? counts : undefined;
  }
  if (surefire !== undefined) add(surefire.passed, surefire.failed);
  return found ? { passed, failed } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A saída de um comando que terminou: a padrão e a de erro, na ordem. */
function outputOf(response: unknown): string {
  if (typeof response === 'string') return response;
  if (!isRecord(response)) return '';
  return [textOf(response['stdout']), textOf(response['stderr'])]
    .filter((part) => part.trim() !== '')
    .join('\n');
}

/** O final do texto, a partir de um começo de linha, para caber no evento. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const lineStart = cut.indexOf('\n');
  return lineStart === -1 || lineStart === cut.length - 1 ? cut : cut.slice(lineStart + 1);
}

/** O comando numa linha só, cortado para a tela. */
function oneLine(command: string): string {
  const flat = command.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_COMMAND_CHARS ? flat : `${flat.slice(0, MAX_COMMAND_CHARS - 1)}…`;
}

/**
 * A verificação que um hook do Claude Code comprova, ou undefined. Vale para o comando de terminal que é
 * de teste e que rodou até o fim: comando em segundo plano ou interrompido não tem resultado.
 */
export function verificationOf(record: HookRecord): AgentEvent | undefined {
  const { payload } = record;
  const hook = payload['hook_event_name'];
  if (hook !== 'PostToolUse' && hook !== 'PostToolUseFailure') return undefined;
  if (!SHELL_TOOLS.includes(payload['tool_name'])) return undefined;
  const input = payload['tool_input'];
  if (!isRecord(input) || input['run_in_background'] === true) return undefined;
  const command = textOf(input['command']);
  const kind = testCommandKind(command);
  if (kind === undefined) return undefined;

  const brokeOut = hook === 'PostToolUseFailure';
  const response = payload['tool_response'];
  if (
    brokeOut
      ? payload['is_interrupt'] === true
      : isRecord(response) && response['interrupted'] === true
  ) {
    return undefined;
  }
  const output = (brokeOut ? textOf(payload['error']) : outputOf(response))
    .replace(ANSI, '')
    .replace(/^[\r\n]+/, '')
    .trimEnd();
  const counts = countTests(output, kind) ?? { passed: 0, failed: 0 };
  const duration = payload['duration_ms'];
  return {
    type: 'verification.completed',
    command: oneLine(command),
    passed: counts.passed,
    // Código de saída diferente de zero é falha, mesmo quando nenhum teste aparece como falho.
    failed: brokeOut ? Math.max(counts.failed, 1) : counts.failed,
    durationMs: typeof duration === 'number' && duration >= 0 ? Math.round(duration) : 0,
    ...(output === '' ? {} : { output: tail(output, MAX_VERIFICATION_OUTPUT_CHARS) }),
    at: record.receivedAt,
  };
}
