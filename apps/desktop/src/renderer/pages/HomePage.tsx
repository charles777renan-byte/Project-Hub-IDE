import { useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { MissionDto, TerminalSummary } from '@project-hub/contracts';
import { useAttention, type AttentionEntry } from '../attention';
import { EmptyState } from '../components/EmptyState';
import { FolderPlus } from '../components/Icon';
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
  textoDeBusca,
  type MissionStatusFilter,
} from '../mission-text';
import { ADD_PROJECT_REQUEST_EVENT, type AddProjectRequest } from '../projects-events';
import { EDIT_NAME_PARAM, missionPath, workspacePath } from '../routes';
import { useMissionsBoard } from '../use-missions-board';
import { useOverview } from '../use-overview';
import { useSidebarData } from '../use-sidebar-data';

/** Parâmetro do Início com o filtro por estado; os contadores da barra de status levam a ele. */
const STATE_PARAM = 'estado';

/** Faixa do Início: título pequeno, contagem em `--muted` ao lado e o corpo. A região leva o nome do título. */
function Band({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | string;
  children: ReactNode;
}) {
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
 * Uma sessão em espera: o link leva ao workspace do projeto e pede o terminal dela, do jeito que a lateral faz.
 * Usada em "Precisa de você" e na banda Missões sob `?estado=attention`.
 */
function SessionRow({ terminal }: { terminal: TerminalSummary }) {
  return (
    <li className="needs-list__item">
      <Link to={workspacePath(terminal.projectId)} state={{ showTerminal: terminal.id }}>
        {terminal.title}
      </Link>
      <span className="needs-list__meta">
        {`${terminal.projectName} · ${HOME_TEXT.sessionWaiting}`}
      </span>
    </li>
  );
}

/**
 * "Precisa de você": uma linha por entrada de `useAttention` (sessão em espera ou missão que espera), a mesma
 * regra do contador "aguarda você" da barra de status e da faixa da lateral. A sessão leva ao terminal dela; a
 * missão, à tela da missão. Uma missão em `waiting_approval` mostra o título da primeira aprovação pendente quando
 * a leitura dela deu certo, e o próprio título da missão quando não há leitura (ainda carregando ou perdida, e aí
 * a linha diz isso). O número do cabeçalho é a contagem da regra e vira traço enquanto ela não é conhecida. Enquanto
 * as aprovações carregam, mostra "Carregando…" em vez do vazio.
 */
function NeedsYou() {
  const attention = useAttention();
  const { approvals, unreadApprovals, approvalsLoaded } = useOverview();
  const motion = useListMotion<HTMLUListElement>();
  const rows = attention.entries.length;

  return (
    <Band title={HOME_TEXT.needsYou} count={attention.known ? attention.count : '—'}>
      {rows > 0 ? (
        <ul ref={motion} className="needs-list">
          {attention.entries.map((entry) => {
            if (entry.kind === 'session') {
              return <SessionRow key={entry.key} terminal={entry.terminal} />;
            }
            const { mission, projectId } = entry;
            const waitingApproval = mission.status === 'waiting_approval';
            const pending = waitingApproval
              ? approvals.find((item) => item.missionId === mission.id)
              : undefined;
            const unread =
              waitingApproval && unreadApprovals.some((item) => item.missionId === mission.id);
            const meta =
              pending !== undefined
                ? mission.title
                : unread
                  ? HOME_TEXT.needsYouUnread(mission.title)
                  : requiredActionOf(mission.status);
            return (
              <li key={entry.key} className="needs-list__item">
                <Link to={missionPath(projectId, mission.id)}>
                  {pending?.approval.title ?? mission.title}
                </Link>
                <span className="needs-list__meta">{meta}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {!attention.known || !approvalsLoaded ? (
        <p className="home-band__note">{HOME_TEXT.loading}</p>
      ) : null}
      {attention.known && approvalsLoaded && rows === 0 ? (
        <p className="home-band__note">{HOME_TEXT.needsYouEmpty}</p>
      ) : null}
    </Band>
  );
}

/**
 * As missões que "Precisa de você" já mostra: a da própria linha de missão e a que uma sessão em espera
 * representa (`terminal.missionId`), esta só quando a missão também espera a pessoa. Uma missão em execução que
 * tem uma sessão sua em espera continua na banda Missões: a sessão aparece em "Precisa de você", a missão não.
 * Tudo vem de `attentionEntries`, sem regra nova.
 */
function missionsListedInNeedsYou(
  entries: readonly AttentionEntry[],
  missions: readonly { mission: MissionDto }[],
): Set<string> {
  const listed = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'mission' ? [entry.mission.id] : (entry.terminal.missionId ?? []),
    ),
  );
  const waiting = new Set(
    missions
      .filter(({ mission }) => needsAttention(mission.status))
      .map(({ mission }) => mission.id),
  );
  return new Set([...listed].filter((id) => waiting.has(id)));
}

/**
 * Missões de todos os projetos, com progresso. O filtro por estado vem de `?estado=running|attention|failed`
 * (o mesmo dos contadores da barra de status): três chips o escolhem (o ativo, apertado de novo, o limpa) e
 * "Limpar filtro" aparece enquanto há filtro. Valor desconhecido vale como sem filtro.
 *
 * Sem filtro, cada missão aparece uma vez: as que "Precisa de você" já lista saem desta banda. Sob `attention`,
 * a lista é a mesma do contador "aguarda você": as sessões em espera primeiro, depois as missões que esperam
 * (sem as que uma sessão em espera já representa). Com `running` ou `failed`, a lista é o filtro inteiro. O número
 * da banda é o do que está listado, e só aparece quando a contagem já é conhecida.
 */
function Missions({
  filter,
  onFilter,
}: {
  filter: MissionStatusFilter | undefined;
  onFilter: (next: MissionStatusFilter | undefined) => void;
}) {
  const board = useMissionsBoard();
  const attention = useAttention();
  const [query, setQuery] = useState('');
  const needle = textoDeBusca(query.trim());
  const attentionView = filter === 'attention';
  // Sem filtro e sob `attention`, a lista depende da leitura de atenção; com `running` ou `failed`, não.
  const readsAttention = filter === undefined || attentionView;
  const sessions = attentionView
    ? attention.entries.flatMap((entry) => (entry.kind === 'session' ? [entry.terminal] : []))
    : [];
  const waitingIds = new Set(
    attention.entries.flatMap((entry) => (entry.kind === 'mission' ? [entry.mission.id] : [])),
  );
  const listedInNeeds = missionsListedInNeedsYou(attention.entries, board.items);
  const missionItems = attentionView
    ? board.items.filter((item) => waitingIds.has(item.mission.id))
    : filter === undefined
      ? board.items.filter((item) => !listedInNeeds.has(item.mission.id))
      : board.items.filter((item) => matchesStatusFilter(item.mission.status, filter));
  // A busca é local: procura no título e no nome do projeto, sem acento e sem maiúsculas.
  const searchedItems =
    needle === ''
      ? missionItems
      : missionItems.filter((item) =>
          textoDeBusca(`${item.mission.title} ${item.projectName}`).includes(needle),
        );
  const shown = sessions.length + searchedItems.length;
  const loading = board.status === 'loading' || (readsAttention && !attention.known);

  let emptyText: string = HOME_TEXT.missionsEmpty;
  if (needle !== '') emptyText = HOME_TEXT.missionsEmptySearch;
  else if (filter !== undefined) emptyText = HOME_TEXT.missionsEmptyFiltered;
  else if (board.items.length > 0) emptyText = HOME_TEXT.allInNeeds;

  let body: ReactNode;
  if (board.status === 'error') {
    body = (
      <p className="home-band__note" role="alert">
        {HOME_TEXT.missionsError}
      </p>
    );
  } else if (loading) {
    body = <p className="home-band__note">{HOME_TEXT.loading}</p>;
  } else if (shown === 0) {
    body = <p className="home-band__note">{emptyText}</p>;
  } else {
    body = (
      <div className="home-band__scroll">
        {sessions.length === 0 ? null : (
          <ul className="needs-list">
            {sessions.map((terminal) => (
              <SessionRow key={terminal.id} terminal={terminal} />
            ))}
          </ul>
        )}
        <MissionProgressList items={searchedItems} showProject />
      </div>
    );
  }

  const countShown = board.status === 'ready' && (!readsAttention || attention.known);

  return (
    <Band title={HOME_TEXT.missions} {...(countShown ? { count: shown } : {})}>
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
      <input
        type="search"
        className="missions-search"
        aria-label={HOME_TEXT.searchMissions}
        placeholder={HOME_TEXT.searchMissions}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {body}
    </Band>
  );
}

/**
 * Primeiro uso, sem nenhum projeto (carga pronta e lista vazia): o estado vazio com os dois passos e o botão
 * "Adicionar projeto", no lugar das faixas. O botão pede o cadastro pelo mesmo evento da barra lateral, com
 * `irParaMissoes`: depois de cadastrar, a visão Missões do projeto abre. Só este pedido leva para lá; o botão da
 * lateral, a paleta e o menu "+" ficam onde estão.
 */
function FirstSteps() {
  function requestAdd() {
    const detail: AddProjectRequest = { irParaMissoes: true };
    window.dispatchEvent(new CustomEvent(ADD_PROJECT_REQUEST_EVENT, { detail }));
  }

  return (
    <EmptyState
      className="home-empty"
      icon={FolderPlus}
      title={HOME_TEXT.firstStepsTitle}
      hint={
        <span className="home-empty__steps">
          {HOME_TEXT.firstSteps.map((step) => (
            <span key={step} className="home-empty__step">
              {step}
            </span>
          ))}
        </span>
      }
      action={
        <button type="button" className="btn-primary" onClick={requestAdd}>
          {HOME_TEXT.addProject}
        </button>
      }
    />
  );
}

/**
 * Início, o painel de abertura, de cima para baixo: a faixa do topo (a saudação numa linha, sobre o fundo
 * topográfico, que não aparece em mais nenhum ponto do Início), "Precisa de você", Missões com
 * progresso (e o filtro `?estado=`), Atividade e Uso dos agentes. Os números vêm da carga compartilhada
 * da visão geral; nada é simulado. Sem nenhum projeto, o estado vazio (`FirstSteps`) toma o lugar de "Precisa de você",
 * Missões e Atividade; o Uso dos agentes segue, porque não é uma faixa vazia.
 * `?editar-nome=1` (o item "Alterar meu nome" da paleta) abre o campo do nome na saudação, e o parâmetro sai
 * quando o campo fecha.
 */
export function HomePage() {
  const [params, setParams] = useSearchParams();
  const filter = parseStatusFilter(params.get(STATE_PARAM));
  const editRequested = params.get(EDIT_NAME_PARAM) === '1';
  const sidebar = useSidebarData();
  const semProjetos = sidebar.status === 'ready' && sidebar.projects.length === 0;

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
          {semProjetos ? (
            <FirstSteps />
          ) : (
            <>
              <NeedsYou />
              <Missions filter={filter} onFilter={setFilter} />
            </>
          )}
        </div>
        <div className="home-side">
          {semProjetos ? null : <ActivityHeatmap />}
          <AgentUsage />
        </div>
      </div>
    </div>
  );
}
