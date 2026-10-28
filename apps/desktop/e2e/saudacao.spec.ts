import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// O nome do perfil local na saudação do Início, pela janela do Electron construído: o campo, o IPC e o
// banco. O Início não tem mais o botão do nome: o item "Alterar meu nome" da paleta (Ctrl+K) leva ao Início
// com o campo aberto (`/?editar-nome=1`). Reabrir o app na mesma pasta de dados mostra que o nome ficou
// gravado. Os testes de renderer usam a API falsa; este mostra que o caminho real responde.

const GREETING_WITH_NAME = /^(Bom dia|Boa tarde|Boa noite), Ana$/;

/** Abre o campo do nome pela paleta de comandos. */
async function openNameEditor(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  const paleta = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(paleta).toBeVisible();
  await page.keyboard.type('Alterar meu nome');
  await page.keyboard.press('Enter');
  await expect(paleta).toBeHidden();
  await expect(page.getByRole('form', { name: 'Seu nome' })).toBeVisible();
}

test('o nome aparece na saudação, sobrevive a reabrir o app e sai quando é removido', async ({
  launchApp,
}, testInfo) => {
  const first = await launchApp();
  // Sem nome, a saudação sai sem ele e o Início não tem botão para dizer o nome.
  await expect(first.page.getByText(GREETING_WITH_NAME)).toHaveCount(0);
  await expect(first.page.getByRole('button', { name: 'Dizer seu nome' })).toHaveCount(0);
  await openNameEditor(first.page);
  // Os espaços das pontas não entram no nome: o app apara antes de gravar.
  await first.page.getByRole('textbox', { name: 'Seu nome' }).fill('  Ana  ');
  await first.page.getByRole('button', { name: 'Salvar' }).click();

  await expect(first.page.getByText(GREETING_WITH_NAME)).toBeVisible();
  // O campo fecha e o pedido sai do endereço.
  await expect(first.page.getByRole('form', { name: 'Seu nome' })).toHaveCount(0);
  await expect(first.page).not.toHaveURL(/editar-nome/);
  await expect(first.page.getByRole('alert')).toHaveCount(0);
  await first.page.screenshot({ path: testInfo.outputPath('saudacao-com-nome.png') });
  await first.close();

  const second = await launchApp();
  await expect(second.page.getByText(GREETING_WITH_NAME)).toBeVisible();

  await openNameEditor(second.page);
  // O campo abre com o nome atual.
  await expect(second.page.getByRole('textbox', { name: 'Seu nome' })).toHaveValue('Ana');
  await second.page.getByRole('button', { name: 'Remover nome' }).click();

  await expect(second.page.getByRole('form', { name: 'Seu nome' })).toHaveCount(0);
  await expect(second.page.getByText(GREETING_WITH_NAME)).toHaveCount(0);
  await expect(second.page.getByRole('alert')).toHaveCount(0);
  await expect(second.page).not.toHaveURL(/editar-nome/);
});
