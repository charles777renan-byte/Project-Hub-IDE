import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  createProjectRepository,
  createTerminalSessionRepository,
  openDatabase,
} from '@project-hub/database';
import type { Page } from '@playwright/test';
import { claudeFolderOf, jsonl, localAt, two, writeText } from './atividade-agentes';
import { expect, test } from './fixtures';
import { addGitProject } from './missions';

// O bloco "Visão geral" do Início, pela janela do Electron construído: o canal `activity:agents:v1`, a leitura
// dos arquivos de sessão dos CLIs e a ligação deles aos terminais do app. As pastas dos CLIs são trocadas pelas
// variáveis de teste (`PROJECT_HUB_CLAUDE_DIR`, `PROJECT_HUB_CODEX_HOME` e `PROJECT_HUB_AGY_HISTORY`, aceitas só
// com `PROJECT_HUB_ENV=test`) para pastas dentro da pasta de dados descartável: nada vem do `~/.claude`, do
// `~/.codex` nem do `~/.gemini` de quem roda. Os terminais são semeados no banco com o app fechado, já
// encerrados, em dias de ontem para trás, e cada sessão de CLI cai dentro do horário de um deles.
//
// Os números são sintéticos e as contas são feitas à mão:
//   Claude (2 dias atrás, 10h): 1 mensagem, resposta de 1.000 de entrada e 500 de saída  -> 1.500 tokens
//   Claude (ontem, 11h): 1 mensagem, resposta de 200 de entrada e 100 de saída            ->   300 tokens
//   Codex (2 dias atrás, 14h): 2 mensagens; o acumulado vai de (2.000 - 500 em cache + 300 de saída = 1.800)
//     a (3.000 - 1.000 + 500 = 2.500), então o dia soma 2.500                             -> 2.500 tokens
//   Antigravity (ontem, 12h): 1 mensagem, sem tokens (o histórico dele não os traz)
// Total: 5 mensagens e 4.300 tokens, "sem Antigravity CLI". Há 3 mensagens 2 dias atrás (Codex lidera) e 2 ontem.

/** O nome do dia como o app o escreve ("24 de out."), pela mesma biblioteca de datas da janela. */
function dayLabel(page: Page, date: Date): Promise<string> {
  return page.evaluate(
    (ms) =>
      new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(new Date(ms)),
    date.getTime(),
  );
}

test('Visão geral: soma mensagens e tokens do que o app abriu, por agente e por dia', async ({
  launchApp,
  gitRepo,
  dataDir,
  claudeConfigDir,
  codexHome,
  antigravityHistory,
}, testInfo) => {
  const projectName = basename(gitRepo.path);

  // 1. Cadastra o projeto e fecha o app, para o banco poder receber os terminais semeados.
  const first = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(first.page, projectName);
  await first.close();

  // 2. A pasta do projeto é a que o app guardou, e é por ela que as sessões se ligam aos terminais.
  const db = openDatabase(join(dataDir, 'database', 'project-hub.sqlite'));
  let projectPath: string;
  try {
    const project = createProjectRepository(db)
      .list()
      .find((item) => item.name === projectName);
    if (project === undefined) throw new Error(`O app não guardou o projeto ${projectName}.`);
    projectPath = project.path;
    const sessions = createTerminalSessionRepository(db);
    for (const provider of ['claude', 'codex', 'antigravity']) {
      sessions.insert({
        id: randomUUID(),
        projectId: project.id,
        provider,
        title: provider,
        createdAt: localAt(3, 8).toISOString(),
        closedAt: localAt(1, 20).toISOString(),
      });
    }
  } finally {
    db.$client.close();
  }

  // 3. As sessões dos CLIs, nos formatos reais deles.
  // O formato real grava o `sessionId` em toda linha; sem ele o leitor descarta a sessão (ela não tem como ser retomada).
  const claudeSessionId = randomUUID();
  const claudeLine = (kind: 'user' | 'assistant', at: Date, id: string, input = 0, output = 0) =>
    kind === 'user'
      ? {
          sessionId: claudeSessionId,
          type: 'user',
          timestamp: at.toISOString(),
          message: { role: 'user', content: 'texto' },
        }
      : {
          sessionId: claudeSessionId,
          type: 'assistant',
          timestamp: at.toISOString(),
          message: {
            id,
            role: 'assistant',
            content: [{ type: 'text', text: 'texto' }],
            usage: { input_tokens: input, output_tokens: output },
          },
        };
  writeText(
    join(claudeConfigDir, 'projects', claudeFolderOf(projectPath), 'sessao-e2e.jsonl'),
    jsonl(
      claudeLine('user', localAt(2, 10), ''),
      claudeLine('assistant', localAt(2, 10, 1), 'msg_1', 1000, 500),
      claudeLine('user', localAt(1, 11), ''),
      claudeLine('assistant', localAt(1, 11, 1), 'msg_2', 200, 100),
    ),
  );

  const codexDay = localAt(2, 14);
  const codexEvent = (at: Date, payload: unknown) => ({
    timestamp: at.toISOString(),
    type: 'event_msg',
    payload,
  });
  const codexUser = (at: Date) =>
    codexEvent(at, {
      type: 'item_completed',
      item: { type: 'UserMessage', content: [{ type: 'text', text: 'texto' }] },
    });
  const codexTokens = (at: Date, input: number, cached: number, output: number) =>
    codexEvent(at, {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
      },
    });
  writeText(
    join(
      codexHome,
      'sessions',
      String(codexDay.getFullYear()),
      two(codexDay.getMonth() + 1),
      two(codexDay.getDate()),
      'rollout-e2e.jsonl',
    ),
    jsonl(
      {
        timestamp: codexDay.toISOString(),
        type: 'session_meta',
        payload: { id: randomUUID(), cwd: projectPath, timestamp: codexDay.toISOString() },
      },
      codexUser(localAt(2, 14, 1)),
      codexTokens(localAt(2, 14, 2), 2000, 500, 300),
      codexUser(localAt(2, 14, 5)),
      codexTokens(localAt(2, 14, 6), 3000, 1000, 500),
    ),
  );

  writeText(
    antigravityHistory,
    jsonl({
      display: 'texto',
      timestamp: localAt(1, 12).getTime(),
      workspace: projectPath,
      conversationId: 'conversa-e2e',
    }),
  );

  // 4. Reabre o app: o Início mostra o bloco no topo, com os totais esperados.
  const { page, close } = await launchApp();
  // A CSP do app não aceita estilo escrito: o mapa, a tabela e as barras (SVG) não podem gerar violação.
  await page.evaluate(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const block = page.getByRole('region', { name: 'Visão geral' });
  await expect(block).toBeVisible();
  const needsYou = page.getByRole('region', { name: 'Precisa de você' });
  const blockTop = (await block.boundingBox())?.y ?? Number.NaN;
  const needsYouTop = (await needsYou.boundingBox())?.y ?? Number.NaN;
  expect(blockTop).toBeLessThan(needsYouTop);

  const messagesMap = block.getByRole('group', { name: '5 mensagens nos últimos 90 dias.' });
  await expect(messagesMap).toBeVisible();
  const stats = block.getByRole('list', { name: 'Resumo do período' });
  // O valor mostra o número curto (aria-hidden) e guarda o inteiro para o leitor de tela.
  const shown = (label: string) =>
    stats
      .getByRole('listitem')
      .filter({ hasText: label })
      .locator('.overview-total__value > span[title] > span[aria-hidden="true"]');
  const total = (label: string) =>
    stats.getByRole('listitem').filter({ hasText: label }).locator('.overview-total__value');
  await expect(shown('Mensagens no período')).toHaveText('5');
  await expect(shown('Tokens no período')).toHaveText('4,3k');
  await expect(total('Tokens no período')).toContainText('4.300');
  await expect(total('Tokens no período')).toContainText('sem Antigravity CLI');

  // O dia 2 dias atrás reúne o Claude (1) e o Codex (2); o Codex lidera. Ontem, o Claude e o Antigravity.
  const twoDaysAgo = await dayLabel(page, localAt(2, 12));
  const yesterday = await dayLabel(page, localAt(1, 12));
  await expect(
    messagesMap.getByRole('img', { name: `${twoDaysAgo}: 3 mensagens, Codex` }),
  ).toBeVisible();
  await expect(
    messagesMap.getByRole('img', { name: `${yesterday}: 2 mensagens, Claude Code` }),
  ).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('visao-geral.png') });

  // 5. A aba Tokens troca o mapa e o total.
  await block.getByRole('tab', { name: 'Tokens' }).click();
  const tokensMap = block.getByRole('group', { name: '4.300 tokens nos últimos 90 dias.' });
  await expect(tokensMap).toBeVisible();
  await expect(messagesMap).toHaveCount(0);
  await expect(
    tokensMap.getByRole('img', { name: `${twoDaysAgo}: 4.000 tokens, Codex` }),
  ).toBeVisible();

  // 6. O Antigravity não tem tokens: o mapa dá lugar ao aviso, e nada vira zero.
  await block.getByRole('button', { name: 'Antigravity CLI' }).click();
  await expect(block.getByText('Tokens indisponíveis para o Antigravity CLI.')).toBeVisible();
  await expect(block.getByRole('group', { name: /tokens/ })).toHaveCount(0);

  const violations = await page.evaluate(
    () => (window as unknown as { cspViolations: string[] }).cspViolations,
  );
  expect(violations).toEqual([]);

  await close();
});
