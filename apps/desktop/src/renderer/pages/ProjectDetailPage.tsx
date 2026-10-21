import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { AppResult, MissionDto, ProjectSummary } from '@project-hub/contracts';
import { ConfirmButton } from '../components/ConfirmButton';
import { MissionCard } from '../components/MissionCard';
import { MissionForm, type MissionFormValues } from '../components/MissionForm';
import { PathText } from '../components/PathText';
import { Tabs, type TabItem } from '../components/Tabs';
import { WorktreesTab } from '../components/WorktreesTab';
import { needsAttention } from '../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../projects-events';
import { missionPath, ROUTE_PATHS } from '../routes';

type ProjectTab = 'overview' | 'missions' | 'repository' | 'worktrees' | 'settings';

/** Abas do projeto (seção 10.5). Configurações e permissões ainda não tem conteúdo. */
const TABS: readonly TabItem<ProjectTab>[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'missions', label: 'Missões' },
  { id: 'repository', label: 'Repositório' },
  { id: 'worktrees', label: 'Worktrees' },
  { id: 'settings', label: 'Configurações e permissões' },
];

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; project: ProjectSummary; missions: MissionDto[] }
  | { status: 'error'; message: string };

/**
 * Detalhe de um projeto (seção 10.5, R167): nome, pasta e branch no cabeçalho, e a aba Missões com
 * os cartões e a criação. A criação gera o plano na hora; com "Somente planejar", a página fica na
 * lista, e sem a opção abre o workspace da missão.
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
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

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
          ? { status: 'ready', project, missions: missions.data }
          : { status: 'error', message: missions.error.message },
      );
    } catch {
      setState({ status: 'error', message: GENERIC_ERROR });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A lista mostra a situação de cada missão: qualquer evento de missão pede a lista de novo.
  useEffect(() => window.projectHub.missions.subscribe(() => void load()), [load]);

  /** Cria a missão, gera o plano e segue para o workspace, salvo quando a pessoa pediu só o plano. */
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
      const planned = await window.projectHub.missions.plan(created.data.id);
      setCreating(false);
      if (!planned.ok) {
        // A missão já existe em rascunho: a lista mostra, e o workspace gera o plano depois.
        setActionError(planned.error.message);
        await load();
        return;
      }
      if (values.planOnly) {
        setNotice('Plano gerado. Abra a missão para revisar e aprovar o plano.');
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
    navigate(ROUTE_PATHS.projects);
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

  const { project, missions } = state;
  return (
    <>
      <p className="eyebrow">{project.repositoryKind === 'git' ? 'Repositório Git' : 'Sem Git'}</p>
      <h1>{project.name}</h1>
      <p className="project-path">
        <PathText path={project.path} />
      </p>
      <p className="mission-meta">Branch: {project.defaultBranch ?? 'sem Git'}</p>
      <div className="inline-actions">
        <button
          type="button"
          disabled={leaving}
          onClick={() => void leaveList(() => window.projectHub.projects.archive(projectId))}
        >
          Arquivar projeto
        </button>
        <ConfirmButton
          label="Remover da lista"
          question="Tirar o projeto da lista? A pasta, o Git e as missões ficam como estão, e cadastrar a pasta de novo traz tudo de volta."
          confirmLabel="Remover"
          disabled={leaving}
          onConfirm={() => void leaveList(() => window.projectHub.projects.remove(projectId))}
        />
      </div>
      {lifecycleError === null ? null : (
        <p role="alert" className="page-alert">
          {lifecycleError}
        </p>
      )}

      <div className="workspace-panel">
        <Tabs label="Seções do projeto" tabs={TABS} active={tab} onChange={setTab} />
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
                <p>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setNotice(null);
                      setCreating(true);
                    }}
                  >
                    Criar missão
                  </button>
                </p>
              )}
              {missions.length === 0 ? (
                <p className="empty">Nenhuma missão ainda. Crie a primeira.</p>
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
            <MissionCounts missions={missions} />
          ) : tab === 'repository' ? (
            <RepositoryInfo project={project} />
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

/** Aba Visão geral (R217): contagens das missões do projeto por situação, com a lista já carregada. */
function MissionCounts({ missions }: { missions: MissionDto[] }) {
  const counts: readonly { label: string; value: number }[] = [
    { label: 'Total', value: missions.length },
    { label: 'Em execução', value: missions.filter((m) => m.status === 'running').length },
    { label: 'Aguardando você', value: missions.filter((m) => needsAttention(m.status)).length },
    { label: 'Concluídas', value: missions.filter((m) => m.status === 'succeeded').length },
    { label: 'Falharam', value: missions.filter((m) => m.status === 'failed').length },
  ];
  return (
    <ul className="project-counts" aria-label="Missões por situação">
      {counts.map((count) => (
        <li key={count.label}>
          <span className="project-counts__value">{count.value}</span>
          <span className="project-counts__label">{count.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Aba Repositório (R217): tipo, branch padrão e pasta do projeto. */
function RepositoryInfo({ project }: { project: ProjectSummary }) {
  return (
    <dl className="project-facts">
      <dt>Tipo</dt>
      <dd>{project.repositoryKind === 'git' ? 'Repositório Git' : 'Sem Git'}</dd>
      <dt>Branch padrão</dt>
      <dd>{project.defaultBranch ?? 'sem Git'}</dd>
      <dt>Pasta</dt>
      <dd className="project-path">
        <PathText path={project.path} />
      </dd>
    </dl>
  );
}
