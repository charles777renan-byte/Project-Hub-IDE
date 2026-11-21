import type { AccountProviderId, TerminalSummary } from '@project-hub/contracts';

/**
 * Os painéis vivos que usam uma conta, pelo título. Enquanto os painéis não abrem com conta escolhida, todo
 * terminal de um programa roda na Principal dele: sair dela derrubaria o login desses agentes no meio do trabalho.
 * Nenhum painel usa uma conta extra ainda.
 */
export function liveSessionsOfAccount(
  terminals: readonly TerminalSummary[],
  provider: AccountProviderId,
  accountId: string | null,
): string[] {
  if (accountId !== null) return [];
  return terminals
    .filter((terminal) => terminal.provider === provider && terminal.state !== 'exited')
    .map((terminal) => terminal.title);
}
