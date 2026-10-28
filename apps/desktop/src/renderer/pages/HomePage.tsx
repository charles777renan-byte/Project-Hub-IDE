import { useId, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ActivityHeatmap } from '../components/home/ActivityHeatmap';
import { AgentUsage } from '../components/home/AgentUsage';
import { Greeting } from '../components/home/Greeting';
import { MissionProgressList } from '../components/MissionProgressList';
import { TopographicBackground } from '../components/TopographicBackground';
import { useListMotion } from '../list-motion';
import {
  HOME_TEXT,
  matchesStatusFilter,
  needsAttention,
  parseStatusFilter,
  requiredActionOf,
  STATUS_FILTERS,
  type MissionStatusFilter,
} from '../mission-text';
import { EDIT_NAME_PARAM, missionPath } from '../routes';
import { useMissionsBoard } from '../use-missions-board';
import { useOverview } from '../use-overview';

/** Parâmetro do Início com o filtro por estado; os contadores da barra de status levam a ele. */
const STATE_PARAM = 'estado';

/** Faixa do Início: título pequeno, contagem em `--muted` ao lado e o corpo. A região leva o nome do título. */
function Band({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="home-band">
      <header className="home-band__head">
        <h2 id={titleId} className="home-band__title">
          {title}
        </h2>
        {count === undefined ? null : <span className="home-band__count">{count}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * "Precisa de você": o que espera uma decisão, uma linha por item e cada uma com o link que leva direto à
 * missão. As aprovações pendentes vêm pelo título da aprovação; plano para aprovar, pergunta e revisão
 * vêm pelo título da missão, com a ação que falta. As mesmas missões que o contador "aguarda você" da barra
 * de status conta. Enquanto as aprovações carregam, mostra "Carregando…" em vez do vazio.
 */
function NeedsYou() {
  const { items, approvals, unreadApprovals, approvalsLoaded, loaded } = useOverview();
  const motion = useListMotion<HTMLUListElement>();

  const others = items.filter(
    ({ mission }) => needsAttention(mission.status) && mission.status !== 'waiting_approval',
  );
  // Missão que pede aprovação mas já não tem pendência (decidida há pouco): aparece como a missão.
  const approvalMissions = new Set([
    ...approvals.map((entry) => entry.missionId),
    ...unreadApprovals.map((entry) => entry.missionId),
  ]);
  const orphans = approvalsLoaded
    ? items.filter(
        ({ mission }) => mission.status === 'waiting_approval' && !approvalMissions.has(mission.id),
      )
    : [];
  const rows = approvals.length + unreadApprovals.length + others.length + orphans.length;
  const count = loaded && approvalsLoaded ? rows : undefined;

  return (
    <Band title={HOME_TEXT.needsYou} {...(count === undefined ? {} : { count })}>
      {rows > 0 ? (
        <ul ref={motion} className="needs-list">
          {approvals.map(({ projectId, missionId, missionTitle, approval }) => (
            <li key={approval.id} className="needs-list__item">
              <Link to={missionPath(projectId, missionId)}>{approval.title}</Link>
              <span className="needs-list__meta">{missionTitle}</span>
            </li>
          ))}
          {unreadApprovals.map(({ missionId, missionTitle }) => (
            <li key={`unread-${missionId}`} className="needs-list__item">
              {HOME_TEXT.needsYouUnread(missionTitle)}
            </li>
          ))}
          {[...others, ...orphans].map(({ projectId, mission }) => (
            <li key={mission.id} className="needs-list__item">
              <Link to={missionPath(projectId, mission.id)}>{mission.title}</Link>
              <span className="needs-list__meta">{requiredActionOf(mission.status)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!loaded || !approvalsLoaded ? <p className="home-band__note">{HOME_TEXT.loading}</p> : null}
      {loaded && approvalsLoaded && rows === 0 ? (
        <p className="home-band__note">{HOME_TEXT.needsYouEmpty}</p>
      ) : null}
    </Band>
  );
}

/**
 * Missões de todos os projetos, com progresso. O filtro por estado vem de `?estado=running|attention|failed`
 * (o mesmo dos contadores da barra de status): três chips o escolhem (o ativo, apertado de novo, o limpa) e
 * "Limpar filtro" aparece enquanto há filtro. Valor desconhecido vale como sem filtro.
 */
function Missions({
  filter,
  onFilter,
}: {
  filter: MissionStatusFilter | undefined;
  onFilter: (next: MissionStatusFilter | undefined) => void;
}) {
  const board = useMissionsBoard();
  const shown =
    filter === undefined
      ? board.items.length
      : board.items.filter((item) => matchesStatusFilter(item.mission.status, filter)).length;

  let body: ReactNode;
  if (board.status === 'error') {
    body = (
      <p className="home-band__note" role="alert">
        {HOME_TEXT.missionsError}
      </p>
    );
  } else if (board.status === 'loading') {
    body = <p className="home-band__note">{HOME_TEXT.loading}</p>;
  } else if (shown === 0) {
    body = (
      <p className="home-band__note">
        {filter === undefined ? HOME_TEXT.missionsEmpty : HOME_TEXT.missionsEmptyFiltered}
      </p>
    );
  } else {
    body = (
      <div className="home-band__scroll">
        <MissionProgressList items={board.items} {...(filter === undefined ? {} : { filter })} />
      </div>
    );
  }

  return (
    <Band title={HOME_TEXT.missions} {...(board.status === 'ready' ? { count: shown } : {})}>
      <div role="group" aria-label={HOME_TEXT.filterGroup} className="filter-chips">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className="filter-chip"
            aria-pressed={filter === option}
            onClick={() => onFilter(filter === option ? undefined : option)}
          >
            {HOME_TEXT.filterLabel[option]}
          </button>
        ))}
        {filter === undefined ? null : (
          <button
            type="button"
            className="filter-chip filter-chip--clear"
            onClick={() => onFilter(undefined)}
          >
            {HOME_TEXT.filterClear}
          </button>
        )}
      </div>
      {body}
    </Band>
  );
}

/**
 * Início, o painel de abertura, de cima para baixo: a faixa do topo (a saudação numa linha, sobre o fundo
 * topográfico, que não aparece em mais nenhum ponto do Início), "Precisa de você", Missões com
 * progresso (e o filtro `?estado=`), Atividade e Uso dos agentes. Os números vêm da carga compartilhada
 * da visão geral; nada é simulado. `?editar-nome=1` (o item "Alterar meu nome" da paleta) abre o campo do
 * nome na saudação, e o parâmetro sai quando o campo fecha.
 */
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const filter = parseStatusFilter(params.get(STATE_PARAM));
  const editRequested = params.get(EDIT_NAME_PARAM) === '1';

  function setFilter(next: MissionStatusFilter | undefined) {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        if (next === undefined) updated.delete(STATE_PARAM);
        else updated.set(STATE_PARAM, next);
        return updated;
      },
      { replace: true },
    );
  }

  function closeNameEditor() {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.delete(EDIT_NAME_PARAM);
        return updated;
      },
      { replace: true },
    );
  }

  return (
    <div className="home">
      <div className="home-hero">
        <TopographicBackground />
        <Greeting editRequested={editRequested} onEditClose={closeNameEditor} />
      </div>
      <div className="home-columns">
        <div className="home-main">
          <NeedsYou />
          <Missions filter={filter} onFilter={setFilter} />
        </div>
        <div className="home-side">
          <ActivityHeatmap />
          <AgentUsage />
        </div>
      </div>
    </div>
  );
}
