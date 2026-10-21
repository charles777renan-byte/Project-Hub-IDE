import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@project-hub/agent-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSimulatedAdapter, DEMO_SCRIPT } from '../src/index';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-demo-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Percorre o roteiro demo inteiro, aprovando o pedido de aprovação quando ele chega. */
async function runDemo(): Promise<AgentEvent[]> {
  const session = await createSimulatedAdapter({ script: DEMO_SCRIPT }).start(
    { cwd: dir, prompt: 'tarefa de teste' },
    new AbortController().signal,
  );
  const events: AgentEvent[] = [];
  for await (const event of session.events()) {
    events.push(event);
    if (event.type === 'approval.requested') await session.approve({ decision: 'approved' });
  }
  return events;
}

describe('roteiro demo do agente simulado: verificação', () => {
  it('emite verification.completed depois de gravar o arquivo e antes de concluir', async () => {
    const events = await runDemo();
    const types = events.map((event) => event.type);

    const verification = types.indexOf('verification.completed');
    expect(verification).toBeGreaterThan(types.indexOf('tool.completed'));
    expect(verification).toBeLessThan(types.indexOf('session.completed'));
    expect(types.filter((type) => type === 'verification.completed')).toHaveLength(1);
  });

  it('a verificação passou, sem falhas, e não associa nenhum critério de aceite', async () => {
    const events = await runDemo();
    const verification = events.find((event) => event.type === 'verification.completed');

    expect(verification).toMatchObject({
      type: 'verification.completed',
      command: expect.stringContaining('pnpm test') as unknown,
      passed: 14,
      failed: 0,
      durationMs: expect.any(Number) as unknown,
    });
    expect(verification).not.toHaveProperty('criteria');
  });
});
