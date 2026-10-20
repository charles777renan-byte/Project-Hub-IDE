/** O que a falha de inicialização precisa do processo: registrar, mostrar a caixa e encerrar. */
export type StartupFailureIo = {
  log(cause: unknown): void;
  showError(message: string): void;
  exit(code: number): void;
};

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Trata a falha de inicialização (banco que não abre, migração que falha, handler que não liga). Sem
 * janela, o processo ficaria parado sem explicação: então registra a causa, mostra a mensagem numa
 * caixa nativa e encerra com código 1. A saída roda mesmo se a caixa falhar.
 */
export function handleStartupFailure(cause: unknown, io: StartupFailureIo): void {
  io.log(cause);
  try {
    io.showError(`Não foi possível iniciar o Project Hub.\n\n${describeCause(cause)}`);
  } finally {
    io.exit(1);
  }
}
