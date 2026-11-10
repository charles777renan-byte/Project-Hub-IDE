import type { TerminalSummary } from '@project-hub/contracts';
import { contextDetailText, contextLevel, contextPercent } from '../terminal-context';

/**
 * Quanto da janela de contexto a última resposta do agente ocupa, como um fio de 2px na borda de baixo do
 * cabeçalho do painel: sem rótulo nem número à vista. A porcentagem fica no detalhe para leitor de tela e na dica
 * do título. Vale para o painel avulso do Claude e para o terminal de missão. Sem `context` (outro programa, ou
 * resposta ainda sem número) não desenha nada, nunca um zero. A cor segue o nível: cinza abaixo de 80%, violeta
 * daí em diante (`data-level`, em workspace.css). A largura do fio vai pelo `style` (CSSOM, que a CSP permite;
 * ela só barra `<style>`).
 */
export function PaneContext({ context }: { context: TerminalSummary['context'] }) {
  if (context === undefined) return null;
  const percent = contextPercent(context);
  return (
    <span className="pane__context" data-level={contextLevel(percent)}>
      <span className="pane__context-fill" aria-hidden="true" style={{ width: `${percent}%` }} />
      <span className="pane__context-sr">{contextDetailText(context)}</span>
    </span>
  );
}
