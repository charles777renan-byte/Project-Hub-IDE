import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderRegistry } from '../../src/main/providers';
import { createResumeVerdict } from '../../src/main/resume-verdict';
import type { SessionHistory, SessionReader } from '../../src/main/session-history';
import { createSessionHistory } from '../../src/main/session-history';
import {
  createAntigravitySessionReader,
  createClaudeSessionReader,
  createCodexSessionReader,
} from '../../src/main/session-readers';

const CLAUDE_ID = '5f0c2a7e-8d1b-4c3a-9e2f-1a2b3c4d5e6f';
const CODEX_ID = '019a0c3e-7b2d-7f10-8a4e-2c5d6e7f8a9b';
const AGY_ID = '0b9d1c2e-3f4a-4b5c-8d6e-7f8091a2b3c4';
const DAY = '2026-10-30T12:00:00.000Z';

/** Os três programas instalados: o resultado não depende do que a máquina do teste tem. */
const INSTALLED: Pick<ProviderRegistry, 'list' | 'resolve'> = {
  list: () => [
    { id: 'claude', label: 'Claude Code', available: true },
    { id: 'codex', label: 'Codex', available: true },
    { id: 'antigravity', label: 'Antigravity CLI', available: true },
  ],
  resolve: () => ({ ok: true, launch: { command: 'fake', args: [] } }),
};

/** Serviços criados nos testes: o `afterEach` espera a varredura de cada um antes de apagar as pastas. */
const services: SessionHistory[] = [];

describe('session-history com os leitores reais, em pastas temporárias', () => {
  let root: string;
  let env: Record<string, string>;
  let historyFile: string;
  let indexFile: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ph-session-int-'));
    // A pasta de trabalho das três sessões é a própria pasta temporária, que existe de verdade.
    const claudeDir = join(root, 'claude');
    const codexHome = join(root, 'codex');
    const projectFolder = join(claudeDir, 'projects', 'C--proj-x');
    mkdirSync(join(projectFolder, CLAUDE_ID, 'subagents'), { recursive: true });
    writeFileSync(
      join(projectFolder, `${CLAUDE_ID}.jsonl`),
      [
        JSON.stringify({
          type: 'user',
          sessionId: CLAUDE_ID,
          cwd: root,
          timestamp: DAY,
          message: { role: 'user', content: 'primeira pergunta' },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId: CLAUDE_ID,
          cwd: root,
          timestamp: '2026-10-30T12:00:05.000Z',
          message: {
            id: 'msg_1',
            role: 'assistant',
            model: 'claude-sonnet-5-5',
            content: [{ type: 'text', text: 'resposta do agente' }],
          },
        }),
      ].join('\n') + '\n',
    );
    writeFileSync(join(projectFolder, CLAUDE_ID, 'subagents', 'agent-a1.jsonl'), '{}\n');
    writeFileSync(join(projectFolder, CLAUDE_ID, 'subagents', 'agent-a2.jsonl'), '{}\n');
    writeFileSync(join(projectFolder, CLAUDE_ID, 'subagents', 'nota.txt'), '');

    const codexDay = join(codexHome, 'sessions', '2026', '10', '30');
    mkdirSync(codexDay, { recursive: true });
    writeFileSync(
      join(codexDay, `rollout-2026-10-30T10-00-00-${CODEX_ID}.jsonl`),
      [
        JSON.stringify({
          timestamp: DAY,
          type: 'session_meta',
          payload: { id: CODEX_ID, timestamp: DAY, cwd: root },
        }),
        JSON.stringify({
          timestamp: DAY,
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            item: { type: 'UserMessage', content: [{ type: 'text', text: 'oi codex' }] },
          },
        }),
      ].join('\n') + '\n',
    );

    historyFile = join(root, 'agy', 'history.jsonl');
    mkdirSync(join(root, 'agy'), { recursive: true });
    writeFileSync(
      historyFile,
      JSON.stringify({
        display: 'oi agy',
        workspace: root,
        conversationId: AGY_ID,
        timestamp: Date.parse(DAY),
      }) + '\n',
    );

    env = { CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexHome };
    indexFile = join(root, 'userdata', 'session-index.json');
  });

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.refresh()));
    rmSync(root, { recursive: true, force: true });
  });

  function realReaders(): SessionReader[] {
    return [
      createClaudeSessionReader(env),
      createCodexSessionReader(env),
      createAntigravitySessionReader(historyFile),
    ];
  }

  function history(readers: SessionReader[]): SessionHistory {
    const service = createSessionHistory({
      indexFile,
      readers,
      projects: () => [{ id: 'p1', path: root }],
      worktreesOf: async () => [],
      resumeState: createResumeVerdict({
        folderExists: existsSync,
        providers: INSTALLED,
        projectName: () => undefined,
      }),
      windowsPaths: process.platform === 'win32',
    });
    services.push(service);
    return service;
  }

  it('lê os três programas, conta os subagentes do Claude e grava o índice na versão 1', async () => {
    const service = history(realReaders());
    await service.refresh();
    const result = await service.list({ scope: 'workspace', projectId: 'p1' });

    expect(result.sessions.map((session) => session.provider).sort()).toEqual([
      'antigravity',
      'claude',
      'codex',
    ]);
    expect(result.sessions.find((session) => session.provider === 'claude')).toMatchObject({
      id: CLAUDE_ID,
      title: 'primeira pergunta',
      firstPrompt: 'primeira pergunta',
      lastAgentText: 'resposta do agente',
      model: 'claude-sonnet-5-5',
      subagents: 2,
      messages: 1,
      resumable: true,
    });
    expect(result.sessions.find((session) => session.provider === 'codex')).toMatchObject({
      id: CODEX_ID,
      subagents: 0,
    });
    expect(result.sessions.find((session) => session.provider === 'antigravity')).toMatchObject({
      id: AGY_ID,
      resumable: false,
      resumeBlockedReason: 'Antigravity CLI não tem comando para retomar uma sessão.',
    });
    expect(
      result.indexing.map((entry) => [entry.provider, entry.read, entry.total, entry.unreadable]),
    ).toEqual([
      ['claude', 1, 1, 0],
      ['codex', 1, 1, 0],
      ['antigravity', 1, 1, 0],
    ]);
    expect(JSON.parse(readFileSync(indexFile, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('a segunda abertura não relê nenhum arquivo', async () => {
    await history(realReaders()).refresh();

    const reads: string[] = [];
    const counted = realReaders().map((reader) => ({
      ...reader,
      read: async (path: string) => {
        reads.push(path);
        return reader.read(path);
      },
    }));
    const again = history(counted);
    await again.refresh();

    expect(reads).toEqual([]);
    expect((await again.list({ scope: 'all' })).sessions).toHaveLength(3);
  });

  it('um .zst corrompido conta como ilegível do Codex, e as outras sessões seguem', async () => {
    const codexDay = join(root, 'codex', 'sessions', '2026', '10', '30');
    writeFileSync(join(codexDay, 'rollout-2026-10-30T11-00-00-bad.jsonl.zst'), 'isto não é zstd');

    const service = history(realReaders());
    await service.refresh();
    const result = await service.list({ scope: 'all' });

    expect(result.sessions).toHaveLength(3);
    expect(result.indexing.find((entry) => entry.provider === 'codex')).toEqual({
      provider: 'codex',
      read: 1,
      total: 2,
      unreadable: 1,
      sessions: 1,
    });
  });

  it('um índice corrompido é refeito, e a lista não fica vazia', async () => {
    await history(realReaders()).refresh();
    writeFileSync(indexFile, '{ isto não é json');

    const service = history(realReaders());
    await service.refresh();

    expect((await service.list({ scope: 'all' })).sessions).toHaveLength(3);
    expect(JSON.parse(readFileSync(indexFile, 'utf8'))).toMatchObject({ version: 1 });
  });
});
