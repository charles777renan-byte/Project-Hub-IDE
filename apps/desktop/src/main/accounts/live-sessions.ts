import type { AccountProviderId, TerminalSummary } from '@project-hub/contracts';

/**
 * Os painéis e os agentes de missão vivos que usam uma conta, pelo título. Sair de uma conta com sessão viva
 * derrubaria o login desses agentes no meio do trabalho. Terminal sem conta informada roda na Principal.
 */
export function liveSessionsOfAccount(
  terminals: readonly TerminalSummary[],
  provider: AccountProviderId,
  accountId: string | null,
): string[] {
  return terminals
    .filter(
      (terminal) =>
        terminal.provider === provider &&
        terminal.state !== 'exited' &&
        (terminal.accountId ?? null) === accountId,
    )
    .map((terminal) => terminal.title);
}
