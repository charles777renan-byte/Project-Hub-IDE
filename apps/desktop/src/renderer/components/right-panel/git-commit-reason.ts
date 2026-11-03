import type { GitPanelFileDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from '../../mission-text';

const TEXT = RIGHT_PANEL_TEXT.git;
/** O limite do contrato (`commitMessageSchema`); o contrato não o exporta e o renderer só importa tipos dele. */
const COMMIT_MESSAGE_MAX = 10_000;

/**
 * Por que o commit não pode sair agora, em texto, ou `null` quando pode. A caixa de commit e o menu de ações
 * usam a mesma regra.
 */
export function commitReason(files: GitPanelFileDto[], message: string): string | null {
  const trimmed = message.trim();
  if (files.every((file) => file.staged === null)) return TEXT.reasonNothingStaged;
  if (trimmed === '') return TEXT.reasonEmptyMessage;
  if (trimmed.length > COMMIT_MESSAGE_MAX) return TEXT.reasonMessageTooLong;
  return null;
}
