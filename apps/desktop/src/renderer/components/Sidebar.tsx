import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import type { LayoutNode, ProjectSummary, TerminalSummary } from '@project-hub/contracts';
import { attentionEntries } from '../attention';
import { useListMotion } from '../list-motion';
import { formatTime, statusIcon, statusLabel } from '../mission-text';
import { notify } from '../notify';
import { colorOf } from '../project-color';
import { missionPath, ROUTE_PATHS, workspacePath } from '../routes';
import { barLevels, hasActivity, isIdle, useActivity } from '../sidebar-activity';
import { useTerminals } from '../terminals-data';
import { useProjectActions, type ProjectActions } from '../use-project-actions';
import { useSidebarData, type SidebarData } from '../use-sidebar-data';
import { ArchivedProjects } from './ArchivedProjects';
import { ChevronRight, Clock, ICON_PROPS, Plus, Search } from './Icon';
import { ProviderIcon } from './ProviderIcon';
import { StatusChip } from './StatusChip';

/** Quantos agentes de um projeto aparecem como ícones ao lado do nome, antes do "+N". */
const AVATAR_LIMIT = 3;

const VIEW_KEY = 'project-hub:sidebar-view';
const NO_GROUP = 'Sem grupo';

type View = 'list' | 'grid';

/** O que a pessoa pediu para mostrar no workspace; o workspace lê isto em `location.state`. */
type ShowTerminal = (projectId: string, terminalId: string) => void;

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function saveView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Sem armazenamento, a escolha vale só até fechar a janela.
  }
}

/**
 * Barra lateral, o explorador da janela: a busca, o aviso do que espera a pessoa e o botão Adicionar projeto
 * no topo; os espaços (os projetos, em lista com os agentes em cartões, ou em grade; agrupados quando a
 * pessoa criou grupos); e, no fim, os projetos arquivados, numa seção recolhível com Restaurar. Início e a
 * lista de projetos não têm mais página: Início é a aba fixa da barra superior. Ocupa toda a coluna que a
 * recebe, e a lista de espaços rola sozinha. `onSearch` abre a paleta de comandos; sem ele, a busca não
 * aparece.
 */
export function Sidebar({ onSearch }: { onSearch?: () => void }) {
  const navigate = useNavigate();
  const workspaceMatch = useMatch(ROUTE_PATHS.workspace);
  const data = useSidebarData();
  const projectActions = useProjectActions();
  const addButton = useRef<HTMLButtonElement>(null);
  const archivedToggle = useRef<HTMLButtonElement>(null);
  const { terminals, error: terminalsError, reload } = useTerminals();
  const activity = useActivity(terminals);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [view, setView] = useState<View>(readView);
  const ids = useId();

  const showTerminal: ShowTerminal = (targetProjectId, terminalId) => {
    navigate(workspacePath(targetProjectId), { state: { showTerminal: terminalId } });
  };
  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const changeView = (next: View) => {
    setView(next);
    saveView(next);
  };
  // O botão Restaurar some com o projeto: o foco vai para a seção Arquivados, se ainda restar algum, e senão
  // para Adicionar projeto, em vez de cair no corpo da página.
  const restore = async (projectId: string) => {
    const remaining = projectActions.archived.length - 1;
    if (!(await projectActions.restoreProject(projectId))) return;
    (remaining > 0 ? archivedToggle : addButton).current?.focus();
  };

  return (
    <aside aria-label="Projetos e missões" className="sidebar">
      <TopoLines />
      {onSearch === undefined ? null : <SearchButton onSearch={onSearch} />}
      <AttentionStrip
        data={data}
        terminals={terminals}
        onShowTerminal={showTerminal}
        onShowMission={(targetProjectId, missionId) =>
          navigate(missionPath(targetProjectId, missionId))
        }
      />

      <AddProject actions={projectActions} buttonRef={addButton} />

      <section aria-labelledby={`${ids}-espacos`} className="sidebar__section sidebar__spaces">
        <div className="sidebar__label">
          <p id={`${ids}-espacos`} className="sidebar__title">
            Espaços
          </p>
          <ViewToggle view={view} onChange={changeView} />
        </div>
        <div className="sidebar__scroll">
          {terminalsError === null ? null : (
            <p role="status" className="muted">
              Não foi possível ler as sessões.
            </p>
          )}
          <Spaces
            data={data}
            terminals={terminals}
            activity={activity}
            view={view}
            currentId={workspaceMatch?.params.projectId}
            expanded={expanded}
            onToggle={toggle}
            onShowTerminal={showTerminal}
            onReload={reload}
            idPrefix={ids}
          />
        </div>
      </section>

      <ArchivedProjects
        projects={projectActions.archived}
        onRestore={(projectId) => void restore(projectId)}
        toggleRef={archivedToggle}
      />
    </aside>
  );
}

/** Linhas de relevo, só decoração, no canto de cima da barra. */
function TopoLines() {
  return (
    <div className="sidebar__topo" aria-hidden="true">
      <svg viewBox="0 0 260 200" fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M10 120C40 60 100 40 150 70s60 50 100 20" opacity=".55" />
        <path d="M20 140C55 85 105 68 150 94s58 44 96 18" opacity=".45" />
        <path d="M32 160C64 112 108 96 150 118s55 38 92 16" opacity=".35" />
        <path d="M46 180C74 140 112 126 150 142s50 32 86 14" opacity=".25" />
      </svg>
    </div>
  );
}

/** Busca no topo da barra: abre a paleta de comandos (Ctrl+K). O atalho aparece como texto, não só como ícone. */
function SearchButton({ onSearch }: { onSearch: () => void }) {
  return (
    <button
      type="button"
      className="sidebar__search"
      onClick={onSearch}
      aria-keyshortcuts="Control+K"
    >
      <Search {...ICON_PROPS} />
      <span>Buscar projeto ou agente</span>
      <kbd aria-hidden="true">Ctrl K</kbd>
    </button>
  );
}

/** O botão Adicionar projeto, com a mensagem de erro da última ação de projeto logo abaixo. */
function AddProject({
  actions,
  buttonRef,
}: {
  actions: ProjectActions;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="sidebar__add">
      <button
        ref={buttonRef}
        type="button"
        className="sidebar__action"
        disabled={actions.adding}
        onClick={() => void actions.addProject()}
      >
        <Plus {...ICON_PROPS} />
        Adicionar projeto
      </button>
      {actions.error === null ? null : (
        <p role="alert" className="page-alert">
          {actions.error}
        </p>
      )}
    </div>
  );
}

/** Troca entre a lista e a grade dos espaços. A escolha fica guardada neste computador. */
function ViewToggle({ view, onChange }: { view: View; onChange: (next: View) => void }) {
  return (
    <div role="group" aria-label="Modo de exibição" className="sidebar__seg">
      <button type="button" aria-pressed={view === 'list'} onClick={() => onChange('list')}>
        Lista
      </button>
      <button type="button" aria-pressed={view === 'grid'} onClick={() => onChange('grid')}>
        Grade
      </button>
    </div>
  );
}

type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  icon: ReactNode;
  go: () => void;
};

/**
 * Aviso do que espera a pessoa: sessões em espera e missões que pedem decisão (plano, aprovação, resposta,
 * revisão). O primeiro aparece com o botão Ir, e o total vai ao lado do rótulo. Sem nada esperando, a seção nem
 * existe. Pede ação, por isso fica logo no topo. A região de anúncio para leitor de tela fica sempre montada:
 * uma região que nasce com o conteúdo não é anunciada.
 */
function AttentionStrip({
  data,
  terminals,
  onShowTerminal,
  onShowMission,
}: {
  data: SidebarData;
  terminals: readonly TerminalSummary[];
  onShowTerminal: ShowTerminal;
  onShowMission: (projectId: string, missionId: string) => void;
}) {
  // A regra do que espera a pessoa é a de `attention.ts`, a mesma do contador da barra de status.
  const missions =
    data.status === 'ready'
      ? data.projects.flatMap((project) =>
          (data.missionsByProject[project.id] ?? []).map((mission) => ({
            projectId: project.id,
            mission,
          })),
        )
      : [];
  const projectName = (projectId: string) =>
    data.projects.find((project) => project.id === projectId)?.name ?? '';
  const items: AttentionItem[] = attentionEntries(terminals, missions).map((entry) => {
    if (entry.kind === 'session') {
      const { terminal } = entry;
      return {
        key: entry.key,
        title: terminal.title,
        detail: terminal.projectName,
        icon: <ProviderIcon provider={terminal.provider} size={14} />,
        go: () => onShowTerminal(terminal.projectId, terminal.id),
      };
    }
    const { mission } = entry;
    const Glyph = statusIcon(mission.status) ?? Clock;
    return {
      key: entry.key,
      title: mission.title,
      detail: `${projectName(entry.projectId)} · ${statusLabel(mission.status)}`,
      icon: <Glyph {...ICON_PROPS} size={14} />,
      go: () => onShowMission(entry.projectId, mission.id),
    };
  });
  const first = items[0];
  const announcement = (
    <p aria-live="polite" className="sidebar__sr">
      {first === undefined ? '' : `Precisa de você: ${items.length}. Primeiro: ${first.title}.`}
    </p>
  );
  if (first === undefined) return announcement;
  return (
    <>
      {announcement}
      <section aria-label="Precisa de você" className="sidebar__attention state-attention">
        <p className="sidebar__attention-tag state-attention-tag">
          Precisa de você · {items.length}
        </p>
        <span className="sidebar__attention-ico" aria-hidden="true">
          {first.icon}
        </span>
        <span className="sidebar__attention-text">
          <b title={first.title}>{first.title}</b>
          <small>{first.detail}</small>
        </span>
        <button
          type="button"
          className="sidebar__attention-go state-attention-go"
          aria-label={`Ir para ${first.title}`}
          onClick={first.go}
        >
          Ir
        </button>
      </section>
    </>
  );
}

function groupByProject(terminals: readonly TerminalSummary[]): Map<string, TerminalSummary[]> {
  const groups = new Map<string, TerminalSummary[]>();
  for (const terminal of terminals) {
    groups.set(terminal.projectId, [...(groups.get(terminal.projectId) ?? []), terminal]);
  }
  return groups;
}

/**
 * Ícones dos agentes de um projeto, fechado: um por sessão, até `AVATAR_LIMIT`, cada um com o anel do estado
 * dele, e "+N" com o resto. Sem sessão, "vazio". Decorativo: o nome do projeto e a lista aberta dizem tudo
 * para quem lê tela.
 */
function Avatars({ sessions }: { sessions: readonly TerminalSummary[] }) {
  if (sessions.length === 0) return <span className="sidebar__vazio">vazio</span>;
  const shown = sessions.slice(0, AVATAR_LIMIT);
  const extra = sessions.length - shown.length;
  return (
    <span className="sidebar__avatars" aria-hidden="true">
      {shown.map((session) => (
        <span
          key={session.id}
          data-state={session.state}
          className={`sidebar__avatar state-ring state-ring--${session.state}`}
        >
          <ProviderIcon provider={session.provider} size={12} />
        </span>
      ))}
      {extra > 0 ? <span className="sidebar__avatar-more">+{extra}</span> : null}
    </span>
  );
}

/** Um `<ul>` cujos itens se movem ao entrar, sair e trocar de lugar (`useListMotion`). */
function MotionList({
  id,
  className,
  children,
}: {
  id?: string;
  className: string;
  children: ReactNode;
}) {
  const motion = useListMotion<HTMLUListElement>();
  return (
    <ul ref={motion} id={id} className={className}>
      {children}
    </ul>
  );
}

type SpacesProps = {
  data: SidebarData;
  terminals: readonly TerminalSummary[];
  activity: ReadonlyMap<string, readonly number[]>;
  view: View;
  currentId?: string | undefined;
  expanded: ReadonlySet<string>;
  onToggle: (projectId: string) => void;
  onShowTerminal: ShowTerminal;
  onReload: () => Promise<void>;
  idPrefix: string;
};

/**
 * Os projetos, em lista ou em grade. Com algum projeto num grupo, a lista ganha um cabeçalho por grupo (com a
 * cor, o nome e quantos há), em ordem alfabética, e os sem grupo vêm por último. Sem grupos, a lista é uma só.
 */
function Spaces(props: SpacesProps) {
  const { data, view, terminals } = props;
  if (data.status === 'loading') return <p className="muted">Carregando…</p>;
  if (data.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {data.message}
      </p>
    );
  }
  if (data.projects.length === 0) return <p className="muted">Nenhum projeto ainda.</p>;

  const sessionsByProject = groupByProject(terminals);
  const hasGroups = data.projects.some((project) => project.group !== undefined);
  const buckets = new Map<string, ProjectSummary[]>();
  for (const project of data.projects) {
    const name = project.group ?? NO_GROUP;
    buckets.set(name, [...(buckets.get(name) ?? []), project]);
  }
  const names = [...buckets.keys()].sort((a, b) =>
    a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b, 'pt-BR'),
  );

  const renderProjects = (projects: readonly ProjectSummary[]) =>
    view === 'grid' ? (
      <MotionList className="sidebar__grid">
        {projects.map((project) => (
          <ProjectTile
            key={project.id}
            project={project}
            sessions={sessionsByProject.get(project.id) ?? []}
            isCurrent={project.id === props.currentId}
          />
        ))}
      </MotionList>
    ) : (
      <MotionList className="sidebar__list">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            sessions={sessionsByProject.get(project.id) ?? []}
            activity={props.activity}
            isCurrent={project.id === props.currentId}
            isOpen={props.expanded.has(project.id)}
            onToggle={() => props.onToggle(project.id)}
            onShowTerminal={props.onShowTerminal}
            onReload={props.onReload}
            listId={`${props.idPrefix}-sessoes-${project.id}`}
          />
        ))}
      </MotionList>
    );

  if (!hasGroups) return renderProjects(data.projects);
  return (
    <>
      {names.map((name) => {
        const projects = buckets.get(name) ?? [];
        return (
          <section key={name} aria-label={`Grupo ${name}`} className="sidebar__group">
            <p className="sidebar__ghead">
              <i
                aria-hidden="true"
                className={`group-bar group-bar--${name === NO_GROUP ? 'muted' : colorOf(name)}`}
              />
              {name}
              <span>{projects.length}</span>
            </p>
            {renderProjects(projects)}
          </section>
        );
      })}
    </>
  );
}

/** A marca de cor do projeto, na lista e na grade. Decorativa. */
function Swatch({ project }: { project: ProjectSummary }) {
  return <span aria-hidden="true" className={`swatch swatch--${colorOf(project.id)}`} />;
}

/** O projeto na grade: um bloco com a cor, o nome, o aviso de pasta indisponível e os agentes. Leva ao workspace. */
function ProjectTile({
  project,
  sessions,
  isCurrent,
}: {
  project: ProjectSummary;
  sessions: readonly TerminalSummary[];
  isCurrent: boolean;
}) {
  return (
    <li className="sidebar__tile">
      <Link
        to={workspacePath(project.id)}
        className="sidebar__link"
        aria-current={isCurrent ? 'page' : undefined}
      >
        <Swatch project={project} />
        <span className="sidebar__name" title={project.name}>
          {project.name}
        </span>
        {project.available ? null : <StatusChip label="pasta indisponível" tone="warn" />}
        <Avatars sessions={sessions} />
      </Link>
    </li>
  );
}

/**
 * Linha de um projeto na lista: o botão que expande os cartões, a cor, o nome (um link para o workspace), os
 * ícones dos agentes e os chips "sem Git" e "pasta indisponível", quando valem. Só o projeto da rota do workspace leva
 * `aria-current`. Nomes entram como texto.
 */
function ProjectRow({
  project,
  sessions,
  activity,
  isCurrent,
  isOpen,
  onToggle,
  onShowTerminal,
  onReload,
  listId,
}: {
  project: ProjectSummary;
  sessions: readonly TerminalSummary[];
  activity: ReadonlyMap<string, readonly number[]>;
  isCurrent: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onShowTerminal: ShowTerminal;
  onReload: () => Promise<void>;
  listId: string;
}) {
  const details = sessionDetails(sessions, project);
  return (
    <li className={isOpen ? 'sidebar__item sidebar__item--open' : 'sidebar__item'}>
      <div className="sidebar__row">
        <button
          type="button"
          className="sidebar__toggle"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-label={`Sessões de ${project.name}`}
          onClick={onToggle}
        >
          <span aria-hidden="true" className="sidebar__chevron">
            <ChevronRight {...ICON_PROPS} />
          </span>
        </button>
        <Link
          to={workspacePath(project.id)}
          className="sidebar__link"
          aria-current={isCurrent ? 'page' : undefined}
        >
          <Swatch project={project} />
          <span className="sidebar__name" title={project.name}>
            {project.nickname ?? project.name}
          </span>
        </Link>
        <Avatars sessions={sessions} />
        {project.repositoryKind === 'git' ? null : <StatusChip label="sem Git" tone="muted" />}
        {project.available ? null : <StatusChip label="pasta indisponível" tone="warn" />}
      </div>
      {isOpen ? (
        <MotionList id={listId} className="sidebar__sessions">
          {sessions.length === 0 ? (
            <li className="sidebar__empty">Nenhuma sessão aberta.</li>
          ) : (
            sessions.map((session, index) => (
              <SessionCard
                key={session.id}
                session={session}
                detail={details[index] ?? ''}
                levels={
                  session.outputBytes === undefined || !hasActivity(activity.get(session.id))
                    ? undefined
                    : barLevels(activity.get(session.id))
                }
                idle={isIdle(activity.get(session.id))}
                onShowTerminal={() => onShowTerminal(project.id, session.id)}
                onEnd={() => void endSession(project.id, session.id, onReload)}
              />
            ))
          )}
        </MotionList>
      ) : null}
    </li>
  );
}

/** A folha do layout que mostra o terminal, ou `undefined`. */
function findLeaf(node: LayoutNode | null, terminalId: string): { id: string } | undefined {
  if (node === null) return undefined;
  if (node.type === 'leaf') return node.terminalId === terminalId ? { id: node.id } : undefined;
  return findLeaf(node.first, terminalId) ?? findLeaf(node.second, terminalId);
}

/**
 * Encerra uma sessão pelo cartão, sem confirmar: acha o painel dela no workspace do projeto e o remove, como o
 * botão de fechar do painel (que encerra a sessão dele). A lista de terminais é lida de novo no fim. A sessão de
 * missão não passa por aqui.
 */
async function endSession(
  projectId: string,
  terminalId: string,
  onReload: () => Promise<void>,
): Promise<void> {
  try {
    const list = await window.projectHub.workspaces.list();
    if (!list.ok) {
      notify.error(list.error.message);
      return;
    }
    const workspace = list.data.find((candidate) => candidate.projectId === projectId);
    const leaf = workspace === undefined ? undefined : findLeaf(workspace.layout, terminalId);
    if (workspace === undefined || leaf === undefined) {
      notify.error('Não achei o painel desta sessão.');
      return;
    }
    const removed = await window.projectHub.workspaces.removePane(workspace.id, leaf.id);
    if (!removed.ok) notify.error(removed.error.message);
  } catch {
    notify.error('Não foi possível encerrar a sessão.');
  }
  await onReload();
}

/**
 * O detalhe de cada sessão do projeto, na ordem da lista, calculado numa passada só. Quando o mesmo título se
 * repete no projeto, o número da posição entra junto, para os cartões não serem iguais.
 */
function sessionDetails(sessions: readonly TerminalSummary[], project: ProjectSummary): string[] {
  const titles = new Map<string, number>();
  for (const session of sessions) titles.set(session.title, (titles.get(session.title) ?? 0) + 1);
  const seen = new Map<string, number>();
  return sessions.map((session) => {
    const base = baseDetail(session, project);
    if ((titles.get(session.title) ?? 0) < 2) return base;
    const position = (seen.get(session.title) ?? 0) + 1;
    seen.set(session.title, position);
    return `${base} · ${position}`;
  });
}

/**
 * O detalhe de uma sessão sem contar repetição: onde ela está e, quando há alteração, quantos arquivos mudaram.
 */
function baseDetail(session: TerminalSummary, project: ProjectSummary): string {
  const where = placeDetail(session, project);
  const changes = changesDetail(session.changedFiles);
  return changes === undefined ? where : `${where} · ${changes}`;
}

/**
 * Onde a sessão está: a missão com a pasta do worktree, "recuperada" ou o projeto com a branch padrão (sem Git,
 * só o projeto).
 */
function placeDetail(session: TerminalSummary, project: ProjectSummary): string {
  if (session.worktreeName !== undefined) return `missão · ${session.worktreeName}`;
  if (session.kind === 'agent') return 'missão';
  const where =
    project.defaultBranch === undefined
      ? project.name
      : `${project.name} · ${project.defaultBranch}`;
  return session.origin === 'recovered' ? `recuperada · ${where}` : where;
}

/** "1 arquivo alterado" ou "N arquivos alterados". Sem alteração, ou sem contagem, não há o que mostrar. */
function changesDetail(count: number | undefined): string | undefined {
  if (count === undefined || count === 0) return undefined;
  return count === 1 ? '1 arquivo alterado' : `${count} arquivos alterados`;
}

/**
 * Cartão de uma sessão aberta: trilho colorido pelo estado, o ícone do programa, o título e o detalhe, e à
 * direita a hora e o gráfico de atividade. Clicar leva ao workspace do projeto, pedindo para mostrar esse
 * terminal. Abrir e Encerrar ficam numa coluna ao lado do cartão, e não por cima dele: aparecem com o mouse ou o
 * foco na linha, que então cede essa largura (a hora e o gráfico somem enquanto isso). Encerrar não pede
 * confirmação. Numa sessão já encerrada o processo acabou, então o botão segue como Fechar, que só tira o painel.
 * A sessão de missão não tem o botão.
 */
function SessionCard({
  session,
  detail,
  levels,
  idle = false,
  onShowTerminal,
  onEnd,
}: {
  session: TerminalSummary;
  detail: string;
  levels: readonly number[] | undefined;
  /** Viva e parada há algumas leituras: "ociosa", com o trilho cinza e parado. */
  idle?: boolean;
  onShowTerminal: () => void;
  onEnd: () => void;
}) {
  const time = session.startedAt === undefined ? null : formatTime(session.startedAt);
  const stateText =
    session.state === 'waiting'
      ? 'aguardando você'
      : session.state === 'running'
        ? idle
          ? 'ociosa'
          : 'rodando'
        : 'encerrada';
  // Sessão em execução: Encerrar mata o processo. Sessão já encerrada: o botão só tira o painel, e segue Fechar.
  const endLabel = session.state === 'exited' ? 'Fechar' : 'Encerrar';
  return (
    <li className="sidebar__session">
      <button
        type="button"
        className={`sidebar__card sidebar__card--${session.state} state-rail state-rail--${session.state === 'running' && idle ? 'idle' : session.state}`}
        onClick={onShowTerminal}
      >
        <span className="sidebar__card-ico" aria-hidden="true">
          <ProviderIcon provider={session.provider} size={14} />
        </span>
        <span className="sidebar__card-text">
          <span className="sidebar__name" title={session.title}>
            {session.title}
          </span>
          <small>{detail}</small>
        </span>
        <span className="sidebar__card-side">
          <span className="state-mark__sr">{stateText}</span>
          {session.state === 'waiting' ? (
            <span className="state-label" aria-hidden="true">
              {stateText}
            </span>
          ) : null}
          {time === null ? null : <time dateTime={session.startedAt}>{time}</time>}
          {levels === undefined ? null : (
            <span className={`activity activity--${session.state}`} aria-hidden="true">
              {levels.map((level, index) => (
                <i key={index} className={`activity__bar activity__bar--${level}`} />
              ))}
            </span>
          )}
        </span>
      </button>
      <span className="sidebar__card-actions">
        <button type="button" aria-label={`Abrir ${session.title}`} onClick={onShowTerminal}>
          Abrir
        </button>
        {session.missionId === undefined ? (
          <button
            type="button"
            className="sidebar__card-end"
            aria-label={`${endLabel} ${session.title}`}
            onClick={onEnd}
          >
            {endLabel}
          </button>
        ) : null}
      </span>
    </li>
  );
}
