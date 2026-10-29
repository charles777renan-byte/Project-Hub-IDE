import type { UsageSummaryDto } from '@project-hub/contracts';
import { usageDetailText, usageIndicatorText } from '../terminal-usage';
import { useCountUp } from './use-count-up';

/**
 * Tokens de saída que o terminal já gastou, no cabeçalho do painel, entre o título e a marca de estado. Sem
 * `usage` (provedor que não informa o gasto, ou leitura ainda sem número) não desenha nada: nunca um zero
 * no lugar. O número curto é só visual e sobe animado a cada leitura nova (`useCountUp`), acendendo enquanto
 * conta; o leitor de tela lê o detalhe inteiro, já no valor final, que também é a dica do mouse.
 * Sem região viva: a lista dos terminais é relida a cada 2 s e anunciar cada mudança seria ruído.
 */
export function PaneUsage({ usage }: { usage: UsageSummaryDto | undefined }) {
  const { value, counting } = useCountUp(usage?.outputTokens);
  if (usage === undefined) return null;
  const detail = usageDetailText(usage);
  return (
    <span className="pane__usage" title={detail}>
      <span
        className="pane__usage-value"
        data-counting={counting ? 'true' : undefined}
        aria-hidden="true"
      >
        {usageIndicatorText({ ...usage, outputTokens: value ?? usage.outputTokens })}
      </span>
      <span className="pane__usage-sr">{`Tokens deste terminal. ${detail}`}</span>
    </span>
  );
}
