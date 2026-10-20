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

/** Estado do processo no instante da falha. Quem decide é o estado, nunca o texto ou o código do erro. */
export type LoadFailureState = {
  /** O aplicativo ou a janela está fechando: uma saída já está em andamento. */
  closing: boolean;
};

/** Além do que a falha de inicialização usa, o registro de uma falha ignorada porque estava fechando. */
export type LoadFailureIo = StartupFailureIo & {
  logIgnored(message: string): void;
};

/** `code` e `errno` do erro do Chromium (por exemplo ERR_FAILED e -2), quando existem. */
function describeErrorCodes(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return 'sem código';
  const { code, errno } = cause as { code?: unknown; errno?: unknown };
  const code_ = typeof code === 'string' || typeof code === 'number' ? String(code) : 'sem código';
  const errno_ =
    typeof errno === 'string' || typeof errno === 'number' ? String(errno) : 'sem errno';
  return `code=${code_}, errno=${errno_}`;
}

/**
 * Trata a rejeição do carregamento da janela. Fechar o aplicativo com a página ainda carregando faz
 * o `loadFile`/`loadURL` rejeitar (observado: ERR_FAILED), e a caixa modal travaria a thread que está
 * encerrando o processo, deixando o banco aberto. O erro não distingue "fechando" de falha real, então
 * a decisão vem do estado: se o fechamento está em andamento, só registra e deixa a saída em curso
 * terminar sozinha (`will-quit` fecha o banco, código 0). Com o aplicativo vivo, é falha de
 * inicialização: caixa e código 1.
 */
export function handleWindowLoadFailure(
  cause: unknown,
  state: LoadFailureState,
  io: LoadFailureIo,
): void {
  if (state.closing) {
    io.logIgnored(
      `Carregamento da janela interrompido porque o aplicativo estava fechando (${describeErrorCodes(cause)}): ${describeCause(cause)}`,
    );
    return;
  }
  handleStartupFailure(cause, io);
}
