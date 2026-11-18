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

// Verificação do agente real, pela interface real: o agente das missões é o Claude Code do app (terminal e
// hooks), só que o `claude` é trocado por um CLI falso (`fake-claude-verificacao.mjs`), que dispara os hooks
// de um comando de teste como o Claude Code os envia. O app não executa nenhum comando: ele lê o resultado
// do que o agente rodou. Dados descartáveis; nada toca o `~/.claude` nem a assinatura de quem roda a suíte.

const FAKE_AGENT = join(import.meta.dirname, 'fixtures', 'fake-claude-verificacao.mjs');

const MISSION = {
  title: 'Verificar com os testes do projeto',
  objective: 'Corrigir o login e conferir com os testes.',
  criterion: 'Os testes do projeto passam',
};

test('Verificação do agente: os testes que o agente rodou aparecem na aba Testes e na revisão', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page, close } = await launchApp({ dialogPath: gitRepo.path, agentScript: FAKE_AGENT });

  await addGitProject(page, projectName);
  await openProject(page, projectName);
  await createMission(page, MISSION);
  await orchestrate(page);
  const decision = decisionBlock(page);
  await decision.getByRole('button', { name: 'Aprovar plano' }).click();
  await decision.getByRole('button', { name: 'Iniciar missão' }).click();

  await expect(missionSummary(page).getByText('Aguarda sua revisão', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // A revisão mostra a última rodada: a que passou.
  await expect(decision.getByText('Testes: 12 passaram')).toBeVisible();
  // O agente indicou o critério 1 na resposta final, e os testes da tentativa passaram: ele fica comprovado.
  await expect(decision.getByText('Critérios: 1 de 1 verificados.')).toBeVisible();

  // A aba Testes mostra as duas rodadas do `pnpm test`, na ordem; o `git status` não é verificação.
  await page.getByRole('tab', { name: /^Testes/ }).click();
  const runs = page.getByRole('list', { name: 'Verificações' }).getByRole('listitem');
  await expect(runs).toHaveCount(2);
  await expect(runs.nth(0)).toContainText('pnpm test');
  // O total é aprovados/total: 2 de 3 passaram.
  await expect(runs.nth(0)).toContainText('2/3');
  await expect(runs.nth(0)).toContainText('Tests 1 failed | 2 passed (3)');
  await expect(runs.nth(1)).toContainText('12/12');
  // A saída longa chega cortada, com o resumo do final.
  await expect(runs.nth(1)).toContainText('Tests 12 passed (12)');
  await expect(runs.nth(1)).not.toContainText('arquivo-0.test.ts');
  // O critério aparece marcado na lista da mesma aba.
  await expect(page.getByText('✓ verificado')).toHaveCount(1);
  await expect(page.getByText('○ não verificado')).toHaveCount(0);

  // Captura opcional da aba, como nas capturas da interface (`E2E_CAPTURAS_DIR`).
  const shots = process.env['E2E_CAPTURAS_DIR'];
  if (shots !== undefined && shots !== '') {
    await page.screenshot({ path: join(shots, 'verificacao-aba-testes.png') });
  }

  await close();
});
