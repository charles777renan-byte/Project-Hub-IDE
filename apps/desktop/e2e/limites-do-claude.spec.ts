import { join } from 'node:path';
import { expect, test } from './fixtures';

// Limites da assinatura do Claude no Início, pela interface real. O `claude -p` da leitura é trocado por um CLI
// falso (`fake-claude-limits.mjs`, via `APP_LIMITS_SCRIPT`, só em teste): sem ele, nenhuma leitura automática
// roda e a suíte não gasta a cota de quem a executa. O falso devolve 16% na janela de 5 horas e 13% na semanal.

const FAKE_LIMITS = join(import.meta.dirname, 'fixtures', 'fake-claude-limits.mjs');

test('Limites do Claude: o cartão do Início mostra as duas janelas lidas pela sonda', async ({
  launchApp,
}) => {
  const { page, close } = await launchApp({ limitsScript: FAKE_LIMITS });

  const panel = page.getByRole('region', { name: 'Uso dos agentes' });
  await expect(panel).toBeVisible();
  // A primeira leitura sai uns segundos depois de a janela abrir.
  await expect(panel).toContainText('Sessão atual', { timeout: 30_000 });
  await expect(panel).toContainText('16% usado · 84% restante');
  await expect(panel).toContainText('Semanal (todos os modelos)');
  await expect(panel).toContainText('13% usado · 87% restante');
  await expect(panel).toContainText(/Renova/);
  await expect(panel).toContainText(/Lido às \d{2}:\d{2}/);
  // Não existe janela por modelo nessa fonte: o cartão não inventa a linha.
  await expect(panel).not.toContainText('por modelo');
  // Codex e Antigravity ainda não têm fonte.
  await expect(panel).toContainText('Em breve');

  // As barras são medidores acessíveis, com o nome da janela e o número.
  await expect(panel.getByRole('meter', { name: /Sessão atual/ })).toHaveCount(1);

  // Atualizar logo depois da leitura é aceito (o processo principal limita a frequência e devolve o estado).
  const refresh = panel.getByRole('button', { name: 'Atualizar' });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(panel).toContainText('16% usado · 84% restante');

  await close();
});

test('Limites do Claude: a barra de status resume as janelas e abre o painel', async ({
  launchApp,
}) => {
  const { page, close } = await launchApp({ limitsScript: FAKE_LIMITS });

  // O rodapé fica fora das rotas (App.tsx): o mesmo resumo aparece em todas as telas.
  const footer = page.getByRole('contentinfo', { name: 'Barra de status' });
  const indicator = footer.getByRole('button', { name: /^Limites do Claude/ });
  await expect(indicator).toHaveAccessibleName(
    /^Limites do Claude: 5h 16%, semanal 13%, renova em (<1|\d)d$/,
    { timeout: 30_000 },
  );
  await expect(indicator).toContainText('16%');

  await indicator.click();
  const panel = page.getByRole('dialog', { name: 'Limites da assinatura' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Sessão atual');
  const session = panel.getByRole('listitem', { name: 'Sessão atual' });
  await expect(session).toContainText('16%');
  await expect(session).toContainText(/renova em \d/);
  await expect(session.getByRole('meter')).toHaveAttribute('aria-valuenow', '16');
  await expect(panel.getByRole('listitem', { name: /Semanal/ })).toContainText('13%');
  await expect(panel.getByRole('button', { name: 'Atualizar limites' })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Outros programas' })).toContainText('Em breve');

  // O painel fica inteiro dentro da janela e acima da barra (a barra corta o que passa da borda dela).
  const box = await panel.boundingBox();
  const bar = await footer.boundingBox();
  if (box === null || bar === null) throw new Error('painel ou barra sem medida');
  const width = await page.evaluate(() => innerWidth);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(indicator).toBeFocused();

  await close();
});
