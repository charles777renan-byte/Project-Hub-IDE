import type { Page } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, FAKE_ACCOUNT_CLI, test } from './fixtures';
import {
  addGitProject,
  createMission,
  decisionBlock,
  missionSummary,
  openProject,
  orchestrate,
} from './missions';

// A troca automática de conta, na janela real: a missão roda no Claude Code do app (terminal e hooks), com o `claude`
// trocado por um CLI falso (`fake-claude-limite.mjs`) que grava a linha de limite no transcript quando a pasta da
// conta tem o marcador `esgotada`. Só contas falsas: o login da conta extra é o arquivo do `fake-account-cli.mjs`.
// Nada toca o `~/.claude` nem a assinatura de quem roda a suíte.

const FAKE_AGENT = join(import.meta.dirname, 'fixtures', 'fake-claude-limite.mjs');

const MISSION = {
  title: 'Continuar em outra conta',
  objective: 'Corrigir o login.',
  criterion: 'O login funciona',
};

async function openSettings(page: Page): Promise<void> {
  await page.locator('.sidebar__settings').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
}

/** Marca a pasta do Claude Code como sem limite: o `claude` falso grava a linha de limite. */
function markExhausted(configDir: string): void {
  const own = join(configDir, 'fake-limite');
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'esgotada'), '');
}

/** Cria a conta extra "Pessoal", conectada (o login do CLI falso de contas, na pasta dela). */
async function addConnectedAccount(page: Page, dataDir: string): Promise<void> {
  await openSettings(page);
  const claude = page.getByRole('region', { name: 'Claude Code' });
  await claude.getByRole('button', { name: 'Adicionar conta' }).click();
  await claude.getByRole('textbox', { name: 'Nome da conta' }).fill('Pessoal');
  await page.keyboard.press('Enter');
  const row = claude
    .locator('li.acct')
    .filter({ has: page.locator('.acct__name-text', { hasText: 'Pessoal' }) });
  await expect(row).toHaveCount(1);
  const [folder] = readdirSync(join(dataDir, 'accounts', 'claude'));
  if (folder === undefined) throw new Error('a pasta da conta extra deveria existir');
  writeFileSync(
    join(dataDir, 'accounts', 'claude', folder, 'login.json'),
    JSON.stringify({ email: 'pessoal@exemplo.test', orgName: 'Organização de teste' }),
  );
}

async function startMission(page: Page, projectName: string): Promise<void> {
  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page, MISSION);
  await orchestrate(page);
  const decision = decisionBlock(page);
  await decision.getByRole('button', { name: 'Aprovar plano' }).click();
  await decision.getByRole('button', { name: 'Iniciar missão' }).click();
}

test('com a opção ligada, a missão troca de conta e continua', async ({
  launchApp,
  gitRepo,
  dataDir,
  claudeConfigDir,
}) => {
  const projectName = basename(gitRepo.path);
  const { page, close } = await launchApp({
    dialogPath: gitRepo.path,
    agentScript: FAKE_AGENT,
    accountCliScript: FAKE_ACCOUNT_CLI,
  });

  await addConnectedAccount(page, dataDir);
  const toggle = page
    .getByRole('region', { name: 'Claude Code' })
    .getByRole('switch', { name: 'Trocar de conta quando o limite acabar' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toContainText('Ligado');

  markExhausted(claudeConfigDir);
  await startMission(page, projectName);

  // A segunda tentativa, na conta Pessoal (sem o marcador), terminou: a missão aguarda a revisão.
  await expect(missionSummary(page).getByText('Aguarda sua revisão', { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  // A linha do tempo da conversa conta a troca e diz que a conversa não foi levada (até a retomada entre contas).
  const timeline = page.getByRole('list', { name: 'Eventos da missão' });
  await expect(
    timeline.getByText(
      /Limite da conta Principal acabou \(renova às \d{2}:\d{2}\)\. A missão continuou na conta Pessoal\./,
    ),
  ).toBeVisible();
  await expect(
    timeline.getByText(
      'A conversa não pôde ser levada para a conta nova: a tarefa recomeçou com o pedido para continuar.',
    ),
  ).toBeVisible();
  await expect(decisionBlock(page)).toContainText('Pessoal');

  await close();
});

test('com a opção desligada, a missão espera e mostra o motivo', async ({
  launchApp,
  gitRepo,
  dataDir,
  claudeConfigDir,
}) => {
  const projectName = basename(gitRepo.path);
  const { page, close } = await launchApp({
    dialogPath: gitRepo.path,
    agentScript: FAKE_AGENT,
    accountCliScript: FAKE_ACCOUNT_CLI,
  });

  await addConnectedAccount(page, dataDir);
  markExhausted(claudeConfigDir);
  await startMission(page, projectName);

  const decision = decisionBlock(page);
  await expect(decision).toContainText('O limite da conta Principal acabou. Renova às', {
    timeout: 45_000,
  });
  await expect(decision).toContainText('Quando renovar, peça para continuar.');
  await expect(decision.locator('.decision-block__limit svg')).toHaveCount(1);

  // O `claude` falso fica vivo, como no limite: a missão é cancelada antes de fechar.
  await missionSummary(page).getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Cancelar missão' }).click();
  await expect(missionSummary(page).getByText('Cancelada', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await close();
});
