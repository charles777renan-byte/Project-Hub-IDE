import { mkdir } from 'node:fs/promises';
import type { LimitProblem, LimitWindowDto } from '@project-hub/contracts';
import { runPlannerProcess, type PlannerRunner } from './claude-planner';

/** Tempo máximo da leitura. Ela leva uns 4 s; 30 s cobre uma rede lenta sem prender o app. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Teto da saída do processo. A leitura real tem poucos KB; 2 MB só protege contra saída descontrolada. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Texto do resultado que indica falta de login (o CLI o imprime no resultado, com erro). */
const AUTH_TEXT = /not logged in|\/login|log ?in|sign in|authenticat|invalid api key|oauth/i;

/** Executor do processo. É o mesmo do planejador: `execFile` sem shell, `stdin` fechado, morte no tempo ou no aborto. */
export type LimitsRunner = PlannerRunner;

/** O que a leitura entrega: as janelas de uso com a hora da captura, ou o motivo de não haver número. */
export type LimitsReading =
  | { ok: true; windows: LimitWindowDto[]; capturedAt: string }
  | { ok: false; problem: LimitProblem };

/** Resultado de ler a saída do `claude`: as janelas, ou o problema. */
export type ParsedRateLimits =
  { ok: true; windows: LimitWindowDto[] } | { ok: false; problem: LimitProblem };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Converte uma janela do evento. Só vale com `utilization` entre 0 e 1 e `resetsAt` numérico (epoch em
 * segundos, que o programa informa). Número fora do intervalo não é corrigido: a escala pode ter mudado, e
 * mostrar 100% por engano é pior do que não mostrar. A janela inválida é descartada.
 */
function toWindow(id: string, value: unknown): LimitWindowDto | undefined {
  if (id === '' || id.length > 64 || !isRecord(value)) return undefined;
  const utilization = value['utilization'];
  const resetsAt = value['resetsAt'];
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return undefined;
  if (utilization < 0 || utilization > 1) return undefined;
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return undefined;
  const date = new Date(resetsAt * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return { id, usedPercent: Math.round(utilization * 100), resetsAt: date.toISOString() };
}

/**
 * Lê a saída do `claude -p --output-format stream-json --verbose`: uma linha JSON por evento. O que
 * interessa é o `rate_limit_event`, com as janelas em `rate_limit_info.unifiedWindows` (`utilization` de 0 a
 * 1; `resetsAt` em segundos). Toda janela com os dois números entra, com o nome da chave como `id`; se vários
 * eventos trazem a mesma janela, vale o último. Linha que não é JSON é ignorada (o programa pode imprimir
 * avisos), mas saída sem nenhum evento legível é `failed`.
 *
 * Ordem das decisões:
 * 1. Há janelas válidas: é leitura boa, mesmo que o `result` venha com erro (cota esgotada devolve erro e
 *    ainda mostra 100%, que é justamente o que a pessoa quer ver).
 * 2. Há `rate_limit_event`, mas nenhuma janela válida: fora do formato, `failed`.
 * 3. O `result` veio com `is_error`: `not-logged-in` se o texto fala de login, senão `failed`.
 * 4. O `result` veio sem erro e sem nenhum `rate_limit_event`: a conta não tem limite por janela (chave de
 *    API), `no-limits`.
 * 5. Nem `result` nem evento: saída incompleta, `failed`.
 */
export function parseRateLimits(stdout: string): ParsedRateLimits {
  const events: Record<string, unknown>[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (text === '') continue;
    const event = parseJson(text);
    if (isRecord(event)) events.push(event);
  }
  if (events.length === 0) return { ok: false, problem: 'failed' };

  const windows = new Map<string, LimitWindowDto>();
  let sawRateLimitEvent = false;
  let result: Record<string, unknown> | undefined;
  for (const event of events) {
    if (event['type'] === 'result') {
      result = event;
      continue;
    }
    if (event['type'] !== 'rate_limit_event') continue;
    sawRateLimitEvent = true;
    const info = event['rate_limit_info'];
    const unified = isRecord(info) ? info['unifiedWindows'] : undefined;
    if (!isRecord(unified)) continue;
    for (const [id, value] of Object.entries(unified)) {
      const window = toWindow(id, value);
      if (window !== undefined) windows.set(id, window);
    }
  }

  if (windows.size > 0) return { ok: true, windows: [...windows.values()] };
  if (sawRateLimitEvent) return { ok: false, problem: 'failed' };
  if (result === undefined) return { ok: false, problem: 'failed' };
  if (result['is_error'] === true) {
    const text = typeof result['result'] === 'string' ? result['result'] : '';
    return { ok: false, problem: AUTH_TEXT.test(text) ? 'not-logged-in' : 'failed' };
  }
  return { ok: false, problem: 'no-limits' };
}

/**
 * Argumentos fixos do `claude`. A leitura é só uma pergunta mínima ao modelo mais barato, e o evento de limite
 * vem de graça na resposta (cerca de 1,3 mil tokens, US$ 0,0003). Nada roda além disso: `--tools ""` tira
 * todas as ferramentas, `--restricted` ignora os arquivos de configuração de usuário, projeto e local,
 * `--strict-mcp-config` ignora todo servidor MCP e `--no-session-persistence` não deixa transcript. Nada do
 * que a pessoa digitou entra aqui.
 */
export function buildLimitsArgs(): string[] {
  return [
    '-p',
    '.',
    '--model',
    'haiku',
    '--restricted',
    '--strict-mcp-config',
    '--tools',
    '',
    '--system-prompt',
    '.',
    '--no-session-persistence',
    '--output-format',
    'stream-json',
    '--verbose',
  ];
}

export type ClaudeLimitsProbeOptions = {
  /** Executável do Claude Code (caminho completo: no Windows o nome solto não é procurado no PATH). */
  command: string;
  /** Argumentos que vêm antes dos fixos. Só os testes usam (rodar um script no lugar do `claude`). */
  commandPrefix?: readonly string[];
  /** Ambiente do processo filho. A composição passa o ambiente filtrado dos terminais, com o login. */
  env: NodeJS.ProcessEnv;
  /** Variáveis somadas ao `env`, que elas vencem. Só os testes usam. */
  extraEnv?: NodeJS.ProcessEnv;
  /**
   * Pasta de trabalho do processo. Neutra de propósito: sem projeto dentro, o `claude` não carrega
   * configuração nem contexto de ninguém. Criada se faltar.
   */
  cwd: string;
  /** Tempo limite em milissegundos. O padrão é 30000. */
  timeoutMs?: number;
  /** Executor do processo. Os testes passam um falso. */
  run?: LimitsRunner;
  /** Relógio, para a hora da captura. Os testes passam um falso. */
  now?: () => Date;
};

/** A sonda: uma leitura por chamada. Nunca rejeita; todo problema vira `{ ok: false, problem }`. */
export type ClaudeLimitsProbe = {
  read(signal: AbortSignal): Promise<LimitsReading>;
};

/**
 * Sonda dos limites da assinatura. Roda o próprio `claude` do usuário (o app não lê token nem chama a API da
 * Anthropic) e traduz a saída. A mensagem do programa nunca sai daqui: só o `problem` fixo.
 */
export function createClaudeLimitsProbe(options: ClaudeLimitsProbeOptions): ClaudeLimitsProbe {
  const run = options.run ?? runPlannerProcess;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = [...(options.commandPrefix ?? []), ...buildLimitsArgs()];
  const env = { ...options.env, ...options.extraEnv };
  return {
    async read(signal) {
      try {
        await mkdir(options.cwd, { recursive: true });
      } catch {
        return { ok: false, problem: 'failed' };
      }
      let output: { stdout: string; exitCode: number };
      try {
        output = await run({
          command: options.command,
          args,
          cwd: options.cwd,
          env,
          stdin: '',
          timeoutMs,
          signal,
          maxOutputBytes: MAX_OUTPUT_BYTES,
        });
      } catch (error) {
        // Tempo esgotado, saída grande demais e aborto também viram `failed`, no fim.
        if (isRecord(error) && error['code'] === 'ENOENT') {
          return { ok: false, problem: 'not-installed' };
        }
        return { ok: false, problem: 'failed' };
      }
      // O código de saída não decide: o login falho sai com código 1 e o motivo vem na saída.
      const parsed = parseRateLimits(output.stdout);
      if (!parsed.ok) return parsed;
      return { ok: true, windows: parsed.windows, capturedAt: now().toISOString() };
    },
  };
}
