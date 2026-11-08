import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeConfigDirOf,
  createTranscriptUsageTracker,
  readUsageLine,
  takeCompleteLines,
} from '../../src/claude-code/transcript-usage';

const SESSION = '11111111-2222-3333-4444-555555555555';
const OTHER_SESSION = '66666666-7777-8888-9999-000000000000';

type UsageFields = {
  input?: number;
  output?: number;
  cacheRead?: number;
  write5m?: number;
  write1h?: number;
};

/** Linha de resposta no formato do transcript do Claude Code 2.1.312, com texto fictício. */
export function assistantLine(id: string, usage: UsageFields, model = 'claude-sonnet-5-5'): string {
  const write5m = usage.write5m ?? 0;
  const write1h = usage.write1h ?? 0;
  return JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      model,
      id,
      role: 'assistant',
      content: [{ type: 'text', text: 'texto da resposta, que não sai do arquivo' }],
      usage: {
        input_tokens: usage.input ?? 0,
        cache_creation_input_tokens: write5m + write1h,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        output_tokens: usage.output ?? 0,
        cache_creation: { ephemeral_5m_input_tokens: write5m, ephemeral_1h_input_tokens: write1h },
        inference_geo: 'global',
        speed: 'standard',
      },
    },
  });
}

const OTHER_LINE = JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } });

/** Como `assistantLine`, mas com `timestamp` (ISO) quando informado. */
function timedLine(
  id: string,
  timestamp: string | undefined,
  usage: UsageFields,
  model = 'claude-sonnet-5-5',
): string {
  const record = JSON.parse(assistantLine(id, usage, model)) as Record<string, unknown>;
  if (timestamp !== undefined) record['timestamp'] = timestamp;
  return JSON.stringify(record);
}

const T1 = '2026-11-08T10:00:00.000Z';
const T2 = '2026-11-08T10:05:00.000Z';
const T3 = '2026-11-08T10:10:00.000Z';

let configDir = '';
let projectDir = '';
beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'ph-transcript-'));
  projectDir = join(configDir, 'projects', 'C--projeto');
  mkdirSync(projectDir, { recursive: true });
});
afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

function sessionFile(session = SESSION): string {
  return join(projectDir, `${session}.jsonl`);
}

describe('takeCompleteLines', () => {
  it('fica só com as linhas completas e deixa a parcial para depois', () => {
    const bytes = Buffer.from('{"a":1}\n{"b":"ação"}\n{"c":', 'utf8');
    const { lines, consumed } = takeCompleteLines(bytes);
    expect(lines).toEqual(['{"a":1}', '{"b":"ação"}']);
    expect(bytes.subarray(consumed).toString('utf8')).toBe('{"c":');
  });

  it('sem quebra de linha, não consome nada', () => {
    expect(takeCompleteLines(Buffer.from('{"a":'))).toEqual({ lines: [], consumed: 0 });
  });
});

describe('readUsageLine', () => {
  it('lê só os números da resposta, com a escrita de cache por validade', () => {
    expect(readUsageLine(assistantLine('msg_1', { input: 2, output: 9, cacheRead: 5, write1h: 7 }))).toEqual({
      id: 'msg_1',
      usage: {
        model: 'claude-sonnet-5-5',
        inputTokens: 2,
        outputTokens: 9,
        cacheReadInputTokens: 5,
        cacheWrite5mInputTokens: 0,
        cacheWrite1hInputTokens: 7,
        speed: 'standard',
        inferenceGeo: 'global',
      },
    });
  });

  it('sem a divisão por validade, a escrita conta como de 5 minutos', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_1',
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 40 },
      },
    });
    expect(readUsageLine(line)?.usage).toMatchObject({
      cacheWrite5mInputTokens: 40,
      cacheWrite1hInputTokens: 0,
    });
  });

  it('ignora linha que não é resposta, JSON quebrado e número inválido', () => {
    expect(readUsageLine(OTHER_LINE)).toBeUndefined();
    expect(readUsageLine('{"type":"assistant","usage":')).toBeUndefined();
    expect(
      readUsageLine(
        JSON.stringify({
          type: 'assistant',
          message: { id: 'msg_1', usage: { input_tokens: -1, output_tokens: 2 } },
        }),
      ),
    ).toBeUndefined();
  });

  it('devolve `at` em milissegundos quando o timestamp é um ISO válido', () => {
    expect(readUsageLine(timedLine('msg_1', '2026-11-08T10:00:00.000Z', { output: 1 }))?.at).toBe(
      Date.parse('2026-11-08T10:00:00.000Z'),
    );
  });

  it('sem timestamp, ou com um que não é data, não devolve `at`', () => {
    expect(readUsageLine(timedLine('msg_1', undefined, { output: 1 }))).not.toHaveProperty('at');
    expect(readUsageLine(timedLine('msg_1', 'ontem', { output: 1 }))).not.toHaveProperty('at');
  });
});

describe('createTranscriptUsageTracker', () => {
  it('conta cada resposta uma vez, com o maior valor visto enquanto ela é gerada', async () => {
    writeFileSync(
      sessionFile(),
      [
        OTHER_LINE,
        assistantLine('msg_1', { input: 2, output: 10, cacheRead: 100 }),
        assistantLine('msg_1', { input: 2, output: 40, cacheRead: 100 }),
        assistantLine('msg_2', { input: 1, output: 5, write5m: 20 }),
        assistantLine('msg_1', { input: 2, output: 40, cacheRead: 100 }),
        '',
      ].join('\n'),
    );
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);

    expect(await tracker.poll()).toMatchObject({
      inputTokens: 3,
      outputTokens: 45,
      cacheReadInputTokens: 100,
      cacheWrite5mInputTokens: 20,
      cacheWrite1hInputTokens: 0,
    });
    // Sem nada novo, não repete o total.
    expect(await tracker.poll()).toBeUndefined();
  });

  it('a linha parcial do fim entra quando o Claude Code termina de gravá-la', async () => {
    const full = assistantLine('msg_2', { output: 7 });
    writeFileSync(sessionFile(), `${assistantLine('msg_1', { output: 3 })}\n${full.slice(0, 30)}`);
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);

    expect((await tracker.poll())?.outputTokens).toBe(3);
    appendFileSync(sessionFile(), `${full.slice(30)}\n`);
    expect((await tracker.poll())?.outputTokens).toBe(10);
  });

  it('soma os subagentes e a sessão aberta por um /clear, sem contar duas vezes a mesma resposta', async () => {
    writeFileSync(sessionFile(), `${assistantLine('msg_1', { output: 10 })}\n`);
    const subagents = join(projectDir, SESSION, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      join(subagents, 'agent-abc123.jsonl'),
      `${assistantLine('msg_sub', { output: 4 })}\n${assistantLine('msg_1', { output: 10 })}\n`,
    );
    writeFileSync(join(subagents, 'agent-abc123.meta.json'), '{}');
    writeFileSync(sessionFile(OTHER_SESSION), `${assistantLine('msg_3', { output: 1 })}\n`);
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    tracker.addSession(sessionFile(OTHER_SESSION), OTHER_SESSION);

    expect((await tracker.poll())?.outputTokens).toBe(15);
  });

  it('não lê subagentes de uma pasta de sessão que é um link para fora da pasta de projetos', async () => {
    writeFileSync(sessionFile(), `${assistantLine('msg_1', { output: 10 })}
`);
    const outside = mkdtempSync(join(tmpdir(), 'ph-fora-'));
    try {
      mkdirSync(join(outside, 'subagents'));
      writeFileSync(
        join(outside, 'subagents', 'agent-abc123.jsonl'),
        `${assistantLine('msg_fora', { output: 999 })}
`,
      );
      symlinkSync(outside, join(projectDir, SESSION), 'junction');
      const tracker = createTranscriptUsageTracker({ configDir });
      tracker.addSession(sessionFile(), SESSION);

      expect((await tracker.poll())?.outputTokens).toBe(10);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('espera o arquivo existir: no SessionStart ele ainda não foi criado', async () => {
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    expect(await tracker.poll()).toBeUndefined();

    writeFileSync(sessionFile(), `${assistantLine('msg_1', { output: 2 })}\n`);
    expect((await tracker.poll())?.outputTokens).toBe(2);
  });

  it('recusa o caminho fora da pasta de projetos, fora do formato ou de outra sessão', async () => {
    const outside = join(configDir, `${SESSION}.jsonl`);
    writeFileSync(outside, `${assistantLine('msg_x', { output: 99 })}\n`);
    const deeper = join(projectDir, 'outra', `${SESSION}.jsonl`);
    mkdirSync(join(projectDir, 'outra'));
    writeFileSync(deeper, `${assistantLine('msg_y', { output: 99 })}\n`);
    writeFileSync(sessionFile(), `${assistantLine('msg_z', { output: 99 })}\n`);
    const tracker = createTranscriptUsageTracker({ configDir });

    tracker.addSession(outside, SESSION);
    tracker.addSession(deeper, SESSION);
    tracker.addSession(join(projectDir, '..', '..', `${SESSION}.jsonl`), SESSION);
    tracker.addSession(sessionFile(), OTHER_SESSION);
    tracker.addSession('relativo/arquivo.jsonl', 'arquivo');

    expect(await tracker.poll()).toBeUndefined();
  });

  it('dá o custo estimado quando todos os modelos têm preço, e o tira quando não', async () => {
    writeFileSync(sessionFile(), `${assistantLine('msg_1', { output: 1_000_000 })}\n`);
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    expect((await tracker.poll())?.estimatedCostUsd).toBeCloseTo(10, 9);

    appendFileSync(sessionFile(), `${assistantLine('msg_2', { output: 1 }, 'modelo-novo')}\n`);
    const next = await tracker.poll();
    expect(next?.outputTokens).toBe(1_000_001);
    expect(next).not.toHaveProperty('estimatedCostUsd');
  });

  it('recomeça do zero quando o arquivo encolhe, sem contar duas vezes', async () => {
    writeFileSync(
      sessionFile(),
      `${assistantLine('msg_1', { output: 5 })}\n${assistantLine('msg_2', { output: 5 })}\n`,
    );
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    expect((await tracker.poll())?.outputTokens).toBe(10);

    writeFileSync(sessionFile(), `${assistantLine('msg_3', { output: 1 })}\n`);
    expect((await tracker.poll())?.outputTokens).toBe(11);
  });
});

describe('latestContext', () => {
  it('é a resposta principal mais recente por timestamp, com o modelo e o contexto dela', async () => {
    writeFileSync(
      sessionFile(),
      [
        timedLine(
          'msg_2',
          T2,
          { input: 3, cacheRead: 1000, write5m: 50, write1h: 7, output: 9 },
          'claude-opus-4-7',
        ),
        timedLine('msg_1', T1, { input: 1, cacheRead: 10 }),
        '',
      ].join('\n'),
    );
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    expect(tracker.latestContext()).toBeUndefined();

    await tracker.poll();
    // Entrada + leitura + as duas escritas de cache; a saída não conta.
    expect(tracker.latestContext()).toEqual({ model: 'claude-opus-4-7', usedTokens: 1060 });
  });

  it('com duas sessões principais (/clear), vale a de timestamp maior, mesmo lida antes', async () => {
    writeFileSync(sessionFile(), `${timedLine('msg_novo', T3, { input: 500 }, 'modelo-b')}\n`);
    writeFileSync(
      sessionFile(OTHER_SESSION),
      `${timedLine('msg_velho', T1, { input: 9000 }, 'modelo-a')}\n`,
    );
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    tracker.addSession(sessionFile(OTHER_SESSION), OTHER_SESSION);

    await tracker.poll();
    expect(tracker.latestContext()).toEqual({ model: 'modelo-b', usedTokens: 500 });
  });

  it('a resposta de um subagente, mesmo mais nova, não muda o contexto', async () => {
    writeFileSync(sessionFile(), `${timedLine('msg_main', T1, { input: 100 })}\n`);
    const subagents = join(projectDir, SESSION, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(
      join(subagents, 'agent-abc123.jsonl'),
      `${timedLine('msg_sub', T3, { input: 70_000 }, 'modelo-sub')}\n`,
    );
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);

    const summary = await tracker.poll();
    // O subagente entra na soma do uso, só não é o contexto.
    expect(summary?.inputTokens).toBe(70_100);
    expect(tracker.latestContext()).toEqual({ model: 'claude-sonnet-5-5', usedTokens: 100 });
  });

  it('a mesma resposta em várias linhas conta uma vez, com o maior valor de cada campo', async () => {
    writeFileSync(
      sessionFile(),
      [
        timedLine('msg_1', T1, { input: 2, cacheRead: 100, write5m: 5, output: 1 }),
        timedLine('msg_1', T1, { input: 4, cacheRead: 90, write5m: 5, write1h: 8, output: 30 }),
        timedLine('msg_1', T1, { input: 3, cacheRead: 100, write5m: 2, output: 30 }),
        '',
      ].join('\n'),
    );
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);

    await tracker.poll();
    expect(tracker.latestContext()?.usedTokens).toBe(4 + 100 + 5 + 8);
  });

  it('resposta sem usage válido não cria contexto', async () => {
    const semUsage = JSON.stringify({
      type: 'assistant',
      timestamp: T1,
      message: { id: 'msg_1', model: 'claude-sonnet-5-5', content: [] },
    });
    const usageInvalido = JSON.stringify({
      type: 'assistant',
      timestamp: T2,
      message: {
        id: 'msg_2',
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: -1, output_tokens: 2 },
      },
    });
    writeFileSync(sessionFile(), `${semUsage}\n${usageInvalido}\n`);
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);

    await tracker.poll();
    expect(tracker.latestContext()).toBeUndefined();
  });

  it('resposta sintética, com tudo zero, não cria contexto nem apaga o anterior', async () => {
    writeFileSync(sessionFile(), `${timedLine('msg_sintetica', T1, {}, '<synthetic>')}\n`);
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    await tracker.poll();
    expect(tracker.latestContext()).toBeUndefined();

    appendFileSync(sessionFile(), `${timedLine('msg_real', T2, { input: 40 })}\n`);
    appendFileSync(sessionFile(), `${timedLine('msg_sintetica_2', T3, {}, '<synthetic>')}\n`);
    await tracker.poll();
    expect(tracker.latestContext()).toEqual({ model: 'claude-sonnet-5-5', usedTokens: 40 });
  });

  it('sem timestamp, vale a ordem de leitura', async () => {
    writeFileSync(
      sessionFile(),
      `${timedLine('msg_1', undefined, { input: 10 })}\n${timedLine('msg_2', undefined, { input: 20 })}\n`,
    );
    const tracker = createTranscriptUsageTracker({ configDir });
    tracker.addSession(sessionFile(), SESSION);
    await tracker.poll();
    expect(tracker.latestContext()?.usedTokens).toBe(20);

    // Uma resposta com timestamp, lida depois de uma sem, também vence pela ordem de leitura.
    writeFileSync(sessionFile(OTHER_SESSION), `${timedLine('msg_3', T1, { input: 30 })}\n`);
    tracker.addSession(sessionFile(OTHER_SESSION), OTHER_SESSION);
    await tracker.poll();
    expect(tracker.latestContext()?.usedTokens).toBe(30);
    appendFileSync(sessionFile(OTHER_SESSION), `${timedLine('msg_4', undefined, { input: 40 })}\n`);
    await tracker.poll();
    expect(tracker.latestContext()?.usedTokens).toBe(40);
  });
});

describe('claudeConfigDirOf', () => {
  it('usa CLAUDE_CONFIG_DIR do ambiente, com o nome em qualquer caixa', () => {
    expect(claudeConfigDirOf({ CLAUDE_CONFIG_DIR: 'D:/conta' })).toBe('D:/conta');
    expect(claudeConfigDirOf({ Claude_Config_Dir: 'D:/outra' })).toBe('D:/outra');
  });

  it('sem a variável, ou com ela vazia, cai em ~/.claude', () => {
    const fallback = join(homedir(), '.claude');
    expect(claudeConfigDirOf({})).toBe(fallback);
    expect(claudeConfigDirOf({ CLAUDE_CONFIG_DIR: '' })).toBe(fallback);
    expect(claudeConfigDirOf({ CLAUDE_CONFIG_DIR: undefined })).toBe(fallback);
  });
});
