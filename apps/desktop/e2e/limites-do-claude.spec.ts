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
