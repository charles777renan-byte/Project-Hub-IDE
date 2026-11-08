import type { TerminalSummary } from '@project-hub/contracts';
import { contextDetailText, contextLevel, contextPercent } from '../terminal-context';

/**
 * Quanto da janela de contexto a última resposta do agente ocupa, no fim da linha 2 do cabeçalho do painel: o
 * rótulo, uma barra curta e a porcentagem (sempre visível, com teto de 100%). Sem `context` (terminal de missão,
 * outro programa, ou resposta ainda sem número) não desenha nada, nunca um zero. A cor segue o nível: cinza
 * abaixo de 80%, violeta daí em diante (`data-level`, em workspace.css). A largura da barra vai pelo `style`
 * (CSSOM, que a CSP permite; ela só barra `<style>`). O leitor de tela lê o detalhe inteiro, que também é a dica.
 */
export function PaneContext({ context }: { context: TerminalSummary['context'] }) {
  if (context === undefined) return null;
  const percent = contextPercent(context);
  const detail = contextDetailText(context);
  return (
    <span className="pane__context" data-level={contextLevel(percent)} title={detail}>
      <small aria-hidden="true">contexto</small>
      <span className="pane__context-bar" aria-hidden="true">
        <span className="pane__context-fill" style={{ width: `${percent}%` }} />
      </span>
      <b aria-hidden="true">{`${percent}%`}</b>
      <span className="pane__context-sr">{detail}</span>
    </span>
  );
}
