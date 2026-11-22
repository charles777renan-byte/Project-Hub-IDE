/**
 * Canais só da janela da senha do cofre. Ficam fora de `CHANNELS`: a janela principal não os conhece, e o
 * processo principal só os atende enquanto a janela do cofre está aberta, e só para ela.
 */
export const VAULT_PROMPT_CHANNELS = {
  /** A página pede o modo e, se houver, o fim da espera depois de senhas erradas. */
  state: 'vault-prompt:state:v1',
  /** `{ password, next? }`: `next` só no modo de troca. */
  submit: 'vault-prompt:submit:v1',
  cancel: 'vault-prompt:cancel:v1',
} as const;

export type VaultPromptMode = 'create' | 'unlock' | 'change';
