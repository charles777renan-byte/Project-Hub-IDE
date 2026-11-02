import type { ErrorCode } from '@project-hub/contracts';

/**
 * Erro do serviço de arquivos, com o código que o handler IPC devolve ao renderer. A mensagem é
 * segura para exibir: não traz caminho absoluto nem conteúdo de arquivo.
 */
export class FilesError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'FilesError';
    this.code = code;
  }
}
