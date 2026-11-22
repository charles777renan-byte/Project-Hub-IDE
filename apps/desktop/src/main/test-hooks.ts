import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { AccountVault } from './accounts/account-vault';
import type { VaultWindow } from './vault-window';

/**
 * Os ganchos dos testes de ponta a ponta. Só valem com `PROJECT_HUB_ENV=test`: fora dele, as variáveis são ignoradas e
 * o app usa a área de transferência e a janela do cofre de verdade.
 *
 * - `APP_TEST_CLIPBOARD_FILE`: um arquivo no lugar da área de transferência do Windows, para o teste "copiar" uma chave
 *   falsa sem tocar na área de transferência da pessoa.
 * - `APP_TEST_VAULT_PASSWORD`: a senha do cofre, respondida sem abrir a janela (o Playwright não alcança a janela
 *   separada do cofre).
 */
export type TestHooks = { clipboardFile?: string; vaultPassword?: string };

export function testHooksOf(env: Readonly<Record<string, string | undefined>>): TestHooks {
  if (env['PROJECT_HUB_ENV'] !== 'test') return {};
  const clipboardFile = env['APP_TEST_CLIPBOARD_FILE'];
  const vaultPassword = env['APP_TEST_VAULT_PASSWORD'];
  return {
    ...(clipboardFile === undefined || clipboardFile === '' ? {} : { clipboardFile }),
    ...(vaultPassword === undefined || vaultPassword === '' ? {} : { vaultPassword }),
  };
}

/** A área de transferência num arquivo: ler devolve o conteúdo (vazio se não existe), limpar o esvazia. */
export function fileClipboard(path: string): { readText(): Promise<string>; clear(): void } {
  return {
    readText: () => readFile(path, 'utf8').catch(() => ''),
    clear: () => {
      try {
        writeFileSync(path, '');
      } catch {
        // Sem o arquivo, não há o que limpar.
      }
    },
  };
}

/**
 * A janela do cofre, sem janela: cria o cofre com a senha de teste quando ele está vazio e destranca com ela quando está
 * trancado. Trocar a senha não é coberto pelos testes de ponta a ponta.
 */
export function passwordVaultWindow(
  vault: Pick<AccountVault, 'status' | 'create' | 'unlock'>,
  password: string,
): VaultWindow {
  return {
    async ensureUnlocked() {
      const { state } = vault.status();
      if (state === 'unlocked') return 'unlocked';
      const result =
        state === 'empty' ? await vault.create(password) : await vault.unlock(password);
      return result.ok ? 'unlocked' : 'cancelled';
    },
    changePassword: () => Promise.resolve({ outcome: 'cancelled' }),
  };
}
