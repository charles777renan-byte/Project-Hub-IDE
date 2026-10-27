import { expect, test } from './fixtures';

// O nome do perfil local na saudação do Início, pela janela do Electron construído: o botão, o campo, o IPC
// e o banco. Reabrir o app na mesma pasta de dados mostra que o nome ficou gravado. Os testes de renderer
// usam a API falsa; este mostra que o caminho real responde.

const GREETING_WITH_NAME = /^(Bom dia|Boa tarde|Boa noite), Ana$/;

test('o nome aparece na saudação, sobrevive a reabrir o app e sai quando é removido', async ({
  launchApp,
}, testInfo) => {
  const first = await launchApp();
  await first.page.getByRole('button', { name: 'Dizer seu nome' }).click();
  // Os espaços das pontas não entram no nome: o app apara antes de gravar.
  await first.page.getByRole('textbox', { name: 'Seu nome' }).fill('  Ana  ');
  await first.page.getByRole('button', { name: 'Salvar' }).click();

  await expect(first.page.getByText(GREETING_WITH_NAME)).toBeVisible();
  await expect(first.page.getByRole('alert')).toHaveCount(0);
  await first.page.screenshot({ path: testInfo.outputPath('saudacao-com-nome.png') });
  await first.close();

  const second = await launchApp();
  await expect(second.page.getByText(GREETING_WITH_NAME)).toBeVisible();

  await second.page.getByRole('button', { name: 'Alterar nome' }).click();
  await second.page.getByRole('button', { name: 'Remover nome' }).click();

  await expect(second.page.getByRole('button', { name: 'Dizer seu nome' })).toBeVisible();
  await expect(second.page.getByText(GREETING_WITH_NAME)).toHaveCount(0);
  await expect(second.page.getByRole('alert')).toHaveCount(0);
});
