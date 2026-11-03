import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
// Só tipos do contrato: o barrel dos contratos puxaria o zod para o bundle do renderer.
import type { AgentActivity } from '@project-hub/contracts';
import {
  agentRows,
  compactNumber,
  dayCells,
  gridSize,
  monthMarks,
  overviewStats,
  weekLayout,
  windowOf,
  type AgentFilter,
  type AgentRow,
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
 * dia. O cabeçalho traz o título, as abas (Resumo, Mensagens e Tokens) e o período (Tudo, 7, 30 e 90 dias, com 90
 * de padrão); abaixo, um chip por agente do registro, o corpo em colunas e uma nota. O corpo tem "Por dia" (o
 * mapa compacto, com a régua de meses), "Por agente" (a tabela com a parte de cada um) e, só no Resumo, "No
 * período" (os totais). A aba Resumo e a de Mensagens desenham o mapa de mensagens, a de Tokens o de tokens.
 * Com "Todos", cada dia leva a cor do agente dominante; com um agente filtrado, a rampa dele, e a linha dele
 * fica marcada na tabela, que segue mostrando todos. Falta de dado (os tokens do Antigravity, um agente sem
 * leitor) aparece como "indisponível" e como aviso no lugar do mapa, nunca como zero.
 * A cor, o nível e o tamanho das células entram por classe, nunca por estilo escrito (CSP); a largura das barras
 * vai em atributo de SVG. Os dados vêm de `activity.agents`.
 * Acessibilidade: o mapa é um grupo nomeado pelo resumo (que muda com a aba), cada dia é uma imagem com o mesmo
 * texto do `title` e não recebe foco; rótulos de linha, régua, células vazias, pontos, barras e legenda ficam
 * `aria-hidden` (a tabela diz os mesmos números em texto). `today` existe para o teste.
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

/** Chips de agente, o corpo em colunas (ou o aviso no lugar dele) e a nota, para a aba, o período e o agente dados. */
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

  // Na Visão geral, os totais aparecem com mensagens ou tokens no período: um período só com tokens de
  // missão (que não somam mensagens) mostra os tokens ao lado do aviso de "nenhuma mensagem".
  const showStats =
    tab === 'overview' && !unavailable && (total !== 0 || (stats.tokens ?? 0) !== 0);

  let body: ReactNode;
  let hasMap = false;
  if (selected !== undefined && unavailable) {
    body = <p className="overview-note">{TEXT.unavailable(metric, selected.label)}</p>;
  } else if (total === 0) {
    body = <p className="overview-note">{TEXT.empty[metric]}</p>;
  } else {
    hasMap = true;
    const summary = TEXT.summary(
      metric,
      NUMBER_FORMAT.format(total),
      total === 1,
      selected === undefined ? null : selected.label,
      period,
    );
    body = (
      <>
        <div className="overview-col">
          <h3 className="overview-col__title">{TEXT.columns.day}</h3>
          <HeatMap
            cells={cells}
            metric={metric}
            summary={summary}
            legendClass={selected === undefined ? 'outro' : agentClass(selected.id)}
            labelOf={labelOf}
          />
        </div>
        <div className="overview-col">
          <h3 className="overview-col__title">{TEXT.columns.agents}</h3>
          <AgentTable
            data={data}
            days={days}
            tab={tab}
            metric={metric}
            selectedId={selected?.id ?? null}
          />
        </div>
      </>
    );
  }

  const bodyClass = [
    'overview__body',
    hasMap ? 'overview__body--map' : null,
    showStats ? 'overview__body--stats' : null,
  ]
    .filter(Boolean)
    .join(' ');

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
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={`tab-${tab}`} className={bodyClass}>
        {body}
        {showStats ? (
          <div className="overview-col">
            <h3 className="overview-col__title">{TEXT.columns.totals}</h3>
            <Stats data={data} days={days} stats={stats} />
          </div>
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
 * O mapa: um quadrado por dia em colunas de semana (domingo a sábado). Cada coluna começa por uma célula da régua
 * de meses (com o nome do mês onde ele começa) e traz os sete dias; a primeira coluna leva os rótulos de dia. A
 * primeira semana começa no dia da semana do primeiro dia do período, então os dias antes dele entram como
 * espaços em branco. O último dia é hoje. Com muitas semanas o mapa rola na horizontal, já parado em hoje.
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
  const days = cells.map((cell) => cell.date);
  const { blanks, weeks } = weekLayout(days);
  const marks = monthMarks(days);
  const size = gridSize(weeks);
  const scroller = useRef<HTMLDivElement>(null);
  // Um mapa mais largo que a coluna abre no fim, onde está hoje; sem sobra, a rolagem é zero e nada muda.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element !== null) element.scrollLeft = element.scrollWidth;
  }, [size, weeks]);

  const items: ReactNode[] = [
    // Primeira coluna: o canto da régua e os rótulos de dia (uma linha por dia da semana).
    <span key="corner" className="overview-grid__ruler" aria-hidden="true" />,
    ...TEXT.rowLabels.map((label, row) => (
      <span key={`label-${row}`} className="overview-grid__label" aria-hidden="true">
        {label}
      </span>
    )),
  ];
  for (let week = 0; week < weeks; week += 1) {
    items.push(
      <span
        key={`ruler-${week}`}
        className={
          week === weeks - 1
            ? 'overview-grid__ruler overview-grid__ruler--end'
            : 'overview-grid__ruler'
        }
        aria-hidden="true"
      >
        {marks[week]}
      </span>,
    );
    for (let row = 0; row < 7; row += 1) {
      const slot = week * 7 + row;
      const index = slot - blanks;
      if (index < 0) {
        items.push(
          <span
            key={`blank-${slot}`}
            className="overview-cell overview-cell--blank"
            aria-hidden="true"
          />,
        );
        continue;
      }
      const cell = cells[index];
      // Depois de hoje não há mais dia: só a última coluna fica incompleta.
      if (cell === undefined) break;
      const color =
        cell.level > 0 && cell.color !== null ? ` overview-agent--${agentClass(cell.color)}` : '';
      const current = index === cells.length - 1 ? ' overview-cell--today' : '';
      const name = TEXT.dayName(
        DAY_FORMAT.format(parseKey(cell.date)),
        amountOf(metric, cell.value),
        cell.level > 0 && cell.color !== null ? labelOf(cell.color) : null,
      );
      items.push(
        <span
          key={cell.date}
          className={`overview-cell overview-level--${cell.level}${color}${current}`}
          role="img"
          aria-label={name}
          title={name}
        />,
      );
    }
  }

  return (
    <div className="overview-map">
      <div className="overview-map__scroll" ref={scroller}>
        {/* Grupo nomeado pelo resumo; cada dia abaixo é uma imagem com nome, e o resto fica escondido. */}
        <div
          className={size === 'normal' ? 'overview-grid' : `overview-grid overview-grid--${size}`}
          role="group"
          aria-label={summary}
        >
          {items}
        </div>
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

/** O traço de "sem dado": o leitor de tela ouve "indisponível", nunca um zero. */
function Missing() {
  return (
    <>
      <span aria-hidden="true">{TEXT.noValue}</span>
      <span className="visually-hidden">{TEXT.unavailableValue}</span>
    </>
  );
}

/**
 * A barra fina com a parte de um agente, em SVG: a largura vai em atributo do SVG, porque a CSP não aceita estilo
 * escrito, e a cor vem da classe do agente. É só desenho (a tabela diz os números).
 */
function ShareBar({ agent, percent }: { agent: string; percent: number }) {
  return (
    <svg
      className="overview-share"
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {percent > 0 ? (
        <rect
          className={`overview-share__part overview-agent--${agentClass(agent)}`}
          x={0}
          y={0}
          width={percent}
          height={6}
        />
      ) : null}
    </svg>
  );
}

/** O valor de uma métrica numa linha: o número (curto nos tokens) ou o traço de "indisponível". */
function MetricValue({ metric, value }: { metric: Metric; value: number | null }) {
  if (value === null) return <Missing />;
  return metric === 'messages' ? (
    <>{NUMBER_FORMAT.format(value)}</>
  ) : (
    <Amount metric={metric} value={value} />
  );
}

/**
 * A tabela "Por agente": uma linha por agente do registro, sempre todos (o filtro de agente não a muda, só marca a
 * linha). No Resumo traz mensagens e tokens, cada um com o traço quando o agente não tem leitor; em Mensagens e em
 * Tokens traz a métrica da aba, a parte de cada agente em % e uma linha de total. A barra de cada linha é a parte do
 * agente na métrica da aba (mensagens, no Resumo).
 */
function AgentTable({
  data,
  days,
  tab,
  metric,
  selectedId,
}: {
  data: AgentActivity;
  days: string[];
  tab: TabId;
  metric: Metric;
  selectedId: string | null;
}) {
  const rows = agentRows(data, days);
  const sumOf = (key: Metric): number => rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  const base = sumOf(metric);
  const percentOf = (row: AgentRow): number => (base > 0 ? ((row[metric] ?? 0) / base) * 100 : 0);
  const overview = tab === 'overview';
  const missing = metric === 'tokens' ? agentsWithoutTokens(data, days) : [];
  const metricLabel = metric === 'messages' ? TEXT.tabs.messages : TEXT.tabs.tokens;

  return (
    <table className="overview-agents" aria-label={TEXT.agentsLabel}>
      <thead>
        <tr>
          <th scope="col">{TEXT.agentsHead.agent}</th>
          <th scope="col" className="overview-agents__bar">
            <span className="visually-hidden">{TEXT.agentsHead.bar}</span>
          </th>
          {overview ? (
            <>
              <th scope="col" className="overview-agents__number">
                {TEXT.tabs.messages}
              </th>
              <th scope="col" className="overview-agents__number">
                {TEXT.tabs.tokens}
              </th>
            </>
          ) : (
            <>
              <th scope="col" className="overview-agents__number">
                {metricLabel}
              </th>
              <th scope="col" className="overview-agents__number">
                {TEXT.agentsHead.share}
              </th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const chosen = row.id === selectedId;
          return (
            <tr
              key={row.id}
              className={
                chosen
                  ? 'overview-agents__row overview-agents__row--selected'
                  : 'overview-agents__row'
              }
              aria-current={chosen ? 'true' : undefined}
            >
              <th scope="row" className="overview-agents__name">
                <span
                  className={`overview-dot overview-agent--${agentClass(row.id)}`}
                  aria-hidden="true"
                />
                {row.label}
              </th>
              <td className="overview-agents__bar" aria-hidden="true">
                <ShareBar agent={row.id} percent={percentOf(row)} />
              </td>
              {overview ? (
                <>
                  <td className="overview-agents__number">
                    <MetricValue metric="messages" value={row.messages} />
                  </td>
                  <td className="overview-agents__number">
                    <MetricValue metric="tokens" value={row.tokens} />
                  </td>
                </>
              ) : (
                <>
                  <td className="overview-agents__number">
                    <MetricValue metric={metric} value={row[metric]} />
                  </td>
                  <td className="overview-agents__number">
                    {row[metric] === null ? '' : `${Math.round(percentOf(row))}%`}
                  </td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
      {overview ? null : (
        <tfoot>
          <tr className="overview-agents__total">
            <th scope="row" colSpan={2}>
              {TEXT.agentsTotal}
              {missing.length > 0 ? (
                <span className="overview-stat__hint">{` ${TEXT.without(missing)}`}</span>
              ) : null}
            </th>
            <td className="overview-agents__number">
              <MetricValue metric={metric} value={base} />
            </td>
            <td className="overview-agents__number">{base > 0 ? '100%' : ''}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Um total do período: o rótulo à esquerda e o valor à direita, com a observação ("sem Antigravity") embaixo. */
function Total({
  metric,
  label,
  value,
  hint,
}: {
  metric: Metric;
  label: string;
  value: number | null;
  hint: string | null;
}) {
  return (
    <li className="overview-total">
      <span className="overview-stat__label">{label}</span>
      <span className="overview-total__value">
        {value === null ? TEXT.unavailableValue : <Amount metric={metric} value={value} />}
        {hint === null ? null : <span className="overview-stat__hint">{` ${hint}`}</span>}
      </span>
    </li>
  );
}

/**
 * Os totais do período (aba Resumo): mensagens e tokens, e embaixo a sequência atual e o dia mais ativo. Com um
 * agente filtrado, valem os números dele. A parte de cada agente fica na tabela "Por agente".
 */
function Stats({
  data,
  days,
  stats,
}: {
  data: AgentActivity;
  days: string[];
  stats: ReturnType<typeof overviewStats>;
}) {
  const missing = stats.tokensPartial ? agentsWithoutTokens(data, days) : [];
  return (
    <ul className="overview-stats" aria-label={TEXT.statsLabel}>
      <Total metric="messages" label={TEXT.stat.messages} value={stats.messages} hint={null} />
      <Total
        metric="tokens"
        label={TEXT.stat.tokens}
        value={stats.tokens}
        hint={stats.tokens !== null && missing.length > 0 ? TEXT.without(missing) : null}
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
