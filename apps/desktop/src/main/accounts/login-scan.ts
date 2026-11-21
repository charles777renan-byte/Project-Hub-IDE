import type { AccountProviderId } from '@project-hub/contracts';

/** Os servidores de login de cada programa. Endereço de outro servidor não é aberto nem copiado pelo app. */
export const LOGIN_HOSTS: Record<AccountProviderId, readonly string[]> = {
  claude: ['claude.ai', 'claude.com', 'console.anthropic.com', 'platform.claude.com'],
  codex: ['auth.openai.com'],
};

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Sequências OSC (títulos e links do terminal), CSI (cores e cursor) e os escapes de dois caracteres.
const ANSI = new RegExp(
  [
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}\\[[0-9;?]*[ -/]*[@-~]`,
    `${ESC}[@-Z\\\\^_]`,
  ].join('|'),
  'g',
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

const CANDIDATE = /https:\/\/[^\s"'<>`]+/g;

/**
 * O primeiro endereço de login da saída do programa: `https`, sem usuário, senha nem porta, e num servidor da
 * lista do programa, comparado por inteiro. O resto da saída é ignorado.
 */
export function findLoginUrl(provider: AccountProviderId, output: string): string | undefined {
  const hosts = LOGIN_HOSTS[provider];
  for (const match of stripAnsi(output).matchAll(CANDIDATE)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') continue;
    if (url.port !== '' || !hosts.includes(url.hostname)) continue;
    return url.href;
  }
  return undefined;
}
