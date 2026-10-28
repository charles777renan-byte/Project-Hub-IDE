import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test } from './fixtures';
import {
  addGitProject,
  createMission,
  decisionBlock,
  missionSummary,
  openProject,
  orchestrate,
} from './missions';

// Gasto de tokens em tempo real, pela interface real: o agente das missões é o Claude Code do app (terminal,
// hooks, leitura dos transcripts), só que o `claude` é trocado por um CLI falso (`fake-claude-agent.mjs`),
// que roda no próprio Electron como Node. O falso dispara os hooks e grava o transcript em
// `<CLAUDE_CONFIG_DIR>/projects/<pasta>/<session_id>.jsonl`, numa pasta de dados do teste (nunca o
// `~/.claude`). Ele grava o gasto em duas partes e espera o teste liberar a segunda, para provar que o
// número muda na tela sem recarregar. Os números são sintéticos, no preço de lista do claude-sonnet-5-5
// (entrada USD 2, saída USD 10 por milhão; leitura de cache 5% da entrada; escrita de 5 minutos 1,25 vez
// e de 1 hora 2 vezes a entrada). As contas abaixo são feitas à mão, não pela função do produto.

const FAKE_AGENT = join(import.meta.dirname, 'fixtures', 'fake-claude-agent.mjs');

const MISSION = {
  title: 'Medir o gasto de tokens',
  objective: 'Acompanhar quantos tokens a missão gasta enquanto o agente trabalha.',
  criterion: 'O gasto aparece na tela e muda sem recarregar',
};

// Primeira parte: a resposta A, gravada duas vezes (conta uma).
//   entrada 12.000, saída 3.000, cache lido 200.000, escrito (5 min) 20.000
//   custo = 12.000*2 + 20.000*2,5 + 200.000*0,1 + 3.000*10 = 124.000 / 1.000.000 = USD 0,124 -> USD 0,12
const FIRST = {
  headline: /15\.000\s+tokens novos/,
  detail: 'Entrada nova: 12.000 · Saída: 3.000',
  cache: 'Cache: 200.000 lidos · 20.000 escritos',
  cost: /Custo estimado a preço de lista da API: USD\s0,12 \(não é fatura\)\./,
};

// Total final: A de novo (já contada), B, e o subagente S.
//   B: entrada 8.000, saída 2.000, cache lido 100.000, escrito (1 hora) 10.000 -> USD 0,086
//   S: entrada 5.000, saída 1.200, cache lido 50.000 -> USD 0,027
//   entrada 25.000, saída 6.200 (31.200 novos), lido 350.000, escrito 30.000, custo USD 0,237 -> USD 0,24
//   Se a linha repetida contasse duas vezes, a entrada seria 37.000 e o total, 46.200.
const FINAL = {
  headline: /31\.200\s+tokens novos/,
  detail: 'Entrada nova: 25.000 · Saída: 6.200',
  cache: 'Cache: 350.000 lidos · 30.000 escritos',
  cost: /Custo estimado a preço de lista da API: USD\s0,24 \(não é fatura\)\./,
};

test('Gasto de tokens: o primeiro total aparece e o número troca ao vivo até o total final', async ({
  launchApp,
  gitRepo,
  claudeConfigDir,
}) => {
  const projectName = basename(gitRepo.path);
  const { page, close } = await launchApp({ dialogPath: gitRepo.path, agentScript: FAKE_AGENT });

  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page, MISSION);

  // Sem planejador, o plano sai com uma tarefa por critério de aceite: uma só execução do agente falso.
  await orchestrate(page);
  const decision = decisionBlock(page);
  await decision.getByRole('button', { name: 'Aprovar plano' }).click();
  await expect(
    missionSummary(page).getByText('Plano aprovado, aguardando início', { exact: true }),
  ).toBeVisible();

  // Antes de a missão começar, não há gasto: a seção não aparece (falta de número não é zero).
  const usage = page.getByRole('region', { name: 'Gasto de tokens' });
  await expect(usage).toHaveCount(0);

  await decision.getByRole('button', { name: 'Iniciar missão' }).click();

  // 1. O agente falso gravou a primeira parte e está esperando: a seção mostra só o primeiro total, com a
  //    resposta repetida contada uma vez e o custo dito como estimativa, não fatura.
  await expect(usage).toBeVisible();
  await expect(usage.getByRole('heading', { level: 2, name: 'Gasto de tokens' })).toBeVisible();
  await expect(usage).toContainText(FIRST.headline);
  await expect(usage).toContainText(FIRST.detail);
  await expect(usage).toContainText(FIRST.cache);
  await expect(usage).toContainText(FIRST.cost);
  await expect(usage).not.toContainText('indisponível');
  await expect(usage).not.toContainText(FINAL.headline);

  // 2. A página não recarrega daqui em diante: um marcador na janela tem de sobreviver à troca do número.
  await page.evaluate(() => {
    Object.assign(window, { semRecarga: true });
  });

  // 3. Libera a segunda parte: o agente falso repete a primeira resposta, grava uma nova e um subagente.
  const gateFolder = join(claudeConfigDir, 'fake-agent');
  mkdirSync(gateFolder, { recursive: true });
  writeFileSync(join(gateFolder, 'liberar-segunda-parte'), '', 'utf8');

  await expect(usage).toContainText(FINAL.headline);
  await expect(usage).toContainText(FINAL.detail);
  await expect(usage).toContainText(FINAL.cache);
  await expect(usage).toContainText(FINAL.cost);
  await expect(usage).not.toContainText(FIRST.headline);
  await expect(usage).not.toContainText(FIRST.cost);
  await expect(usage).not.toContainText('indisponível');
  await expect(usage).toContainText('Tokens novos são a entrada nova mais a saída');
  expect(await page.evaluate(() => 'semRecarga' in window)).toBe(true);

  // 4. O fim da sessão leva a missão à revisão, e o gasto final continua na tela.
  await expect(
    missionSummary(page).getByText('Aguarda sua revisão', { exact: true }),
  ).toBeVisible();
  await expect(usage).toContainText(FINAL.headline);
  await expect(usage).toContainText(FINAL.cost);

  await close();
});
