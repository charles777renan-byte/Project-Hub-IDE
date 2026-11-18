import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { runGit } from './git-fixtures';
import {
  addGitProject,
  createMission,
  decisionBlock,
  missionSummary,
  openFileFromPanel,
  openProject,
  orchestrate,
  statusBarOf,
  viewTab,
} from './missions';
import { seedSessions } from './sessoes-fixtures';
import { expectTerminalToContain, fecharPainel } from './terminals';

// Capturas de tela das telas principais, para a pessoa que revisa o visual. Não é teste de comportamento: só
// roda com `E2E_CAPTURAS=1` (a pasta de saída vem de `E2E_CAPTURAS_DIR`, e o padrão é `out/capturas`). Sem a
// variável, o teste é pulado e o CI não grava nada.

const ENABLED = process.env['E2E_CAPTURAS'] === '1';
test.skip(!ENABLED, 'Capturas de tela: defina E2E_CAPTURAS=1 para gravar.');
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const OUTPUT =
  process.env['E2E_CAPTURAS_DIR'] ?? join(import.meta.dirname, '..', 'out', 'capturas');
const FAKE_PLANNER = join(import.meta.dirname, 'fixtures', 'fake-claude-planner.mjs');

const MISSION = {
  title: 'Orquestrar o login',
  objective: 'Planejar e fazer o login do aplicativo.',
  criterion: 'A pessoa consegue entrar com e-mail e senha',
};

/** Grava a tela inteira da janela em `<pasta>/<nome>.png`. */
async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(OUTPUT, { recursive: true });
  await page.screenshot({ path: join(OUTPUT, `${name}.png`) });
}

test('capturas: Início, as visões do projeto, a missão planejada, o painel direito e a janela estreita', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(180_000);
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path, plannerScript: FAKE_PLANNER });
  // Uma janela de tamanho conhecido, para as capturas serem comparáveis entre as rodadas.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });

  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  // Terminais: um PowerShell aberto, com o prompt na tela.
  const pane = page.getByRole('region', { name: 'Painel PowerShell' });
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(pane).toHaveCount(1);
  await expectTerminalToContain(pane.locator('.terminal-view'), 'PS ', { timeout: 30_000 });
  await shoot(page, '2-projeto-terminais');
  await fecharPainel(page, 'PowerShell');
  await expect(pane).toHaveCount(0);

  // Missões vazia e o formulário Nova missão aberto.
  await viewTab(page, 'Missões').click();
  await page.getByRole('button', { name: 'Nova missão' }).first().click();
  await expect(page.getByRole('form', { name: 'Nova missão' })).toBeVisible();
  await shoot(page, '4-nova-missao');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // A missão planejada: a lista de etapas e o bloco "Sua decisão". O quadro do orquestrador só aparece
  // durante o planejamento, então não é capturado aqui.
  await createMission(page, MISSION);
  await orchestrate(page);
  await expect(page.getByRole('list', { name: 'Etapas do plano' })).toBeVisible();
  await shoot(page, '5-missao-planejada');
  // O mesmo corpo rolado até a lista de etapas e o bloco "Sua decisão".
  await page.getByRole('list', { name: 'Etapas do plano' }).scrollIntoViewIfNeeded();
  await decisionBlock(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, '5b-missao-tarefas-e-decisao');

  // Janela estreita (900px) com a mesma missão.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  await expect(statusBarOf(page)).toBeVisible();
  await page.waitForTimeout(600);
  await shoot(page, '6-missao-janela-estreita');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });

  // Missões do projeto, com a missão e o progresso na lista.
  await page.getByRole('link', { name: '← Missões' }).click();
  await expect(page.getByRole('link', { name: MISSION.title, exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, '3-projeto-missoes');

  // As outras visões do projeto, com a missão já criada.
  for (const [view, file] of [
    ['Progresso', '7-projeto-progresso'],
    ['Worktrees', '8-projeto-worktrees'],
    ['Configurações', '9-projeto-configuracoes'],
  ] as const) {
    await viewTab(page, view).click();
    await page.waitForTimeout(500);
    await shoot(page, file);
  }

  // As abas do painel direito (a de Arquivos já aparece nas outras capturas).
  const panelTabs = page.getByRole('tablist', { name: 'Painéis laterais' });
  for (const [tab, file] of [
    ['Sessões', '10-painel-sessoes'],
    ['Código-fonte', '11-painel-codigo-fonte'],
    ['Checks', '12-painel-checks'],
    ['Navegador', '13-painel-navegador'],
  ] as const) {
    await panelTabs.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(700);
    await shoot(page, file);
  }
  await panelTabs.getByRole('tab', { name: 'Arquivos' }).click();
  await viewTab(page, 'Missões').click();

  // Reabrir a missão planejada: o bloco "Sua decisão" já vem à vista, sem rolar.
  await page.getByRole('link', { name: MISSION.title, exact: true }).click();
  await expect(decisionBlock(page)).toBeInViewport();
  await page.waitForTimeout(400);
  await shoot(page, '5c-missao-reaberta');

  // Início, com a missão na lista e o contador "aguarda você" aceso.
  await page.getByRole('link', { name: 'Início', exact: true }).click();
  // A missão que espera a pessoa aparece uma vez, na faixa "Precisa de você" (a banda Missões não a repete).
  await expect(
    page
      .getByRole('region', { name: 'Precisa de você' })
      .getByRole('link', { name: MISSION.title, exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  await shoot(page, '1-inicio');
});

// A segunda rodada mostra o que a primeira deixa vazio: a missão do agente simulado em cada situação (plano aprovado,
// pedido de aprovação, revisão, concluída), as abas do painel de baixo, o painel direito com sessões, alterações e PR,
// e a paleta de comandos.
const DEMO_MISSION = {
  title: 'Criar arquivo de demonstração',
  objective: 'Gravar o arquivo de demonstração no worktree da missão.',
  criterion: 'O arquivo project-hub-demo.md existe no worktree',
};
const APPROVAL_TITLE = 'Confirmar a gravação do arquivo de demonstração';
const ORIGIN = 'https://github.com/exemplo/repositorio.git';

test('capturas: a missão em execução e em revisão, o painel direito com conteúdo e a paleta', async ({
  launchApp,
  gitRepo,
  gitEnv,
  claudeConfigDir,
  codexHome,
  antigravityHistory,
}) => {
  test.setTimeout(240_000);
  const projectName = basename(gitRepo.path);
  // Um remoto do github.com (o `gh` falso responde por ele), um arquivo versionado alterado e um novo.
  runGit(gitRepo.path, gitEnv, ['remote', 'add', 'origin', ORIGIN]);
  writeFileSync(
    join(gitRepo.path, 'a.txt'),
    'conteudo inicial\numa linha nova no meio\noutra linha nova\n',
  );
  writeFileSync(join(gitRepo.path, 'notas.md'), '# Notas\n\nUm arquivo novo, ainda fora do Git.\n');
  const { app, page } = await launchApp({
    dialogPath: gitRepo.path,
    ghScenario: 'open-green',
    ghHead: 'main',
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });
  await addGitProject(page, projectName);
  seedSessions({ projectPath: gitRepo.path, claudeConfigDir, codexHome, antigravityHistory });
  await openProject(page, projectName, 'Terminais');

  const panel = page.getByRole('complementary', { name: 'Painel direito' });
  const panelTabs = panel.getByRole('tablist', { name: 'Painéis laterais' });

  // Arquivos: um arquivo aberto no editor.
  await openFileFromPanel(page, 'a.txt');
  await page.waitForTimeout(600);
  await shoot(page, '20-arquivo-no-editor');

  // Sessões: a lista dos três programas e o detalhe de uma sessão.
  await panelTabs.getByRole('tab', { name: 'Sessões' }).click();
  const sessions = panel.locator('.sessions-tab');
  await expect(sessions.getByText('Verificação concluída · 5 sessões')).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(400);
  await shoot(page, '21-sessoes-lista');
  await sessions.getByRole('button', { name: /Corrige o login com Google/ }).click();
  await expect(sessions.getByText('Primeiro prompt')).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, '22-sessoes-detalhe');

  // Código-fonte: as alterações do repositório.
  await panelTabs.getByRole('tab', { name: 'Código-fonte' }).click();
  await expect(page.getByRole('textbox', { name: 'Mensagem do commit' })).toBeVisible();
  await page.waitForTimeout(700);
  await shoot(page, '23-codigo-fonte-alteracoes');

  // Checks: o PR aberto, com os checks verdes.
  await panelTabs.getByRole('tab', { name: /^Checks/ }).click();
  await page.waitForTimeout(1500);
  await shoot(page, '24-checks-pr');
  await panelTabs.getByRole('tab', { name: 'Arquivos' }).click();

  // A paleta de comandos.
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, '25-paleta');
  await page.keyboard.press('Escape');

  // A missão do agente simulado, situação por situação.
  await viewTab(page, 'Missões').click();
  await createMission(page, DEMO_MISSION);
  await page.waitForTimeout(400);
  await shoot(page, '26-missao-rascunho');
  await orchestrate(page);
  await expect(page.getByRole('list', { name: 'Etapas do plano' })).toBeVisible();
  await decisionBlock(page).getByRole('button', { name: 'Aprovar plano' }).click();
  await expect(
    missionSummary(page).getByText('Plano aprovado, aguardando início', { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, '27-missao-plano-aprovado');
  await decisionBlock(page).getByRole('button', { name: 'Iniciar missão' }).click();
  const approval = decisionBlock(page).getByRole('region', { name: APPROVAL_TITLE });
  await expect(approval).toBeVisible();
  await page.waitForTimeout(600);
  await shoot(page, '28-missao-pedido-de-aprovacao');
  await decisionBlock(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, '28b-missao-pedido-de-aprovacao-decisao');
  await approval.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(
    missionSummary(page).getByText('Aguarda sua revisão', { exact: true }),
  ).toBeVisible();
  await expect(
    decisionBlock(page).getByRole('region', { name: 'Resumo da conclusão' }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await shoot(page, '29-missao-em-revisao');
  await decisionBlock(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, '29b-missao-em-revisao-decisao');

  // As abas do painel de baixo, com a missão em revisão.
  for (const [tab, file] of [
    [/^Alterações/, '30-missao-aba-alteracoes'],
    [/^Testes/, '31-missao-aba-testes'],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(600);
    await page.getByRole('tab', { name: tab }).scrollIntoViewIfNeeded();
    await shoot(page, file);
  }
  await page.getByRole('tab', { name: 'Atividade', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('list', { name: 'Eventos da missão' }).scrollIntoViewIfNeeded();
  await shoot(page, '32-missao-aba-atividade');

  await decisionBlock(page).getByRole('button', { name: 'Aprovar conclusão' }).click();
  await expect(missionSummary(page).getByText('Concluída', { exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await shoot(page, '33-missao-concluida');

  // Missões, Progresso e Worktrees com a missão concluída, e o Início com ela na lista.
  await page.getByRole('link', { name: '← Missões' }).click();
  await page.waitForTimeout(400);
  await shoot(page, '34-projeto-missoes-concluida');
  for (const [view, file] of [
    ['Progresso', '35-projeto-progresso-concluida'],
    ['Worktrees', '36-projeto-worktrees-com-worktree'],
  ] as const) {
    await viewTab(page, view).click();
    await page.waitForTimeout(500);
    await shoot(page, file);
  }
  await page.getByRole('link', { name: 'Início', exact: true }).click();
  await page.waitForTimeout(800);
  await shoot(page, '37-inicio-com-missao-concluida');
});
