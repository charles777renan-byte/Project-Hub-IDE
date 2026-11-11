import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { expect, test } from './fixtures';

// Limites da assinatura do Codex no Início e na barra de status, pela interface real. A fonte é um arquivo de
// sessão do Codex (`rollout-*.jsonl`) numa pasta temporária (`PROJECT_HUB_CODEX_HOME`): nada de rede, nada de
// cota, e a pasta real `~/.codex` nunca é lida. Sem `limitsScript`, o Claude fica inerte.

const CODEX_ID = '019e0000-0000-7000-8000-000000000001';

/** Conteúdo de um rollout com `session_meta` e um `token_count` Free (só a janela mensal, `secondary` nulo). */
function freeRollout(now: Date): string {
  const resetsAt = Math.floor(now.getTime() / 1000) + 17 * 24 * 60 * 60;
  const meta = {
    timestamp: new Date(now.getTime() - 5000).toISOString(),
    type: 'session_meta',
    payload: { id: CODEX_ID, cwd: 'C:/projeto' },
  };
  const tokens = {
    timestamp: new Date(now.getTime() - 1000).toISOString(),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: null,
      rate_limits: {
        limit_id: 'codex',
        limit_name: null,
        plan_type: 'free',
        primary: { used_percent: 47, window_minutes: 43200, resets_at: resetsAt },
        secondary: null,
        credits: null,
      },
    },
  };
  return `${JSON.stringify(meta)}\n${JSON.stringify(tokens)}\n`;
}

/** Grava o rollout em `<codexHome>/sessions/AAAA/MM/DD/`; `.zst` comprime o conteúdo. */
function writeRollout(codexHome: string, now: Date, extension: 'jsonl' | 'jsonl.zst'): void {
  const two = (n: number) => String(n).padStart(2, '0');
  const dir = join(
    codexHome,
    'sessions',
    String(now.getFullYear()),
    two(now.getMonth() + 1),
    two(now.getDate()),
  );
  mkdirSync(dir, { recursive: true });
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
  const content = freeRollout(now);
  const data = extension === 'jsonl' ? content : zstdCompressSync(Buffer.from(content, 'utf8'));
  writeFileSync(join(dir, `rollout-${stamp}-${CODEX_ID}.${extension}`), data);
}

test('Limites do Codex: o cartão, a barra de status e o painel mostram a janela mensal do plano Free', async ({
  launchApp,
  codexHome,
}) => {
  writeRollout(codexHome, new Date(), 'jsonl');
  const { page, close } = await launchApp();

  const panel = page.getByRole('region', { name: 'Uso dos agentes' });
  await expect(panel).toBeVisible();
  const card = panel.getByRole('group', { name: 'Uso do Codex' });
  // A primeira varredura sai cerca de 1 s depois de a janela abrir.
  await expect(card).toContainText('Mensal', { timeout: 30_000 });
  await expect(card).toContainText('47% usado · 53% restante');
  await expect(card).toContainText(/Renova/);
  await expect(card).toContainText(/Visto às \d{2}:\d{2}, na última resposta do Codex\./);
  await expect(card.getByRole('meter', { name: /Mensal/ })).toHaveCount(1);
  // O Claude está inerte neste teste: o cartão dele não ganha número.
  await expect(panel.getByRole('group', { name: 'Uso do Claude' })).not.toContainText('% usado');

  const footer = page.getByRole('contentinfo', { name: 'Barra de status' });
  const indicator = footer.getByRole('button', { name: /^Limites do Codex/ });
  await expect(indicator).toHaveAccessibleName(/^Limites do Codex: mensal 47%, renova em 1[67]d$/);
  await expect(indicator).toContainText('47%');

  // Uma janela só: uma linha, no meio da altura do botão.
  const rows = indicator.locator('.limits-indicator__part');
  await expect(rows).toHaveCount(1);
  const buttonBox = await indicator.boundingBox();
  const rowBox = await rows.first().locator('.limits-indicator__label').boundingBox();
  if (buttonBox === null || rowBox === null) throw new Error('botão ou linha sem medida');
  const rowMiddle = rowBox.y + rowBox.height / 2;
  expect(Math.abs(rowMiddle - (buttonBox.y + buttonBox.height / 2))).toBeLessThanOrEqual(1.5);

  await indicator.click();
  const dialog = page.getByRole('dialog', { name: 'Limites da assinatura' });
  await expect(dialog).toBeVisible();
  const section = dialog.getByRole('region', { name: 'Codex' });
  await expect(section).toBeVisible();
  const monthly = section.getByRole('listitem', { name: 'Mensal' });
  await expect(monthly).toContainText('47%');
  await expect(monthly.getByRole('meter')).toHaveAttribute('aria-valuenow', '47');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await close();
});

test('Limites do Codex: sem nenhum rollout o cartão explica que o limite ainda não foi registrado', async ({
  launchApp,
  codexHome,
}) => {
  // O Codex está instalado (a pasta existe), mas ainda não respondeu: não há sessão nenhuma.
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  const { page, close } = await launchApp();

  const card = page
    .getByRole('region', { name: 'Uso dos agentes' })
    .getByRole('group', { name: 'Uso do Codex' });
  await expect(card).toContainText(
    'O Codex ainda não registrou o limite. Ele aparece depois da primeira resposta.',
    { timeout: 30_000 },
  );
  await expect(card).not.toContainText('% usado');
  // Sem janela, a barra de status não ganha botão do Codex.
  await expect(
    page
      .getByRole('contentinfo', { name: 'Barra de status' })
      .getByRole('button', { name: /^Limites do Codex/ }),
  ).toHaveCount(0);

  await close();
});

test('Limites do Codex: um rollout só em .jsonl.zst também é lido', async ({
  launchApp,
  codexHome,
}) => {
  writeRollout(codexHome, new Date(), 'jsonl.zst');
  const { page, close } = await launchApp();

  const card = page
    .getByRole('region', { name: 'Uso dos agentes' })
    .getByRole('group', { name: 'Uso do Codex' });
  await expect(card).toContainText('47% usado · 53% restante', { timeout: 30_000 });

  await close();
});
