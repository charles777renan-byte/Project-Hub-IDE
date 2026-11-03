import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Peças compartilhadas dos testes que usam o Git de verdade na janela real: a identidade para commitar, o
// conferidor de CSP e os comandos Git que o teste roda no disco (nunca pela tela).

/**
 * O padrão do teste não tem identidade no Git (o arquivo de configuração é vazio). Este bloco dá uma, para
 * commits de verdade poderem acontecer.
 */
export const withIdentity = test.extend<{ gitEnv: Record<string, string> }>({
  gitEnv: async ({ dataDir }, use) => {
    const config = join(dataDir, 'git-identidade');
    writeFileSync(config, '[user]\n\tname = Pessoa de Teste\n\temail = pessoa@example.com\n');
    await use({ GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config, GIT_CONFIG_NOSYSTEM: '1' });
  },
});

/** Roda o Git no disco, com o ambiente isolado do teste, e devolve a saída sem a quebra final. */
export function runGit(cwd: string, gitEnv: Record<string, string>, args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...gitEnv };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    delete env[name];
  }
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
}

/**
 * Cria o remoto local `dataDir/remoto.git` (`--bare`), liga o `origin` da pasta a ele e publica a branch com
 * `push -u`: o upstream existe e `↑N ↓M` e o pull funcionam, sem rede. Devolve o caminho do remoto.
 */
export function addLocalRemote(
  repoPath: string,
  dataDir: string,
  gitEnv: Record<string, string>,
): string {
  const remote = join(dataDir, 'remoto.git');
  mkdirSync(remote);
  runGit(remote, gitEnv, ['init', '--bare', '--initial-branch=main']);
  runGit(repoPath, gitEnv, ['remote', 'add', 'origin', remote]);
  runGit(repoPath, gitEnv, ['push', '-u', 'origin', 'main']);
  return remote;
}

/** Instala um hook do repositório (um script `sh`) que roda com o corpo dado. */
export function writeHook(repoPath: string, name: string, body: string): void {
  const hooks = join(repoPath, '.git', 'hooks');
  mkdirSync(hooks, { recursive: true });
  const file = join(hooks, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Registra violações de CSP e mensagens do console sobre a CSP, antes de o teste agir (addInitScript + reload),
 * como em identidade.spec.ts. Devolve a lista das mensagens do console.
 */
export async function watchCsp(page: Page): Promise<string[]> {
  const consoleCsp: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    if (/Content Security Policy|Refused to/i.test(message.text())) {
      consoleCsp.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Início', exact: true })).toBeVisible();
  return consoleCsp;
}

/**
 * Sem violação nenhuma. Com `allowXterm`, o único descarte é o <style> inline do xterm: a violação
 * `style-src-elem inline` e a mensagem do console sobre ela só passam quando todo <style> do documento traz
 * regras `.xterm` (o mesmo critério de identidade.spec.ts). O editor mora num Shadow Root que a página não
 * enxerga, então a conferência abaixo também exige que ele não tenha nenhum <style>.
 */
export async function expectNoViolations(
  page: Page,
  consoleCsp: string[],
  options: { allowXterm?: boolean } = {},
): Promise<void> {
  const found = await page.evaluate(() => {
    const w = window as unknown as { cspViolations: string[] };
    const foreignStyles = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .filter((text) => !text.includes('.xterm'));
    const editorStyles = [...document.querySelectorAll('.code-editor__host')].reduce(
      (total, host) => total + (host.shadowRoot?.querySelectorAll('style').length ?? 0),
      0,
    );
    return { violations: w.cspViolations, foreignStyles, editorStyles };
  });
  const allowed = (text: string) => options.allowXterm === true && /inline/i.test(text);
  expect(found.foreignStyles, '<style> alheio no documento').toEqual([]);
  expect(found.editorStyles, '<style> dentro do Shadow Root do editor').toBe(0);
  expect(
    found.violations.filter((item) => !(allowed(item) && item.startsWith('style-src-elem'))),
    'violações de CSP',
  ).toEqual([]);
  expect(
    consoleCsp.filter((text) => !allowed(text)),
    'mensagens de CSP no console',
  ).toEqual([]);
}
