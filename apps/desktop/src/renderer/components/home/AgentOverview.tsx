import { useEffect, useState } from 'react';
// Só tipos do contrato: o barrel dos contratos puxaria o zod para o bundle do renderer.
import type { AgentActivity } from '@project-hub/contracts';
import {
  agentShares,
  compactNumber,
  dayCells,
  overviewStats,
  windowOf,
  type AgentFilter,
  type AgentShare,
  type DayCell,
  type Metric,
  type Period,
} from '../../agent-overview';
import { HOME_TEXT } from '../../mission-text';
import { Tabs, type TabItem } from '../Tabs';

const TEXT = HOME_TEXT.overview;

type TabId = 'overview' | 'messages' | 'tokens';

const TABS: readonly TabItem<TabId>[] = [
  { id: 'overview', label: TEXT.tabs.overview },
  { id: 'messages', label: TEXT.tabs.messages },
  { id: 'tokens', label: TEXT.tabs.tokens },
];

const PERIODS: readonly Period[] = ['all', 7, 30, 90];

/** O painel que as três abas controlam: o mapa troca de métrica, mas o lugar na tela é o mesmo. */
const PANEL_ID = 'agent-overview-panel';

/** Agentes com cor própria. Qualquer outro id usa a rampa neutra, sem entrar cru no nome de uma classe. */
const COLORED_AGENTS: readonly string[] = ['claude', 'codex', 'antigravity'];

function agentClass(id: string | null): string {
  return id !== null && COLORED_AGENTS.includes(id) ? id : 'outro';
}

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR');
const DAY_FORMAT = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

/** Lê `AAAA-MM-DD` como data local; `new Date('AAAA-MM-DD')` seria UTC e erraria o dia nos fusos a oeste. */
function parseKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AgentActivity };

/**
 * Bloco "Visão geral" do Início, de largura toda: o uso dos agentes feito pelo app, em mensagens e em tokens por
 * dia. O cabeçalho traz o título, as abas (Visão geral, Mensagens e Tokens) e o período (Tudo, 7, 30 e 90 dias,
 * com 90 de padrão); abaixo, um chip por agente do registro, o mapa e uma nota. A aba Visão geral e a de
 * Mensagens desenham o mapa de mensagens, a de Tokens o de tokens; só a Visão geral leva os totais ao lado.
 * Com "Todos", cada dia leva a cor do agente dominante; com um agente filtrado, a rampa dele. Falta de dado
 * (os tokens do Antigravity, um agente sem leitor) aparece como aviso no lugar do mapa, nunca como zero.
 * A cor e o nível entram por classe, nunca por estilo escrito (CSP). Os dados vêm de `activity.agents`.
 * Acessibilidade: o mapa é um grupo nomeado pelo resumo (que muda com a aba), cada dia é uma imagem com o mesmo
 * texto do `title` e não recebe foco; rótulos de linha, células vazias, pontos dos chips e legenda ficam
 * `aria-hidden`. `today` existe para o teste.
 */
export function AgentOverview({ today }: { today?: Date }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [tab, setTab] = useState<TabId>('overview');
  const [period, setPeriod] = useState<Period>(90);
  const [agent, setAgent] = useState<AgentFilter>('all');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: State;
      try {
        const result = await window.projectHub.activity.agents();
        next = result.ok ? { status: 'ready', data: result.data } : { status: 'error' };
      } catch {
        // Sem o preload (testes) ou com o canal fora do ar: o bloco avisa e o resto da tela segue.
        next = { status: 'error' };
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  let content;
  if (state.status === 'loading') {
    content = (
      <p className="overview-note" role="status">
        {HOME_TEXT.loading}
      </p>
    );
  } else if (state.status === 'error') {
    content = (
      <p className="overview-note" role="alert">
        {TEXT.error}
      </p>
    );
  } else {
    content = (
      <Ready
        data={state.data}
        today={today ?? new Date()}
        tab={tab}
        period={period}
        agent={agent}
        onAgent={setAgent}
      />
    );
  }

  return (
    <section className="home-block overview" aria-labelledby="overview-title">
      <div className="overview__head">
        <h2 id="overview-title" className="home-block__title">
          {TEXT.title}
        </h2>
        {state.status === 'ready' ? (
          <>
            <Tabs
              label={TEXT.tabsLabel}
              tabs={TABS}
              active={tab}
              onChange={setTab}
              panelId={() => PANEL_ID}
            />
            <div
              role="group"
              aria-label={TEXT.periodGroup}
              className="filter-chips overview__periods"
            >
              {PERIODS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="filter-chip"
                  aria-pressed={period === option}
                  onClick={() => setPeriod(option)}
                >
                  {TEXT.periods[option]}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
      {content}
    </section>
  );
}

type ReadyProps = {
  data: AgentActivity;
  today: Date;
  tab: TabId;
  period: Period;
  agent: AgentFilter;
  onAgent: (agent: AgentFilter) => void;
};

/** Chips de agente, mapa (ou o aviso no lugar dele), totais e a nota, para a aba, o período e o agente dados. */
function Ready({ data, today, tab, period, agent, onAgent }: ReadyProps) {
  const metric: Metric = tab === 'tokens' ? 'tokens' : 'messages';
  const labelOf = (id: string): string => data.agents.find((item) => item.id === id)?.label ?? id;
  const selected = data.agents.find((item) => item.id === agent);
  const unavailable =
    selected !== undefined &&
    !(metric === 'messages' ? selected.messagesAvailable : selected.tokensAvailable);

  const days = windowOf(period, today, data.since);
  const cells = dayCells(data, days, metric, agent);
  const stats = overviewStats(data, days, agent);
  const total = (metric === 'messages' ? stats.messages : stats.tokens) ?? 0;

  let body;
  if (selected !== undefined && unavailable) {
    body = <p className="overview-note">{TEXT.unavailable(metric, selected.label)}</p>;
  } else if (total === 0) {
    body = <p className="overview-note">{TEXT.empty[metric]}</p>;
  } else {
    const summary = TEXT.summary(
      metric,
      NUMBER_FORMAT.format(total),
      total === 1,
      selected === undefined ? null : selected.label,
      period,
    );
    body = (
      <HeatMap
        cells={cells}
        metric={metric}
        summary={summary}
        legendClass={selected === undefined ? 'outro' : agentClass(selected.id)}
        labelOf={labelOf}
      />
    );
  }

  // Na Visão geral, os totais aparecem com mensagens ou tokens no período: um período só com tokens de
  // missão (que não somam mensagens) mostra os tokens ao lado do aviso de "nenhuma mensagem".
  const showStats =
    tab === 'overview' && !unavailable && (total !== 0 || (stats.tokens ?? 0) !== 0);

  return (
    <>
      <div role="group" aria-label={TEXT.agentGroup} className="filter-chips">
        <button
          type="button"
          className="filter-chip"
          aria-pressed={agent === 'all'}
          onClick={() => onAgent('all')}
        >
          {TEXT.allAgents}
        </button>
        {data.agents.map((item) => (
          <button
            key={item.id}
            type="button"
            className="filter-chip"
            aria-pressed={agent === item.id}
            onClick={() => onAgent(item.id)}
          >
            <span
              className={`overview-dot overview-agent--${agentClass(item.id)}`}
              aria-hidden="true"
            />
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={`tab-${tab}`}
        className={showStats ? 'overview__body overview__body--stats' : 'overview__body'}
      >
        {body}
        {showStats ? (
          <Stats data={data} days={days} agent={agent} stats={stats} labelOf={labelOf} />
        ) : null}
      </div>
      <p className="overview-note">{TEXT.note}</p>
    </>
  );
}

function amountOf(metric: Metric, value: number | null): string {
  const formatted = value === null ? '' : NUMBER_FORMAT.format(value);
  return metric === 'messages'
    ? TEXT.amount.messages(value, formatted)
    : TEXT.amount.tokens(value, formatted);
}

/**
 * O mapa: um quadrado por dia em colunas de semana (domingo a sábado). A primeira coluna começa no dia da semana
 * do primeiro dia do período, então os dias antes dele entram como espaços em branco. O último dia é hoje.
 */
function HeatMap({
  cells,
  metric,
  summary,
  legendClass,
  labelOf,
}: {
  cells: DayCell[];
  metric: Metric;
  summary: string;
  legendClass: string;
  labelOf: (id: string) => string;
}) {
  const first = cells[0];
  const blanks = first === undefined ? 0 : parseKey(first.date).getDay();
  return (
    <div className="overview-map">
      {/* Grupo nomeado pelo resumo; cada dia abaixo é uma imagem com nome, e o resto fica escondido. */}
      <div className="overview-grid" role="group" aria-label={summary}>
        {/* Primeira coluna: os rótulos de dia (uma linha por dia da semana). */}
        {TEXT.rowLabels.map((label, row) => (
          <span key={`label-${row}`} className="overview-grid__label" aria-hidden="true">
            {label}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, index) => (
          <span
            key={`blank-${index}`}
            className="overview-cell overview-cell--blank"
            aria-hidden="true"
          />
        ))}
        {cells.map((cell, index) => {
          const color =
            cell.level > 0 && cell.color !== null
              ? ` overview-agent--${agentClass(cell.color)}`
              : '';
          const current = index === cells.length - 1 ? ' overview-cell--today' : '';
          const name = TEXT.dayName(
            DAY_FORMAT.format(parseKey(cell.date)),
            amountOf(metric, cell.value),
            cell.level > 0 && cell.color !== null ? labelOf(cell.color) : null,
          );
          return (
            <span
              key={cell.date}
              className={`overview-cell overview-level--${cell.level}${color}${current}`}
              role="img"
              aria-label={name}
              title={name}
            />
          );
        })}
      </div>
      <div className="overview-legend" aria-hidden="true">
        <span>{TEXT.legendLess}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`overview-cell overview-level--${level}${level > 0 ? ` overview-agent--${legendClass}` : ''}`}
          />
        ))}
        <span>{TEXT.legendMore}</span>
      </div>
    </div>
  );
}

/** Os agentes com mensagens no período e sem tokens (para o "sem Antigravity" ao lado do total). */
function agentsWithoutTokens(data: AgentActivity, days: string[]): string[] {
  const inWindow = new Set(days);
  return data.agents
    .filter((item) => {
      const own = data.days.filter((row) => row.agent === item.id && inWindow.has(row.date));
      const hasMessages = own.some((row) => (row.messages ?? 0) > 0);
      const hasTokens = own.some((row) => row.tokens !== null);
      return hasMessages && (!item.tokensAvailable || !hasTokens);
    })
    .map((item) => item.label);
}

/** Um total: o valor curto na tela e o completo para o leitor de tela e a dica do mouse. */
function Amount({ metric, value }: { metric: Metric; value: number }) {
  const full = NUMBER_FORMAT.format(value);
  const shown = metric === 'tokens' ? compactNumber(value) : full;
  return (
    <span title={full}>
      <span aria-hidden="true">{shown}</span>
      <span className="visually-hidden">{full}</span>
    </span>
  );
}

/**
 * A barra fina com a parte de cada agente, em SVG: a largura de cada pedaço vai em atributo do SVG, porque a CSP
 * não aceita estilo escrito, e a cor vem da classe do agente. É só desenho (a legenda abaixo diz os números).
 */
function ShareBar({ shares }: { shares: AgentShare[] }) {
  const total = shares.reduce((sum, share) => sum + share.value, 0);
  let x = 0;
  return (
    <svg
      className="overview-share"
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {shares.map((share) => {
        const width = total === 0 ? 0 : (share.value / total) * 100;
        const rect = (
          <rect
            key={share.agent}
            className={`overview-share__part overview-agent--${agentClass(share.agent)}`}
            x={x}
            y={0}
            width={width}
            height={6}
          />
        );
        x += width;
        return rect;
      })}
    </svg>
  );
}

/** Total de uma métrica com a barra por agente e a legenda (agente e a parte dele). */
function TotalWithShares({
  metric,
  label,
  value,
  hint,
  shares,
  labelOf,
}: {
  metric: Metric;
  label: string;
  value: number | null;
  hint: string | null;
  shares: AgentShare[];
  labelOf: (id: string) => string;
}) {
  return (
    <li className="overview-total">
      <span className="overview-stat__label">{label}</span>
      <span className="overview-total__value">
        {value === null ? TEXT.unavailableValue : <Amount metric={metric} value={value} />}
        {hint === null ? null : <span className="overview-stat__hint">{` · ${hint}`}</span>}
      </span>
      {value !== null && shares.length > 0 ? (
        <>
          <ShareBar shares={shares} />
          <ul className="overview-legend-list" aria-label={TEXT.sharesLabel(label)}>
            {shares.map((share) => (
              <li key={share.agent} className="overview-legend-list__item">
                <span
                  className={`overview-dot overview-agent--${agentClass(share.agent)}`}
                  aria-hidden="true"
                />
                {labelOf(share.agent)} <Amount metric={metric} value={share.value} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

/**
 * Totais do período ao lado do mapa (aba Visão geral): mensagens e tokens, cada um com a barra da parte de cada
 * agente, e embaixo a sequência atual e o dia mais ativo. Com um agente filtrado, a barra tem só ele.
 */
function Stats({
  data,
  days,
  agent,
  stats,
  labelOf,
}: {
  data: AgentActivity;
  days: string[];
  agent: AgentFilter;
  stats: ReturnType<typeof overviewStats>;
  labelOf: (id: string) => string;
}) {
  const missing = stats.tokensPartial ? agentsWithoutTokens(data, days) : [];
  const own = (shares: AgentShare[]) =>
    agent === 'all' ? shares : shares.filter((share) => share.agent === agent);
  return (
    <ul className="overview-stats" aria-label={TEXT.statsLabel}>
      <TotalWithShares
        metric="messages"
        label={TEXT.stat.messages}
        value={stats.messages}
        hint={null}
        shares={own(agentShares(data, days, 'messages'))}
        labelOf={labelOf}
      />
      <TotalWithShares
        metric="tokens"
        label={TEXT.stat.tokens}
        value={stats.tokens}
        hint={stats.tokens !== null && missing.length > 0 ? TEXT.without(missing) : null}
        shares={own(agentShares(data, days, 'tokens'))}
        labelOf={labelOf}
      />
      <li className="overview-stat">
        <span className="overview-stat__label">{TEXT.stat.streak}</span>
        <span className="overview-stat__value">{TEXT.days(stats.streak)}</span>
      </li>
      <li className="overview-stat">
        <span className="overview-stat__label">{TEXT.stat.busiest}</span>
        <span className="overview-stat__value">
          {stats.busiestWeekday === null
            ? TEXT.noValue
            : (TEXT.weekdays[stats.busiestWeekday] ?? TEXT.noValue)}
        </span>
      </li>
    </ul>
  );
}
