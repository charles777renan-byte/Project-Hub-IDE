import { LIMIT_PROVIDERS, pendingPrograms, presentProviders } from '../../limits-format';
import { useLimits } from '../../use-limits';
import { LimitsCard } from './ClaudeLimits';

/**
 * Uso dos agentes: um cartão de limites por programa que o estado dos limites traz (o Claude sempre) e, abaixo,
 * uma linha "Em breve" para os que ele ainda não traz. Tudo sai do estado: um programa novo ganha o cartão sozinho.
 * Antes da primeira resposta não há "Em breve" (seria um texto falso que logo troca pelo cartão).
 */
export function AgentUsage() {
  const { limits, refresh } = useLimits();
  const entries = limits?.providers ?? [];
  const cards = presentProviders(entries);
  const pending =
    limits === null ? [] : pendingPrograms(entries).map((id) => LIMIT_PROVIDERS[id].label);

  return (
    <section className="home-block agent-usage" aria-labelledby="agent-usage-title">
      <h2 id="agent-usage-title" className="home-block__title">
        Uso dos agentes
      </h2>
      {cards.map((provider) => (
        <LimitsCard key={provider} provider={provider} limits={limits} refresh={refresh} />
      ))}
      {pending.length > 0 && (
        <p className="agent-usage__empty">{pending.join(' e ')}: Em breve.</p>
      )}
    </section>
  );
}
