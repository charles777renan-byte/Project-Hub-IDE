import type { AccountProviderId } from '@project-hub/contracts';

/**
 * Programas com conta por chave de API. O Claude Code desde 2026-11-21; o Codex desde 2026-11-22, por um provedor
 * próprio passado na linha do programa (`CODEX_API_PROVIDER_ARGS`), que lê a chave do ambiente sem login.
 */
export const API_KEY_PROVIDERS = ['claude', 'codex'] as const;
export type ApiKeyProviderId = (typeof API_KEY_PROVIDERS)[number];

/** A recusa de conta API para um programa fora de `API_KEY_PROVIDERS`. */
export const API_KEY_UNSUPPORTED = 'Este programa não tem conta por chave de API.';

/** A variável do ambiente que leva a chave ao programa da conta. */
export const API_KEY_VARIABLE: Record<ApiKeyProviderId, string> = {
  claude: 'ANTHROPIC_API_KEY',
  codex: 'OPENAI_API_KEY',
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
const OPENAI_PREFIX = 'sk-';
const OPENAI_ADMIN_PREFIX = 'sk-admin-';

/** O serviço de cada programa, nas frases da recusa. */
const SERVICE: Record<ApiKeyProviderId, string> = { claude: 'Anthropic', codex: 'OpenAI' };

/**
 * O que há de errado com o texto, ou `undefined` se ele tem a forma de uma chave de API do serviço do programa. O
 * texto chega aparado. A forma não prova que a chave vale: o app não faz chamada cobrada para conferir. Uma chave de
 * um serviço na conta do outro é recusada: as da Anthropic começam com `sk-ant-`, que também começa com `sk-`.
 */
export function apiKeyProblem(provider: ApiKeyProviderId, text: string): KeyProblem | undefined {
  if (text.length < KEY_MIN || text.length > KEY_MAX || !KEY_CHARACTERS.test(text)) {
    return 'not-a-key';
  }
  if (provider === 'claude') {
    if (text.startsWith(ANTHROPIC_ADMIN_PREFIX)) return 'admin-key';
    return text.startsWith(ANTHROPIC_PREFIX) ? undefined : 'not-a-key';
  }
  if (text.startsWith(ANTHROPIC_PREFIX)) return 'not-a-key';
  if (text.startsWith(OPENAI_ADMIN_PREFIX)) return 'admin-key';
  return text.startsWith(OPENAI_PREFIX) ? undefined : 'not-a-key';
}

/** A frase da recusa. Nunca repete o texto lido. */
export function keyProblemText(provider: ApiKeyProviderId, problem: KeyProblem): string {
  return problem === 'admin-key'
    ? 'Esta é uma chave de administração. Use uma chave de API comum.'
    : `A área de transferência não tem uma chave de API da ${SERVICE[provider]}.`;
}
