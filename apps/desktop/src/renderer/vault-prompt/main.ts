import { mountVaultPrompt, type VaultPromptApi } from './mount';

declare global {
  interface Window {
    /** Exposta só pelo preload da janela do cofre. */
    vaultPrompt?: VaultPromptApi;
  }
}

const root = document.getElementById('root');
const api = window.vaultPrompt;
if (root !== null && api !== undefined) {
  mountVaultPrompt(root, api).catch(() => {
    // Sem o modo, a página não tem o que mostrar: fechar a janela cancela.
    void api.cancel();
  });
}
