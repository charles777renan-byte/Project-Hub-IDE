import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPlannerArgs,
  buildPlannerPrompt,
  createClaudePlanner,
  parsePlannerOutput,
  PlannerOutputTooLargeError,
  PlannerTimeoutError,
  type PlannerRunner,
} from '../src/main/claude-planner';

const NO_RESPONSE = 'O Claude Code não respondeu. Confira o login e a cota e tente de novo.';
const BAD_FORMAT = 'O Claude Code devolveu um plano fora do formato.';

/** Saída real do `claude -p --output-format json --json-schema ...` (claude 2.1.312), sem ids. */
const realOutput = readFileSync(
  new URL('./fixtures/claude-plan-output.json', import.meta.url),
  'utf8',
);

const task = (overrides: Record<string, unknown> = {}) => ({
  title: 'Tarefa',
  description: 'Fazer.',
  role: 'general',
  dependsOn: [],
  ...overrides,
});
const envelope = (plan: unknown) => JSON.stringify({ is_error: false, structured_output: plan });

function okRunner(stdout: string): PlannerRunner {
  return async () => ({ stdout, exitCode: 0 });
}

type PlanInput = Parameters<ReturnType<typeof createClaudePlanner>['plan']>[0];

const baseInput = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  objective: 'Criar o login',
  criteria: ['Entra com e-mail'],
  cwd: 'C:/projeto',
  signal: new AbortController().signal,
  ...overrides,
});

function planner(run: PlannerRunner, timeoutMs?: number) {
  return createClaudePlanner({
    command: 'claude',
    env: { PATH: 'x' },
    run,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe('parsePlannerOutput', () => {
  it('transforma a saída real do CLI em tarefas válidas', () => {
    const result = parsePlannerOutput(realOutput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(1);
    expect(result.data[0]).toEqual({
      title: expect.any(String),
      description: expect.any(String),
      role: expect.any(String),
      dependsOn: [],
    });
    expect(result.data.some((t) => t.dependsOn.length > 0)).toBe(true);
  });

  it('usa o texto de result quando o campo estruturado falta', () => {
    const envelopeJson = JSON.parse(realOutput) as Record<string, unknown>;
    delete envelopeJson['structured_output'];

    const result = parsePlannerOutput(JSON.stringify(envelopeJson));

    expect(result.ok).toBe(true);
  });

  it('recusa JSON cercado de markdown no texto de result', () => {
    const text = '```json\n' + JSON.stringify({ tasks: [task()] }) + '\n```';

    const result = parsePlannerOutput(JSON.stringify({ is_error: false, result: text }));

    expect(result).toMatchObject({ ok: false, error: { message: BAD_FORMAT } });
  });

  it('recusa JSON com texto antes no result', () => {
    const text = 'Aqui está o plano: ' + JSON.stringify({ tasks: [task()] });

    const result = parsePlannerOutput(JSON.stringify({ is_error: false, result: text }));

    expect(result).toMatchObject({ ok: false, error: { message: BAD_FORMAT } });
  });

  it('recusa saída que não é um envelope JSON', () => {
    for (const stdout of ['', 'não é json', '[]', 'null', '"texto"']) {
      expect(parsePlannerOutput(stdout)).toMatchObject({
        ok: false,
        error: { message: BAD_FORMAT },
      });
    }
  });

  it('recusa plano com tipos fora do esperado', () => {
    const bad = [
      { tasks: 'x' },
      [task()],
      { tasks: [null] },
      { tasks: [task({ title: 3 })] },
      { tasks: [task({ description: undefined })] },
      { tasks: [task({ role: 'chefe' })] },
      { tasks: [task({ role: 7 })] },
      { tasks: [task({ dependsOn: 'x' })] },
      { tasks: [task({ dependsOn: [1.5] })] },
      { tasks: [task({ dependsOn: ['1'] })] },
    ];
    for (const plan of bad) {
      expect(parsePlannerOutput(envelope(plan))).toMatchObject({
        ok: false,
        error: { message: BAD_FORMAT },
      });
    }
  });

  it('devolve erro de validação para lista vazia, 13 tarefas e dependência para frente', () => {
    const thirteen = Array.from({ length: 13 }, () => task());
    const plans = [
      { tasks: [] },
      { tasks: thirteen },
      { tasks: [task({ dependsOn: [2] }), task()] },
    ];
    for (const plan of plans) {
      expect(parsePlannerOutput(envelope(plan))).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
  });

  it('trata is_error do envelope como falha de resposta', () => {
    const generic = JSON.stringify({ is_error: true, result: 'Quota exceeded' });
    const login = JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' });

    expect(parsePlannerOutput(generic)).toMatchObject({
      ok: false,
      error: { code: 'AGENT_UNAVAILABLE', message: NO_RESPONSE },
    });
    expect(parsePlannerOutput(login)).toMatchObject({
      ok: false,
      error: { code: 'AGENT_AUTH_REQUIRED', message: NO_RESPONSE },
    });
  });
});

describe('buildPlannerArgs', () => {
  it('é só leitura, sem sessão salva e sem configuração do projeto, MCP ou ferramentas fora da pasta', () => {
    const args = buildPlannerArgs();

    expect(args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      expect.any(String),
      '--tools',
      'Read,Grep,Glob',
      '--no-session-persistence',
      '--permission-mode',
      'plan',
      '--strict-mcp-config',
      '--restricted',
    ]);
    const schema = JSON.parse(args[4] as string) as {
      properties: {
        tasks: { maxItems: number; items: { properties: { role: { enum: string[] } } } };
      };
    };
    expect(schema.properties.tasks.maxItems).toBe(12);
    expect(schema.properties.tasks.items.properties.role.enum).toEqual([
      'frontend',
      'backend',
      'database',
      'docs',
      'qa',
      'general',
    ]);
  });
});

describe('buildPlannerPrompt', () => {
  it('traz as regras fixas e os dados da pessoa por inteiro', () => {
    const prompt = buildPlannerPrompt({
      objective: 'Obj "a"\nlinha 2 --help',
      criteria: ['c1', 'c2'],
      instruction: 'Menos tarefas',
    });

    expect(prompt).toContain('frontend, backend, database, docs, qa, general');
    expect(prompt).toContain('No máximo 12 tarefas');
    expect(prompt).toContain('Obj "a"\nlinha 2 --help');
    expect(prompt).toContain('1. c1\n2. c2');
    expect(prompt).toContain('Menos tarefas');
  });

  it('omite a instrução quando não há', () => {
    expect(buildPlannerPrompt({ objective: 'O', criteria: ['c'] })).not.toContain('INSTRUÇÃO');
    expect(
      buildPlannerPrompt({ objective: 'O', criteria: ['c'], instruction: '  ' }),
    ).not.toContain('INSTRUÇÃO');
  });
});

describe('createClaudePlanner', () => {
  it('devolve o plano da saída real', async () => {
    const result = await planner(okRunner(realOutput)).plan(baseInput());

    expect(result.ok).toBe(true);
  });

  it('manda o prompt inteiro pelo stdin e só os argumentos fixos na linha de comando', async () => {
    const calls: Parameters<PlannerRunner>[0][] = [];
    const run: PlannerRunner = async (input) => {
      calls.push(input);
      return { stdout: realOutput, exitCode: 0 };
    };
    const hostile = '--help "aspas" \'simples\'\nsegunda linha; rm -rf /';
    const controller = new AbortController();

    await createClaudePlanner({ command: 'C:/bin/claude.exe', env: { A: '1' }, run }).plan(
      baseInput({
        objective: hostile,
        criteria: ['--version', 'critério\ncom quebra'],
        instruction: '--dangerously-skip-permissions',
        cwd: 'C:/meu/projeto',
        signal: controller.signal,
      }),
    );

    expect(calls).toHaveLength(1);
    const call = calls[0] as Parameters<PlannerRunner>[0];
    expect(call.args).toEqual(buildPlannerArgs());
    expect(call.args.join(' ')).not.toContain('--help');
    expect(call.args.join(' ')).not.toContain('--dangerously-skip-permissions');
    expect(call.stdin).toContain(hostile);
    expect(call.stdin).toContain('critério\ncom quebra');
    expect(call.stdin).toContain('--dangerously-skip-permissions');
    expect(call.command).toBe('C:/bin/claude.exe');
    expect(call.cwd).toBe('C:/meu/projeto');
    expect(call.env).toEqual({ A: '1' });
    expect(call.timeoutMs).toBe(180_000);
    expect(call.signal).toBe(controller.signal);
  });

  it('o prefixo do comando vem antes dos argumentos fixos, e o ambiente extra vale por cima do ambiente', async () => {
    const calls: Parameters<PlannerRunner>[0][] = [];
    const run: PlannerRunner = async (input) => {
      calls.push(input);
      return { stdout: realOutput, exitCode: 0 };
    };

    await createClaudePlanner({
      command: 'C:/app/electron.exe',
      commandPrefix: ['C:/e2e/falso.mjs'],
      env: { A: '1', ELECTRON_RUN_AS_NODE: '0' },
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
      run,
    }).plan(baseInput({ instruction: '--help' }));

    const call = calls[0] as Parameters<PlannerRunner>[0];
    expect(call.command).toBe('C:/app/electron.exe');
    expect(call.args).toEqual(['C:/e2e/falso.mjs', ...buildPlannerArgs()]);
    expect(call.env).toEqual({ A: '1', ELECTRON_RUN_AS_NODE: '1' });
    expect(call.args.join(' ')).not.toContain('--help');
  });

  it('usa o tempo limite dado', async () => {
    let seen = 0;
    await planner(async (input) => {
      seen = input.timeoutMs;
      return { stdout: realOutput, exitCode: 0 };
    }, 5_000).plan(baseInput());

    expect(seen).toBe(5_000);
  });

  it('código de saída diferente de zero vira a mensagem de resposta', async () => {
    const result = await planner(async () => ({ stdout: '', exitCode: 1 })).plan(baseInput());

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'AGENT_UNAVAILABLE', message: NO_RESPONSE },
    });
  });

  it('texto de login na saída vira pedido de login, com a mesma mensagem', async () => {
    const result = await planner(async () => ({
      stdout: 'Not logged in · Please run /login',
      exitCode: 1,
    })).plan(baseInput());

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'AGENT_AUTH_REQUIRED', message: NO_RESPONSE },
    });
  });

  it('executável ausente (ENOENT) vira "Claude Code não encontrado"', async () => {
    const result = await planner(async () => {
      throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    }).plan(baseInput());

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'AGENT_UNAVAILABLE', message: 'Claude Code não encontrado' },
    });
  });

  it('tempo esgotado vira a mensagem de demora', async () => {
    const result = await planner(async () => {
      throw new PlannerTimeoutError(180_000);
    }).plan(baseInput());

    expect(result).toMatchObject({
      ok: false,
      error: { message: 'O planejamento demorou demais.' },
    });
  });

  it('saída grande demais vira plano fora do formato, não tempo esgotado', async () => {
    const result = await planner(async () => {
      throw new PlannerOutputTooLargeError(8 * 1024 * 1024);
    }).plan(baseInput());

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'AGENT_PROTOCOL_ERROR', message: BAD_FORMAT },
    });
  });

  it('nunca rejeita: runner que rejeita vira falha com mensagem fixa, sem vazar o erro', async () => {
    const rejections: unknown[] = [
      new Error('spawn EACCES: caminho secreto C:\\Users\\x'),
      'texto solto',
      undefined,
      Object.assign(new Error('boom secreto'), { code: 'EACCES' }),
    ];
    for (const reason of rejections) {
      const result = await planner(() => Promise.reject(reason)).plan(baseInput());

      expect(result).toMatchObject({ ok: false, error: { message: NO_RESPONSE } });
      expect(JSON.stringify(result)).not.toContain('secreto');
    }
  });

  it('nunca rejeita: runner que lança de forma síncrona também vira falha', async () => {
    const result = await planner(() => {
      throw new Error('falha síncrona');
    }).plan(baseInput());

    expect(result).toMatchObject({ ok: false, error: { message: NO_RESPONSE } });
  });

  it('aborto pelo signal chega ao processo e vira falha de cancelamento', async () => {
    const controller = new AbortController();
    let sawAbort = false;
    const run: PlannerRunner = (input) =>
      new Promise((_, reject) => {
        input.signal.addEventListener('abort', () => {
          sawAbort = true;
          reject(new Error('The operation was aborted'));
        });
      });

    const pending = planner(run).plan(baseInput({ signal: controller.signal }));
    controller.abort();
    const result = await pending;

    expect(sawAbort).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'O planejamento foi cancelado.' },
    });
  });

  it('plano inválido volta como erro de validação, sem rejeitar', async () => {
    const result = await planner(okRunner(envelope({ tasks: [] }))).plan(baseInput());

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });
});

describe('createClaudePlanner: cota esgotada', () => {
  const quotaEnvelope = JSON.stringify({ is_error: true, result: 'Quota exceeded' });

  it('com a cota esgotada, a falha traz a mensagem da cota, não "não respondeu"', async () => {
    const quota = 'A cota do Claude acabou. Renova às 20:49.';
    const result = await createClaudePlanner({
      command: 'claude',
      env: {},
      run: okRunner(quotaEnvelope),
      quotaMessage: () => quota,
    }).plan(baseInput());

    expect(result).toEqual({
      ok: false,
      error: { code: 'AGENT_UNAVAILABLE', message: quota, retryable: false },
    });
  });

  it('sem cota esgotada, a falha segue com a mensagem de sempre', async () => {
    const result = await createClaudePlanner({
      command: 'claude',
      env: {},
      run: okRunner(quotaEnvelope),
      quotaMessage: () => undefined,
    }).plan(baseInput());

    expect(result).toMatchObject({ ok: false, error: { message: NO_RESPONSE } });
  });

  it('uma falha que não é de resposta (tempo esgotado) não pergunta a cota', async () => {
    let asked = false;
    const result = await createClaudePlanner({
      command: 'claude',
      env: {},
      run: () => Promise.reject(new PlannerTimeoutError(1000)),
      quotaMessage: () => {
        asked = true;
        return 'cota';
      },
    }).plan(baseInput());

    expect(asked).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'O planejamento demorou demais.' },
    });
  });
});
