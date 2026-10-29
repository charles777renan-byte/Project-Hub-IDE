import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
