import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { AppResult, MissionDto, ProjectSummary } from '@project-hub/contracts';
import { MenuAcoes } from '../components/MenuAcoes';
import { MissionCard } from '../components/MissionCard';
import { MissionForm, type MissionFormValues } from '../components/MissionForm';
import { ProjectFolder } from '../components/ProjectFolder';
import { StatusChip } from '../components/StatusChip';
import { Tabs, type TabItem } from '../components/Tabs';
import { WorktreesTab } from '../components/WorktreesTab';
import {
  formatTime,
  needsAttention,
  requiredActionOf,
  situationOf,
  statusIcon,
  statusLabel,
  statusTone,
} from '../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../projects-events';
import { missionPath, ROUTE_PATHS } from '../routes';

type ProjectTab = 'overview' | 'missions' | 'repository' | 'worktrees' | 'settings';

/** Abas do projeto (seção 10.5). Configurações ainda não tem conteúdo. A aba Missões mostra quantas há. */
function tabsOf(missionCount: number): readonly TabItem<ProjectTab>[] {
  return [
    { id: 'overview', label: 'Visão geral' },
    {
      id: 'missions',
      label: 'Missões',
      ...(missionCount === 0
        ? {}
        : {
            count: {
              value: String(missionCount),
              label: missionCount === 1 ? '1 missão' : `${missionCount} missões`,
            },
          }),
    },
    { id: 'repository', label: 'Repositório' },
    { id: 'worktrees', label: 'Worktrees' },
    { id: 'settings', label: 'Configurações' },
  ];
}

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; project: ProjectSummary; missions: MissionDto[]; groups: string[] }
  | { status: 'error'; message: string };

/**
 * Detalhe de um projeto (seção 10.5, R167): nome, pasta e branch no cabeçalho, e a aba Missões com
 * os cartões e a criação. A criação deixa a missão em rascunho (o plano só nasce no Orquestrar, que usa a
 * cota do Claude); com "Só criar, sem abrir", a página fica na lista, e sem a opção abre o workspace.
 */
export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ProjectTab>('missions');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const location = useLocation();

  const load = useCallback(async () => {
    try {
      const projects = await window.projectHub.projects.list();
      if (!projects.ok) {
        setState({ status: 'error', message: projects.error.message });
        return;
      }
      const project = projects.data.find((candidate) => candidate.id === projectId);
      if (project === undefined) {
        setState({ status: 'error', message: 'O projeto não foi encontrado.' });
        return;
      }
      const missions = await window.projectHub.missions.list(projectId);
      setState(
        missions.ok
          ? {
              status: 'ready',
              project,
              missions: missions.data,
              groups: [...new Set(projects.data.flatMap((item) => item.group ?? []))].sort((a, b) =>
                a.localeCompare(b, 'pt-BR'),
              ),
            }
          : { status: 'error', message: missions.error.message },
      );
    } catch {
      setState({ status: 'error', message: GENERIC_ERROR });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A paleta (Nova missão em ...) chega aqui pedindo o formulário aberto (`state.newMission`).
  useEffect(() => {
    const requested = (location.state as { newMission?: boolean } | null)?.newMission === true;
    if (!requested) return;
    setTab('missions');
    setCreating(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  // A lista mostra a situação de cada missão: qualquer evento de missão pede a lista de novo.
  useEffect(() => window.projectHub.missions.subscribe(() => void load()), [load]);

  /**
   * Cria a missão em rascunho e segue para o workspace, onde a pessoa clica em Orquestrar. O plano usa a
   * cota do Claude, então nunca é gerado aqui. Com "Só criar, sem abrir", a página fica na lista.
   */
  async function createMission(values: MissionFormValues) {
    setActionError(null);
    setNotice(null);
    try {
      const created = await window.projectHub.missions.create({
        projectId,
        title: values.title,
        objective: values.objective,
        acceptanceCriteria: values.acceptanceCriteria,
        altersCode: values.altersCode,
      });
      if (!created.ok) {
        setActionError(created.error.message);
        return;
      }
      setCreating(false);
      if (values.planOnly) {
        setNotice('Missão criada. Abra a missão e clique em Orquestrar para gerar o plano.');
        await load();
        return;
      }
      navigate(missionPath(projectId, created.data.id));
    } catch {
      setActionError(GENERIC_ERROR);
    }
  }

  /**
   * Arquiva ou remove o projeto e volta para a lista. Só sai da página quando a ação dá certo: falha
   * fica na tela, e o projeto segue como estava.
   */
  async function leaveList(action: () => Promise<AppResult<unknown>>) {
    setLeaving(true);
    setLifecycleError(null);
    let ok = false;
    try {
      const result = await action();
      if (result.ok) ok = true;
      else setLifecycleError(result.error.message);
    } catch {
      setLifecycleError(GENERIC_ERROR);
    }
    if (!ok) {
      setLeaving(false);
      return;
    }
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    navigate(ROUTE_PATHS.home);
  }

  if (state.status === 'loading') {
    return <p role="status">Carregando projeto…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {state.message}
      </p>
    );
  }

  const { project, missions, groups } = state;

  /**
   * Grava um campo do projeto (grupo ou apelido). Com sucesso, fecha o formulário, avisa a barra lateral e
   * lê o projeto de novo; com falha, a mensagem vai para o formulário e ele continua aberto.
   */
  async function saveField(
    save: () => Promise<AppResult<unknown>>,
    setError: (message: string | null) => void,
    close: () => void,
  ) {
    setError(null);
    try {
      const result = await save();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      close();
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
      await load();
    } catch {
      setError(GENERIC_ERROR);
    }
  }
  /** Grava o grupo do projeto (ou o tira, com `null`). */
  function saveGroup(value: string | null) {
    return saveField(
      () => window.projectHub.projects.setGroup(projectId, value),
      setGroupError,
      () => setEditingGroup(false),
    );
  }
  /** Grava o apelido do projeto (ou o remove, com `null`). */
  function saveNickname(value: string | null) {
    return saveField(
      () => window.projectHub.projects.setNickname(projectId, value),
      setNicknameError,
      () => setEditingNickname(false),
    );
  }
  function startCreating() {
    setTab('missions');
    setNotice(null);
    setCreating(true);
  }

  return (
    <>
      <header className="project-head">
        <div className="project-head__main">
          <p className="eyebrow">
            {project.repositoryKind === 'git' ? 'Repositório Git' : 'Sem Git'}
          </p>
          <h1 title={project.name}>{project.nickname ?? project.name}</h1>
          <div className="project-head__meta">
            <span className="branch-chip">Branch: {project.defaultBranch ?? 'sem Git'}</span>
            {project.group === undefined ? null : (
              <span className="branch-chip">Grupo: {project.group}</span>
            )}
          </div>
        </div>
        <div className="project-head__actions">
          {creating ? null : (
            <button type="button" className="btn-primary" onClick={startCreating}>
              Nova missão
            </button>
          )}
          <MenuAcoes
            rotulo="Mais ações"
            acoes={[
              {
                rotulo: 'Mover para grupo…',
                onSelecionar: () => {
                  setGroupName(project.group ?? '');
                  setGroupError(null);
                  setEditingGroup(true);
                },
              },
              {
                rotulo: 'Definir apelido…',
                onSelecionar: () => {
                  setNickname(project.nickname ?? '');
                  setNicknameError(null);
                  setEditingNickname(true);
                },
              },
              {
                rotulo: 'Arquivar projeto',
                desabilitada: leaving,
                onSelecionar: () =>
                  void leaveList(() => window.projectHub.projects.archive(projectId)),
              },
              {
                rotulo: 'Remover da lista',
                perigosa: true,
                desabilitada: leaving,
                onSelecionar: () => setConfirmingRemove(true),
              },
            ]}
          />
        </div>
      </header>
      {editingGroup ? (
        <form
          aria-label="Grupo do projeto"
          className="confirm-inline"
          onSubmit={(event) => {
            event.preventDefault();
            void saveGroup(groupName);
          }}
        >
          <label htmlFor="project-group">Grupo</label>
          <input
            id="project-group"
            list="project-groups"
            value={groupName}
            maxLength={40}
            placeholder="Trabalho, Pessoal…"
            onChange={(event) => setGroupName(event.target.value)}
          />
          <datalist id="project-groups">
            {groups.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button type="submit" className="btn-primary">
            Salvar
          </button>
          {project.group === undefined ? null : (
            <button type="button" onClick={() => void saveGroup(null)}>
              Tirar do grupo
            </button>
          )}
          <button type="button" onClick={() => setEditingGroup(false)}>
            Cancelar
          </button>
          {groupError === null ? null : (
            <span role="alert" className="page-alert">
              {groupError}
            </span>
          )}
        </form>
      ) : null}
      {editingNickname ? (
        <form
          aria-label="Apelido do projeto"
          className="confirm-inline"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNickname(nickname);
          }}
        >
          <label htmlFor="project-nickname">Apelido</label>
          <input
            id="project-nickname"
            value={nickname}
            maxLength={24}
            placeholder="ex.: Re_Zero"
            onChange={(event) => setNickname(event.target.value)}
          />
          <button type="submit" className="btn-primary">
            Salvar
          </button>
          {project.nickname === undefined ? null : (
            <button type="button" onClick={() => void saveNickname(null)}>
              Remover apelido
            </button>
          )}
          <button type="button" onClick={() => setEditingNickname(false)}>
            Cancelar
          </button>
          {nicknameError === null ? null : (
            <span role="alert" className="page-alert">
              {nicknameError}
            </span>
          )}
        </form>
      ) : null}
      {confirmingRemove ? (
        <div role="group" aria-label="Confirmar remoção" className="confirm-inline">
          <span>
            Tirar o projeto da lista? A pasta, o Git e as missões ficam como estão, e cadastrar a
            pasta de novo traz tudo de volta.
          </span>
          <button
            type="button"
            disabled={leaving}
            onClick={() => void leaveList(() => window.projectHub.projects.remove(projectId))}
          >
            Remover
          </button>
          <button type="button" onClick={() => setConfirmingRemove(false)}>
            Cancelar
          </button>
        </div>
      ) : null}
      {lifecycleError === null ? null : (
        <p role="alert" className="page-alert">
          {lifecycleError}
        </p>
      )}

      <div className="project-page">
        <div className="project-tabs">
          <Tabs
            label="Seções do projeto"
            tabs={tabsOf(missions.length)}
            active={tab}
            onChange={setTab}
          />
        </div>
        <div role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`}>
          {tab === 'missions' ? (
            <>
              {notice === null ? null : (
                <p role="status" className="page-note">
                  {notice}
                </p>
              )}
              {actionError === null ? null : (
                <p role="alert" className="page-alert">
                  {actionError}
                </p>
              )}
              {creating ? (
                <MissionForm
                  onSubmit={createMission}
                  onCancel={() => setCreating(false)}
                  projectHasGit={project.repositoryKind === 'git'}
                />
              ) : (
                <div className="missions-toolbar">
                  <h2 className="missions-toolbar__title">Missões</h2>
                  {missions.length === 0 ? null : (
                    <p className="missions-toolbar__count">{toolbarCount(missions)}</p>
                  )}
                </div>
              )}
              {missions.length === 0 ? (
                creating ? null : (
                  <FirstMission />
                )
              ) : (
                <ul className="card-list" aria-label="Missões do projeto">
                  {missions.map((mission) => (
                    <li key={mission.id}>
                      <MissionCard mission={mission} projectId={projectId} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : tab === 'overview' ? (
            <Overview project={project} missions={missions} onSeeAll={() => setTab('missions')} />
          ) : tab === 'repository' ? (
            <RepositoryCard project={project} />
          ) : tab === 'worktrees' ? (
            <WorktreesTab projectId={projectId} />
          ) : (
            <p className="page-note">Disponível na próxima etapa.</p>
          )}
        </div>
      </div>
    </>
  );
}

/** Texto da barra da aba: quantas missões há e quantas esperam a pessoa. */
function toolbarCount(missions: readonly MissionDto[]): string {
  const total = missions.length === 1 ? '1 missão' : `${missions.length} missões`;
  const waiting = missions.filter((m) => needsAttention(m.status)).length;
  return waiting === 0 ? total : `${total} · ${waiting} aguarda você`;
}

/** Convite do projeto sem missões: o que é uma missão e os três passos. */
function FirstMission() {
  return (
    <section className="missions-empty" aria-label="Primeira missão">
      <p className="missions-empty__title">Comece sua primeira missão</p>
      <p className="missions-empty__hint">
        Uma missão é um objetivo que o agente cumpre num worktree próprio, longe da pasta do
        projeto. Use o botão Nova missão, no alto da página.
      </p>
      <ol className="missions-empty__steps">
        <li>Descreva o objetivo e os critérios de aceite.</li>
        <li>Revise o plano e aprove.</li>
        <li>Acompanhe, revise o resultado e conclua.</li>
      </ol>
    </section>
  );
}

/** Uma linha de missão da Visão geral: título que leva ao workspace, a frase e o selo da situação. */
function MissionRow({
  mission,
  projectId,
  detail,
}: {
  mission: MissionDto;
  projectId: string;
  detail: string;
}) {
  return (
    <li className="mission-row">
      <div className="mission-row__text">
        <Link to={missionPath(projectId, mission.id)}>{mission.title}</Link>
        <p>{detail}</p>
      </div>
      <StatusChip
        label={statusLabel(mission.status)}
        tone={statusTone(mission.status)}
        icon={statusIcon(mission.status)}
      />
    </li>
  );
}

/**
 * Visão geral: os contadores, o que espera a pessoa, as missões recentes e o cartão do repositório. Projeto
 * sem missões mostra o convite no lugar das listas.
 */
function Overview({
  project,
  missions,
  onSeeAll,
}: {
  project: ProjectSummary;
  missions: readonly MissionDto[];
  onSeeAll: () => void;
}) {
  const waiting = missions.filter((m) => needsAttention(m.status));
  const recent = [...missions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const counts: readonly { label: string; value: number }[] = [
    { label: 'Missões', value: missions.length },
    { label: 'Em execução', value: missions.filter((m) => m.status === 'running').length },
    { label: 'Aguardam você', value: waiting.length },
    { label: 'Concluídas', value: missions.filter((m) => m.status === 'succeeded').length },
  ];
  return (
    <>
      <ul className="project-counts" aria-label="Missões por situação">
        {counts.map((count) => (
          <li key={count.label}>
            <span className="project-counts__value">{count.value}</span>
            <span className="project-counts__label">{count.label}</span>
          </li>
        ))}
      </ul>
      <div className="project-grid">
        <div className="project-grid__main">
          {missions.length === 0 ? (
            <FirstMission />
          ) : (
            <>
              {waiting.length === 0 ? null : (
                <section className="panel-card panel-card--attention" aria-label="Precisa de você">
                  <h2 className="panel-card__title">Precisa de você</h2>
                  <ul className="mission-rows">
                    {waiting.map((mission) => (
                      <MissionRow
                        key={mission.id}
                        mission={mission}
                        projectId={project.id}
                        detail={requiredActionOf(mission.status) ?? situationOf(mission.status)}
                      />
                    ))}
                  </ul>
                </section>
              )}
              <section className="panel-card" aria-label="Missões recentes">
                <div className="panel-card__head">
                  <h2 className="panel-card__title">Missões recentes</h2>
                  <button type="button" className="link-button" onClick={onSeeAll}>
                    Ver todas
                  </button>
                </div>
                <ul className="mission-rows">
                  {recent.map((mission) => (
                    <MissionRow
                      key={mission.id}
                      mission={mission}
                      projectId={project.id}
                      detail={`Atualizada ${formatTime(mission.updatedAt)}`}
                    />
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
        <div className="project-grid__side">
          <RepositoryCard project={project} />
        </div>
      </div>
    </>
  );
}

/** Cartão do repositório: tipo, branch padrão e a pasta (nome, abrir e copiar o caminho). */
function RepositoryCard({ project }: { project: ProjectSummary }) {
  return (
    <section className="panel-card" aria-label="Repositório">
      <h2 className="panel-card__title">Repositório</h2>
      <dl className="project-facts">
        <dt>Tipo</dt>
        <dd>{project.repositoryKind === 'git' ? 'Repositório Git' : 'Sem Git'}</dd>
        <dt>Branch padrão</dt>
        <dd>{project.defaultBranch ?? 'sem Git'}</dd>
        <dt>Pasta</dt>
        <dd>
          <ProjectFolder projectId={project.id} path={project.path} />
        </dd>
      </dl>
    </section>
  );
}
