import { ClaudeLimits } from './ClaudeLimits';

/**
 * Uso dos agentes: o cartão dos limites do Claude e, abaixo, uma linha para os programas que ainda não
 * têm fonte de dados.
 */
export function AgentUsage() {
  return (
    <section className="home-block agent-usage" aria-labelledby="agent-usage-title">
      <h2 id="agent-usage-title" className="home-block__title">
        Uso dos agentes
      </h2>
      <ClaudeLimits />
      <p className="agent-usage__empty">Codex e Antigravity CLI: Em breve.</p>
    </section>
  );
}
