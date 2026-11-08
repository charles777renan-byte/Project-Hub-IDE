import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createProjectRepository,
  createTerminalSessionRepository,
  openDatabase,
} from '@project-hub/database';

// Dados sintéticos para o bloco "Visão geral" do Início: as sessões dos CLIs (Claude Code, Codex e Antigravity) nos
// formatos reais deles, em pastas dentro da pasta de dados descartável do teste, e os terminais do app semeados no
// banco, já encerrados, para as sessões se ligarem a eles pela pasta do projeto e pelo horário.

/** Um instante local de `daysAgo` dias atrás, às `hour` horas e `minute` minutos. */
export function localAt(daysAgo: number, hour: number, minute = 0): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);
}

export function jsonl(...records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

export function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

/** Pasta do transcript do Claude Code para um projeto: o caminho com tudo fora de [A-Za-z0-9] trocado por `-`. */
export function claudeFolderOf(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-');
}

/** Dois dígitos, como as pastas `AAAA/MM/DD` das sessões do Codex. */
export function two(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Com o app fechado, semeia um terminal já encerrado de cada CLI, de `sinceDaysAgo` dias atrás até o fim de ontem,
 * no projeto de nome `projectName`, e devolve a pasta do projeto que o app guardou.
 */
export function seedTerminals(dataDir: string, projectName: string, sinceDaysAgo: number): string {
  const db = openDatabase(join(dataDir, 'database', 'project-hub.sqlite'));
  try {
    const project = createProjectRepository(db)
      .list()
      .find((item) => item.name === projectName);
    if (project === undefined) throw new Error(`O app não guardou o projeto ${projectName}.`);
    const sessions = createTerminalSessionRepository(db);
    for (const provider of ['claude', 'codex', 'antigravity']) {
      sessions.insert({
        id: randomUUID(),
        projectId: project.id,
        provider,
        title: provider,
        createdAt: localAt(sinceDaysAgo, 8).toISOString(),
        closedAt: localAt(1, 23, 59).toISOString(),
      });
    }
    return project.path;
  } finally {
    db.$client.close();
  }
}

/** Quantas mensagens cada agente trocou em um dia (de ontem para trás). Sem o agente, ele não usou nada. */
export type ActivityDay = {
  daysAgo: number;
  claude?: number;
  codex?: number;
  antigravity?: number;
};

// Os tamanhos de uma mensagem, para as contas baterem à mão:
//   Claude: 700 de entrada e 350 de saída por mensagem                                 -> 1.050 tokens
//   Codex: acumulado de (3.000 - 500 em cache + 800 de saída) por mensagem            -> 3.300 tokens
//   Antigravity: o histórico dele não traz tokens.
const CLAUDE_INPUT = 700;
const CLAUDE_OUTPUT = 350;
const CODEX_INPUT = 3000;
const CODEX_CACHED = 500;
const CODEX_OUTPUT = 800;

/** Grava as sessões dos três CLIs, com as mensagens de cada dia de `days`, ligadas à pasta `projectPath`. */
export function writeAgentActivity(options: {
  projectPath: string;
  claudeConfigDir: string;
  codexHome: string;
  antigravityHistory: string;
  days: ActivityDay[];
}): void {
  const { projectPath, claudeConfigDir, codexHome, antigravityHistory, days } = options;

  const claudeRecords: unknown[] = [];
  // O formato real grava o `sessionId` em toda linha; sem ele o leitor não tem como retomar a sessão e a descarta.
  const claudeSessionId = randomUUID();
  const antigravityRecords: unknown[] = [];
  for (const day of days) {
    for (let index = 0; index < (day.claude ?? 0); index += 1) {
      const asked = localAt(day.daysAgo, 9, index * 2);
      const answered = localAt(day.daysAgo, 9, index * 2 + 1);
      claudeRecords.push(
        {
          sessionId: claudeSessionId,
          type: 'user',
          timestamp: asked.toISOString(),
          message: { role: 'user', content: 'texto' },
        },
        {
          sessionId: claudeSessionId,
          type: 'assistant',
          timestamp: answered.toISOString(),
          message: {
            id: `msg_${day.daysAgo}_${index}`,
            role: 'assistant',
            content: [{ type: 'text', text: 'texto' }],
            usage: { input_tokens: CLAUDE_INPUT, output_tokens: CLAUDE_OUTPUT },
          },
        },
      );
    }
    for (let index = 0; index < (day.antigravity ?? 0); index += 1) {
      antigravityRecords.push({
        display: 'texto',
        timestamp: localAt(day.daysAgo, 12, index).getTime(),
        workspace: projectPath,
        conversationId: `conversa-${day.daysAgo}`,
      });
    }

    const codexMessages = day.codex ?? 0;
    if (codexMessages > 0) {
      const start = localAt(day.daysAgo, 14);
      const events: unknown[] = [
        {
          timestamp: start.toISOString(),
          type: 'session_meta',
          payload: { id: randomUUID(), cwd: projectPath, timestamp: start.toISOString() },
        },
      ];
      for (let index = 0; index < codexMessages; index += 1) {
        const total = index + 1;
        events.push(
          {
            timestamp: localAt(day.daysAgo, 14, 1 + index * 3).toISOString(),
            type: 'event_msg',
            payload: {
              type: 'item_completed',
              item: { type: 'UserMessage', content: [{ type: 'text', text: 'texto' }] },
            },
          },
          {
            timestamp: localAt(day.daysAgo, 14, 2 + index * 3).toISOString(),
            type: 'event_msg',
            payload: {
              type: 'token_count',
              info: {
                total_token_usage: {
                  input_tokens: CODEX_INPUT * total,
                  cached_input_tokens: CODEX_CACHED * total,
                  output_tokens: CODEX_OUTPUT * total,
                },
              },
            },
          },
        );
      }
      const when = localAt(day.daysAgo, 14);
      writeText(
        join(
          codexHome,
          'sessions',
          String(when.getFullYear()),
          two(when.getMonth() + 1),
          two(when.getDate()),
          `rollout-e2e-${day.daysAgo}.jsonl`,
        ),
        jsonl(...events),
      );
    }
  }

  if (claudeRecords.length > 0) {
    writeText(
      join(claudeConfigDir, 'projects', claudeFolderOf(projectPath), 'sessao-e2e.jsonl'),
      jsonl(...claudeRecords),
    );
  }
  if (antigravityRecords.length > 0) {
    writeText(antigravityHistory, jsonl(...antigravityRecords));
  }
}
