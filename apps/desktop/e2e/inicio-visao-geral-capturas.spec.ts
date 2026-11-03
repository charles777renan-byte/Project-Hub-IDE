import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locator } from '@playwright/test';
import { type ActivityDay, seedTerminals, writeAgentActivity } from './atividade-agentes';
import { expect, test } from './fixtures';
import { addGitProject } from './missions';

// Capturas de tela do bloco "Visão geral" do Início, para a pessoa que revisa o visual. Não é teste de
// comportamento: só roda com `E2E_CAPTURAS=1` (a pasta de saída vem de `E2E_CAPTURAS_DIR`, e o padrão é
// `out/capturas`). Sem a variável, o teste é pulado e o CI não grava nada. Os dados são sintéticos e vivem na pasta
// de dados descartável do teste (as pastas dos CLIs são trocadas pelas variáveis de teste); nada vem do `~/.claude`,
// do `~/.codex` nem do `~/.gemini` de quem roda.
//
// Cada cenário grava as três abas (Resumo, Mensagens e Tokens) nos quatro períodos, em janela larga e em janela
// estreita, só com o bloco na imagem: `visao-geral-<cenário>-<largura>-<aba>-<período>.png`.

const ENABLED = process.env['E2E_CAPTURAS'] === '1';
test.skip(!ENABLED, 'Capturas de tela: defina E2E_CAPTURAS=1 para gravar.');

const OUTPUT =
  process.env['E2E_CAPTURAS_DIR'] ?? join(import.meta.dirname, '..', 'out', 'capturas');

// 1920px é a janela da pessoa que pediu o redesenho (o bloco das capturas dela tem uns 1200px com a lateral e o
// painel da direita abertos); 1360px e 900px são o padrão das outras capturas do repositório.
const WIDTHS = [
  { name: '1920', width: 1920, height: 1500 },
  { name: '1360', width: 1360, height: 1500 },
  { name: '900', width: 900, height: 1500 },
] as const;
/** Larguras intermediárias, só do cenário esparso (Resumo em 90 dias e Mensagens em 30), para ver onde o corpo troca de colunas. */
const INTERMEDIATE_WIDTHS = [1100, 1200, 1280, 1340, 1500, 1600] as const;
const TABS = [
  { id: 'resumo', name: 'Resumo' },
  { id: 'mensagens', name: 'Mensagens' },
  { id: 'tokens', name: 'Tokens' },
] as const;
const PERIODS = [
  { id: '7', name: '7 dias' },
  { id: '30', name: '30 dias' },
  { id: '90', name: '90 dias' },
  { id: 'tudo', name: 'Tudo' },
] as const;

/**
 * O uso de poucos dias, como o de quem acabou de instalar o app: três dias ativos em duas semanas, com o Claude Code
 * (17 mensagens), o Codex (8) e o Antigravity (16, sem tokens).
 */
const SPARSE: ActivityDay[] = [
  { daysAgo: 8, claude: 5, antigravity: 6 },
  { daysAgo: 4, claude: 8, codex: 5, antigravity: 10 },
  { daysAgo: 1, claude: 4, codex: 3 },
];

/** O uso diário de quase sete meses, com dias de pausa e a liderança trocando entre os três agentes. */
function dailyUse(totalDays: number): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (let daysAgo = 1; daysAgo <= totalDays; daysAgo += 1) {
    days.push({
      daysAgo,
      claude: daysAgo % 7 === 0 ? 0 : 1 + ((daysAgo * 3) % 6),
      codex: daysAgo % 4 === 1 ? 1 + ((daysAgo * 5) % 4) : 0,
      antigravity: daysAgo % 5 === 2 ? 1 + (daysAgo % 3) : 0,
    });
  }
  return days;
}

type Scenario = { id: string; sinceDaysAgo: number; days: ActivityDay[] };

const SCENARIOS: Scenario[] = [
  { id: 'esparso', sinceDaysAgo: 12, days: SPARSE },
  { id: 'diario', sinceDaysAgo: 200, days: dailyUse(198) },
  { id: 'vazio', sinceDaysAgo: 12, days: [] },
];

async function shoot(block: Locator, name: string): Promise<void> {
  mkdirSync(OUTPUT, { recursive: true });
  await block.screenshot({ path: join(OUTPUT, `${name}.png`) });
}

for (const scenario of SCENARIOS) {
  test(`capturas da Visão geral: ${scenario.id}`, async ({
    launchApp,
    gitRepo,
    dataDir,
    claudeConfigDir,
    codexHome,
    antigravityHistory,
  }) => {
    test.setTimeout(300_000);
    const projectName = basename(gitRepo.path);

    // 1. Cadastra o projeto e fecha o app, para o banco poder receber os terminais semeados.
    const first = await launchApp({ dialogPath: gitRepo.path });
    await addGitProject(first.page, projectName);
    await first.close();
    const projectPath = seedTerminals(dataDir, projectName, scenario.sinceDaysAgo);
    writeAgentActivity({
      projectPath,
      claudeConfigDir,
      codexHome,
      antigravityHistory,
      days: scenario.days,
    });

    // 2. Reabre o app: o Início mostra o bloco no topo.
    const { app, page, close } = await launchApp();
    const block = page.getByRole('region', { name: 'Visão geral' });
    await expect(block).toBeVisible();

    for (const size of WIDTHS) {
      await app.evaluate(
        ({ BrowserWindow }, { width, height }) => {
          BrowserWindow.getAllWindows()[0]?.setSize(width, height);
        },
        { width: size.width, height: size.height },
      );
      await page.waitForTimeout(400);
      for (const tab of TABS) {
        await block.getByRole('tab', { name: tab.name }).click();
        for (const period of PERIODS) {
          await block.getByRole('button', { name: period.name, exact: true }).click();
          await page.waitForTimeout(150);
          await shoot(block, `visao-geral-${scenario.id}-${size.name}-${tab.id}-${period.id}`);
        }
      }
    }

    // 3. Larguras intermediárias (só no cenário esparso): a troca entre uma, duas e três colunas.
    if (scenario.id === 'esparso') {
      for (const width of INTERMEDIATE_WIDTHS) {
        await app.evaluate(
          ({ BrowserWindow }, { width: next }) => {
            BrowserWindow.getAllWindows()[0]?.setSize(next, 1500);
          },
          { width },
        );
        await page.waitForTimeout(400);
        // O mapa de 90 dias (o mais largo dos comuns) e o de 30 dias (curto, que cabe ao lado da tabela antes).
        await block.getByRole('tab', { name: 'Resumo' }).click();
        await block.getByRole('button', { name: '90 dias', exact: true }).click();
        await shoot(block, `visao-geral-${scenario.id}-${width}-resumo-90`);
        await block.getByRole('tab', { name: 'Mensagens' }).click();
        await block.getByRole('button', { name: '30 dias', exact: true }).click();
        await shoot(block, `visao-geral-${scenario.id}-${width}-mensagens-30`);
      }
    }

    // 4. Os recortes que mudam o corpo: um agente filtrado, e o agente sem tokens na aba Tokens.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1920, 1080);
    });
    await page.waitForTimeout(400);
    await block.getByRole('button', { name: 'Codex', exact: true }).click();
    await block.getByRole('tab', { name: 'Resumo' }).click();
    await block.getByRole('button', { name: '90 dias', exact: true }).click();
    await shoot(block, `visao-geral-${scenario.id}-1920-filtro-codex-resumo-90`);
    await block.getByRole('button', { name: 'Antigravity CLI', exact: true }).click();
    await block.getByRole('tab', { name: 'Tokens' }).click();
    await shoot(block, `visao-geral-${scenario.id}-1920-filtro-antigravity-tokens-90`);

    // 5. A página inteira, para ver o bloco no contexto do Início (a lateral divide a largura com ele).
    await block.getByRole('button', { name: 'Todos', exact: true }).click();
    await block.getByRole('tab', { name: 'Resumo' }).click();
    mkdirSync(OUTPUT, { recursive: true });
    await page.screenshot({ path: join(OUTPUT, `inicio-${scenario.id}-1920.png`) });

    await close();
  });
}
