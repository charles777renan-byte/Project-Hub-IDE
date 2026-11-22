import type { AccountProviderId } from '@project-hub/contracts';

/**
 * Programas com conta por chave de API. Só o Claude Code nesta entrega: o Codex interativo ignora a chave do
 * ambiente e pede login (prova na máquina, 2026-11-21).
 */
export const API_KEY_PROVIDERS = ['claude'] as const;
export type ApiKeyProviderId = (typeof API_KEY_PROVIDERS)[number];

/** A recusa de conta API para um programa fora de `API_KEY_PROVIDERS`. */
export const API_KEY_ONLY_CLAUDE =
  'Conta por chave de API só existe para o Claude Code por enquanto.';

/** A variável do ambiente que leva a chave ao programa da conta. */
export const API_KEY_VARIABLE: Record<ApiKeyProviderId, string> = {
  claude: 'ANTHROPIC_API_KEY',
};

export function isApiKeyProvider(provider: AccountProviderId): provider is ApiKeyProviderId {
  return (API_KEY_PROVIDERS as readonly string[]).includes(provider);
}

export type KeyProblem = 'not-a-key' | 'admin-key';

const KEY_MIN = 20;
const KEY_MAX = 512;
const KEY_CHARACTERS = /^[A-Za-z0-9_-]+$/;
const ANTHROPIC_PREFIX = 'sk-ant-';
const ANTHROPIC_ADMIN_PREFIX = 'sk-ant-admin';

/**
 * O que há de errado com o texto, ou `undefined` se ele tem a forma de uma chave de API da Anthropic. O texto
 * chega aparado. A forma não prova que a chave vale: o app não faz chamada cobrada para conferir.
 */
export function apiKeyProblem(text: string): KeyProblem | undefined {
  if (text.length < KEY_MIN || text.length > KEY_MAX || !KEY_CHARACTERS.test(text)) {
    return 'not-a-key';
  }
  if (text.startsWith(ANTHROPIC_ADMIN_PREFIX)) return 'admin-key';
  return text.startsWith(ANTHROPIC_PREFIX) ? undefined : 'not-a-key';
}

/** A frase da recusa. Nunca repete o texto lido. */
export function keyProblemText(problem: KeyProblem): string {
  return problem === 'admin-key'
    ? 'Esta é uma chave de administração. Use uma chave de API comum.'
    : 'A área de transferência não tem uma chave de API da Anthropic.';
}
