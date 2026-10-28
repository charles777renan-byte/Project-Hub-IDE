import { useEffect, useState } from 'react';
// A janela vem do subpath sem zod: o barrel dos contratos puxaria o zod para o bundle do renderer.
import { ACTIVITY_WINDOW_DAYS } from '@project-hub/contracts/activity-window';
import type { ActivityDay } from '@project-hub/contracts';
import { HOME_TEXT } from '../../mission-text';

const LOAD_ERROR = 'Não foi possível carregar a atividade.';

/** Dia local como `AAAA-MM-DD`, o mesmo agrupamento que o banco faz (`localtime`). */
function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Os `days` dias locais até `today` (inclusive), do mais antigo ao mais novo. Conta pelo calendário, não em 24 h fixas. */
function windowDays(days: number, today: Date): Date[] {
  return Array.from(
    { length: days },
    (_, index) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index)),
  );
}

/**
 * Nível de cada um dos `days` dias até `today`, do mais antigo ao mais novo. 0 é dia sem evento; de 1 a
 * 4, a fração do maior dia do período (até 25% é 1, até 50% é 2, até 75% é 3, acima disso é 4). O banco
 * não devolve dias sem evento: o que falta em `counts` conta zero.
 */
export function levelsFor(counts: ActivityDay[], days: number, today: Date): number[] {
  const byDate = new Map(counts.map(({ date, count }) => [date, count]));
  const values = windowDays(days, today).map((day) => byDate.get(dateKey(day)) ?? 0);
  const max = Math.max(0, ...values);
  return values.map((value) =>
    value <= 0 || max === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((value / max) * 4))),
  );
}

/**
 * Sequência atual: quantos dias seguidos, até `today` (inclusive), têm ao menos um evento. Se hoje não
 * tem evento, é 0. Vai no máximo até o tamanho da janela de atividade.
 */
export function currentStreak(counts: ActivityDay[], today: Date): number {
  const byDate = new Map(counts.map(({ date, count }) => [date, count]));
  let streak = 0;
  for (const day of windowDays(ACTIVITY_WINDOW_DAYS, today).reverse()) {
    if ((byDate.get(dateKey(day)) ?? 0) <= 0) break;
    streak += 1;
  }
  return streak;
}

/**
 * Quantas células vazias vêm antes do primeiro dia da janela: a primeira coluna começa no domingo, então
 * o primeiro dia cai na linha do seu dia da semana (domingo é 0, sábado é 6).
 */
export function leadingBlanks(days: number, today: Date): number {
  return windowDays(days, today)[0]?.getDay() ?? 0;
}

/** Rótulos de dia nas linhas do mapa (domingo é a linha 1): só segunda, quarta e sexta. */
const ROW_LABELS = ['', 'seg', '', 'qua', '', 'sex', ''];

const TITLE_FORMAT = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

function eventsLabel(count: number): string {
  if (count === 0) return 'nenhum evento';
  return count === 1 ? '1 evento' : `${count} eventos`;
}

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; days: ActivityDay[] };

/**
 * Atividade dos últimos 90 dias em faixa compacta: uma linha de resumo (total de eventos e sequência
 * atual) e o mapa, um quadrado por dia, em colunas de semana (domingo a sábado) com os rótulos seg, qua e
 * sex à esquerda. A fonte são os eventos de missão (`activity.daily`). O nível entra por classe
 * (`activity-level--0` a `--4`), nunca por estilo escrito. Banco sem evento mostra uma linha só, sem o mapa
 * vazio; se a consulta falha, só este bloco mostra a mensagem. `today` existe para o teste.
 */
export function ActivityHeatmap({ today }: { today?: Date }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: State;
      try {
        const result = await window.projectHub.activity.daily();
        next = result.ok ? { status: 'ready', days: result.data } : { status: 'error' };
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

  let head = null;
  let body;
  if (state.status === 'loading') {
    body = (
      <p className="activity__note" role="status">
        Carregando…
      </p>
    );
  } else if (state.status === 'error') {
    body = (
      <p className="activity__note" role="alert">
        {LOAD_ERROR}
      </p>
    );
  } else {
    const moment = today ?? new Date();
    const dates = windowDays(ACTIVITY_WINDOW_DAYS, moment);
    const byDate = new Map(state.days.map(({ date, count }) => [date, count]));
    const total = dates.reduce((sum, day) => sum + (byDate.get(dateKey(day)) ?? 0), 0);
    if (total === 0) {
      body = <p className="activity__note">{HOME_TEXT.activityEmpty(ACTIVITY_WINDOW_DAYS)}</p>;
    } else {
      const levels = levelsFor(state.days, ACTIVITY_WINDOW_DAYS, moment);
      const blanks = leadingBlanks(ACTIVITY_WINDOW_DAYS, moment);
      const streak = currentStreak(state.days, moment);
      const summary = `${eventsLabel(total)} de missão nos últimos ${ACTIVITY_WINDOW_DAYS} dias.`;
      head = (
        <p className="activity__summary">
          <span className="activity__number">{total}</span>
          <span className="activity__unit">eventos de missão</span>
          <span className="activity__period">nos últimos {ACTIVITY_WINDOW_DAYS} dias</span>
          <span className="activity__streak">
            sequência atual: {streak} {streak === 1 ? 'dia' : 'dias'}
          </span>
        </p>
      );
      body = (
        <div className="activity__map">
          <div className="activity-grid" role="img" aria-label={summary}>
            {/* Primeira coluna: os rótulos de dia (uma linha por dia da semana). */}
            {ROW_LABELS.map((label, row) => (
              <span key={`label-${row}`} className="activity-grid__label" aria-hidden="true">
                {label}
              </span>
            ))}
            {/* A primeira semana começa no domingo: os dias antes do primeiro entram como espaços em branco. */}
            {Array.from({ length: blanks }, (_, index) => (
              <span key={`blank-${index}`} className="activity-cell activity-cell--blank" />
            ))}
            {dates.map((day, index) => {
              const key = dateKey(day);
              const level = levels[index] ?? 0;
              const current = index === dates.length - 1 ? ' activity-cell--today' : '';
              return (
                <span
                  key={key}
                  className={`activity-cell activity-level--${level}${current}`}
                  title={`${TITLE_FORMAT.format(day)}: ${eventsLabel(byDate.get(key) ?? 0)}`}
                />
              );
            })}
          </div>
          <div className="activity-legend" aria-hidden="true">
            <span>menos</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className={`activity-cell activity-level--${level}`} />
            ))}
            <span>mais</span>
          </div>
        </div>
      );
    }
  }

  return (
    <section className="home-block home-activity" aria-labelledby="activity-title">
      <h2 id="activity-title" className="home-block__title">
        Atividade
      </h2>
      {head}
      {body}
    </section>
  );
}
