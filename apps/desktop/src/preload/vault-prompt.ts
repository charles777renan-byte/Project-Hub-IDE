import { contextBridge, ipcRenderer } from 'electron';
import { VAULT_PROMPT_CHANNELS } from '../main/vault-prompt-channels';

// A janela do cofre recebe só isto, em window.vaultPrompt: pedir o modo, enviar a senha e cancelar.
contextBridge.exposeInMainWorld('vaultPrompt', {
  state: () => ipcRenderer.invoke(VAULT_PROMPT_CHANNELS.state),
  submit: (payload: { password: string; next?: string }) =>
    ipcRenderer.invoke(VAULT_PROMPT_CHANNELS.submit, payload),
  cancel: () => ipcRenderer.invoke(VAULT_PROMPT_CHANNELS.cancel),
});
