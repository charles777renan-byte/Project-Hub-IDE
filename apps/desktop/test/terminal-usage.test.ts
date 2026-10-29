import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookRecord } from '@project-hub/agent-adapters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerminalUsageService } from '../src/main/terminal-usage';

const SESSION = '11111111-2222-3333-4444-555555555555';
const CLEARED = '66666666-7777-8888-9999-000000000000';

/** Linha de resposta no formato do transcript do Claude Code, com texto fictício. */
function assistantLine(id: string, input: number, output: number): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model: 'claude-sonnet-5-5',
      id,
      role: 'assistant',
      content: [{ type: 'text', text: 'texto fictício' }],
      usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0 },
    },
  });
}

let configDir = '';
let projectDir = '';
beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'ph-terminal-usage-'));
  projectDir = join(configDir, 'projects', 'C--dev-app');
  mkdirSync(projectDir, { recursive: true });
});
afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

function transcript(session: string): string {
  return join(projectDir, `${session}.jsonl`);
}

function answer(session: string, id: string, input: number, output: number): void {
  appendFileSync(transcript(session), `${assistantLine(id, input, output)}\n`);
}

/** Log de hooks em memória, como o do processo de terminais: um por terminal, `seq` de 1 em diante. */
function hookLog(pageSize = 100) {
  const logs = new Map<string, HookRecord[]>();
  const reads: { terminalId: string; afterSeq: number }[] = [];
  let failing = false;
  return {
    reads,
    fail(value: boolean) {
      failing = value;
    },
    push(terminalId: string, payload: Record<string, unknown>) {
      const log = logs.get(terminalId) ?? [];
      log.push({ seq: log.length + 1, receivedAt: '2026-10-28T12:00:00.000Z', payload });
      logs.set(terminalId, log);
    },
    hooks: {
      readAfter(terminalId: string, afterSeq: number): Promise<HookRecord[]> {
        reads.push({ terminalId, afterSeq });
        if (failing) return Promise.reject(new Error('pipe fechado'));
        const log = logs.get(terminalId) ?? [];
        return Promise.resolve(log.filter((r) => r.seq > afterSeq).slice(0, pageSize));
      },
    },
  };
}

function sessionStart(session: string, source = 'startup'): Record<string, unknown> {
  return {
    hook_event_name: 'SessionStart',
    source,
    session_id: session,
    transcript_path: transcript(session),
  };
}

function setup(log = hookLog()) {
  let clock = 10_000;
  const service = createTerminalUsageService({
    hooks: log.hooks,
    configDir,
    now: () => clock,
  });
  return {
    service,
    log,
    advance(ms: number) {
      clock += ms;
    },
  };
}

describe('gasto de tokens por terminal', () => {
  it('terminal não acompanhado, ou sem hook de início, não tem número', async () => {
    const h = setup();
    expect(await h.service.usageOf('t1')).toBeUndefined();

    h.service.track('t1');
    expect(await h.service.usageOf('t1')).toBeUndefined();
  });

  it('aprende o transcript pelo SessionStart e soma as respostas', async () => {
    const h = setup();
    h.service.track('t1');
    h.log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 10, 100);
    answer(SESSION, 'msg_2', 5, 20);

    expect(await h.service.usageOf('t1')).toMatchObject({ inputTokens: 15, outputTokens: 120 });
  });

  it('lê os hooks em ordem, de onde parou, mesmo quando a resposta vem cortada', async () => {
    const h = setup(hookLog(1));
    h.service.track('t1');
    h.log.push('t1', { hook_event_name: 'SessionEnd', reason: 'other' });
    h.log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 1, 7);

    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 7 });
    expect(h.log.reads.map((r) => r.afterSeq)).toEqual([0, 1, 2]);
  });

  it('um /clear abre outra sessão, que entra na mesma soma', async () => {
    const h = setup();
    h.service.track('t1');
    h.log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 10, 100);
    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 100 });

    h.log.push('t1', { hook_event_name: 'SessionEnd', reason: 'clear', session_id: SESSION });
    h.log.push('t1', sessionStart(CLEARED, 'clear'));
    answer(CLEARED, 'msg_2', 3, 30);
    h.advance(1500);

    expect(await h.service.usageOf('t1')).toMatchObject({ inputTokens: 13, outputTokens: 130 });
  });

  it('terminal recuperado depois de reiniciar o app relê o log do começo e refaz o total', async () => {
    const log = hookLog();
    const before = setup(log);
    before.service.track('t1');
    log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 10, 100);
    log.push('t1', { hook_event_name: 'SessionEnd', reason: 'clear' });
    log.push('t1', sessionStart(CLEARED, 'clear'));
    answer(CLEARED, 'msg_2', 3, 30);
    const original = await before.service.usageOf('t1');

    // Outra execução do app: serviço novo, mesmo log de hooks em disco e mesmos transcripts.
    log.reads.length = 0;
    const after = setup(log);
    after.service.track('t1');

    expect(await after.service.usageOf('t1')).toEqual(original);
    expect(log.reads[0]).toEqual({ terminalId: 't1', afterSeq: 0 });
  });

  it('ignora o hook truncado, que chega sem conteúdo, e segue para o próximo', async () => {
    const h = setup();
    h.service.track('t1');
    h.log.push('t1', { ...sessionStart(SESSION), truncated: true });
    answer(SESSION, 'msg_1', 10, 100);

    expect(await h.service.usageOf('t1')).toBeUndefined();

    h.log.push('t1', sessionStart(CLEARED));
    answer(CLEARED, 'msg_2', 1, 9);
    h.advance(1500);

    // Só a sessão do hook íntegro conta; a do truncado nunca foi aprendida.
    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 9 });
    expect(h.log.reads.at(-1)).toEqual({ terminalId: 't1', afterSeq: 2 });
  });

  it('lê no máximo a cada 1,5 s por terminal e, no intervalo, devolve o último total', async () => {
    const h = setup();
    h.service.track('t1');
    h.log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 10, 100);
    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 100 });
    const readsAfterFirst = h.log.reads.length;

    answer(SESSION, 'msg_2', 1, 50);
    h.advance(1499);
    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 100 });
    expect(h.log.reads.length).toBe(readsAfterFirst);

    h.advance(1);
    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 150 });
    expect(h.log.reads.length).toBeGreaterThan(readsAfterFirst);
  });

  it('total sem mudança continua sendo devolvido (o leitor só avisa quando muda)', async () => {
    const h = setup();
    h.service.track('t1');
    h.log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 10, 100);
    await h.service.usageOf('t1');
    h.advance(1500);

    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 100 });
  });

  it('pedidos ao mesmo tempo esperam a mesma leitura, sem ler duas vezes', async () => {
    const h = setup();
    h.service.track('t1');
    h.log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 10, 100);

    const [a, b] = await Promise.all([h.service.usageOf('t1'), h.service.usageOf('t1')]);

    expect(a).toMatchObject({ outputTokens: 100 });
    expect(b).toEqual(a);
    // Uma leitura: a página com o hook e a vazia que diz que o log acabou.
    expect(h.log.reads.length).toBe(2);
  });

  it('leitura que falha não lança, mantém o número e tenta de novo depois do intervalo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const h = setup();
      h.service.track('t1');
      h.log.push('t1', sessionStart(SESSION));
      answer(SESSION, 'msg_1', 10, 100);
      await h.service.usageOf('t1');

      h.log.fail(true);
      h.advance(1500);
      expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 100 });

      h.log.fail(false);
      answer(SESSION, 'msg_2', 1, 1);
      h.advance(1500);
      expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 101 });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('terminal esquecido solta o leitor: sem número e sem ler mais nada', async () => {
    const h = setup();
    h.service.track('t1');
    h.log.push('t1', sessionStart(SESSION));
    answer(SESSION, 'msg_1', 10, 100);
    await h.service.usageOf('t1');

    h.service.forget('t1');
    h.log.reads.length = 0;
    h.advance(1500);

    expect(h.service.isTracked('t1')).toBe(false);
    expect(await h.service.usageOf('t1')).toBeUndefined();
    expect(h.log.reads).toEqual([]);
  });

  it('cada terminal tem a sua soma', async () => {
    const h = setup();
    h.service.track('t1');
    h.service.track('t2');
    h.log.push('t1', sessionStart(SESSION));
    h.log.push('t2', sessionStart(CLEARED));
    answer(SESSION, 'msg_1', 10, 100);
    answer(CLEARED, 'msg_2', 1, 5);

    expect(await h.service.usageOf('t1')).toMatchObject({ outputTokens: 100 });
    expect(await h.service.usageOf('t2')).toMatchObject({ outputTokens: 5 });
  });
});
