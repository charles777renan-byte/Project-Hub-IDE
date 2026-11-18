import { basename } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addGitProject,
  createMission,
  decisionBlock,
  missionSummary,
  openProject,
  orchestrate,
  viewTab,
} from './missions';

// Avisos do sistema (docs/superpowers/specs/2026-11-17-avisos-do-sistema-design.md), pela interface real com o agente
// simulado, que pede aprovação. No ambiente de teste, a notificação vira um registro no processo principal
// (`recordNotifications`), e a janela passa a dizer que está sem foco: a janela dos testes é invisível, e o foco dela
// não é confiável.

const MISSION = {
  title: 'Revisar o cadastro',
  objective: 'Conferir o cadastro de clientes.',
  criterion: 'O cadastro abre sem erro.',
};

type Shown = { title: string; body: string };

/** Faz as janelas dizerem que estão sem foco. A notificação já vira registro no ambiente de teste. */
async function unfocusWindows(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.isFocused = () => false;
  });
}

function shownAlerts(app: ElectronApplication): Promise<Shown[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __projectHubAlerts: Shown[] }).__projectHubAlerts,
  );
}

/** Orquestra, aprova o plano e inicia: o agente simulado para no pedido de aprovação. */
async function runUntilApproval(page: Page): Promise<void> {
  await orchestrate(page);
  await decisionBlock(page).getByRole('button', { name: 'Aprovar plano' }).click();
  await decisionBlock(page).getByRole('button', { name: 'Iniciar missão' }).click();
  await expect(
    missionSummary(page).getByText('Aguarda sua aprovação', { exact: true }),
  ).toBeVisible();
}

test('missão pedindo aprovação com a janela sem foco avisa uma vez, e o clique abre a missão', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page, MISSION);
  await unfocusWindows(app);

  await runUntilApproval(page);

  await expect.poll(() => shownAlerts(app)).toHaveLength(1);
  const [alert] = await shownAlerts(app);
  expect(alert?.title).toBe(MISSION.title);
  expect(alert?.body).toMatch(/ · Pede a sua aprovação$/);
  // Mais uma leitura da tela (o terminal do agente chega aguardando) não avisa de novo.
  await page.waitForTimeout(3_000);
  expect(await shownAlerts(app)).toHaveLength(1);

  // O clique: o processo principal manda abrir a missão, que estava fora de vista.
  const ids = /workspaces\/([^/?#]+)\/missoes\/([^/?#]+)/.exec(page.url());
  expect(ids).not.toBeNull();
  await viewTab(page, 'Configurações').click();
  await expect(missionSummary(page)).toHaveCount(0);
  await app.evaluate(
    ({ BrowserWindow }, event) => {
      for (const win of BrowserWindow.getAllWindows())
        win.webContents.send('alerts:open:v1', event);
    },
    { kind: 'mission', projectId: decodeURIComponent(ids![1]!), id: decodeURIComponent(ids![2]!) },
  );
  await expect(missionSummary(page)).toBeVisible();
});

test('projeto silenciado não avisa', async ({ launchApp, gitRepo }) => {
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Configurações');
  const mute = page.getByRole('checkbox', { name: 'Silenciar avisos deste projeto' });
  await mute.check();
  await expect(mute).toBeChecked();
  await viewTab(page, 'Missões').click();
  await createMission(page, MISSION);
  await unfocusWindows(app);

  await runUntilApproval(page);

  await page.waitForTimeout(3_000);
  expect(await shownAlerts(app)).toEqual([]);
});
