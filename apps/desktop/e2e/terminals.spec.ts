import { basename } from 'node:path';
import { expect, test } from './fixtures';

// A página Terminais pela janela do Electron construído: o IPC, o processo de terminais, o PowerShell e
// o xterm, com a CSP real. Só roda no Windows, onde o shell do teste é o PowerShell.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

test('abre um shell, digita nele e vê a saída no terminal', async ({ launchApp, gitRepo }) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));

  const navigation = page.getByRole('navigation', { name: 'Principal' });
  await navigation.getByRole('link', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  await navigation.getByRole('link', { name: 'Terminais' }).click();
  await page.getByRole('button', { name: 'Novo shell' }).click();

  const screen = page.locator('.xterm-rows');
  await expect(screen).toContainText('PS ', { timeout: 30_000 });
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "ola-$(2+2)"');
  await page.keyboard.press('Enter');
  await expect(screen).toContainText('ola-4', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Encerrar shell' }).click();
  await expect(page.getByText('Nenhum agente nem shell aberto.')).toBeVisible();
  // O xterm tenta montar um <style> inline, que a CSP bloqueia; as regras dele estão em app.css. Qualquer outra
  // violação (script, imagem, conexão) é falha.
  const csp = messages.filter(
    (text) => text.includes('Content Security Policy') && !text.includes('Applying inline style'),
  );
  expect(csp, csp.slice(0, 3).join(' | ')).toEqual([]);
});
