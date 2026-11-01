import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ProjectSummary } from '@project-hub/contracts';
import { HOME_TEXT, PROJECT_TEXT } from '../../mission-text';
import { NEW_MISSION_PARAM, VIEW_PARAM } from '../../project-views';
import { missionPath } from '../../routes';
import { useMissionsBoard } from '../../use-missions-board';
import { MissionForm, type MissionFormValues } from '../MissionForm';
import { MissionProgressList } from '../MissionProgressList';
import { PROJECT_NO_GIT_NOTICE_ID } from './ProjectHeader';

/** O pedido de abrir o formulário: `state.newMission` (cabeçalho e paleta) ou `?nova-missao=1` na rota. */
function newMissionRequested(state: unknown, search: string): boolean {
  const fromState =
    typeof state === 'object' &&
    state !== null &&
    (state as { newMission?: unknown }).newMission === true;
  return fromState || new URLSearchParams(search).get(NEW_MISSION_PARAM) === '1';
}

/**
 * Visão Missões da aba do projeto: a lista com progresso do projeto (`MissionProgressList`, a mesma do Início)
 * ou, sem missões, uma linha com o botão Nova missão. Nova missão abre o formulário compacto no lugar da lista;
 * o pedido vem do cabeçalho, da lista vazia ou da paleta (`state.newMission` ou `?nova-missao=1`) e é consumido
 * uma vez por navegação: a rota é limpa logo depois, e `?visao=missoes` fica nela. Criar chama só `missions.create`
 * e abre a missão em rascunho; "Criar e orquestrar" abre a missão pedindo o plano (`state.orchestrate`), que a
 * página da missão roda uma vez, com o mesmo botão e a mesma trava do Orquestrar. `project` é `undefined`
 * enquanto a lista da barra lateral não chegou (ou falhou): nesse caso a frase de vazio nunca aparece, para não
 * dizer que não há missões sem saber.
 */
export function ProjectMissions({
  projectId,
  project,
}: {
  projectId: string;
  project: ProjectSummary | undefined;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const board = useMissionsBoard({ projectId });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const consumed = useRef<string | null>(null);
  const submitting = useRef(false);
  // Ao sair do formulário, o foco volta para a visão (senão cairia no body).
  const restoreFocus = useRef(false);

  const requested = newMissionRequested(location.state, location.search);
  useEffect(() => {
    if (!requested || consumed.current === location.key) return;
    consumed.current = location.key;
    setError(null);
    setCreating(true);
    const rest = new URLSearchParams(location.search);
    rest.delete(NEW_MISSION_PARAM);
    // `?nova-missao=1` sozinho já abre Missões; ao tirá-lo, a visão fica escrita para não voltar a Terminais.
    rest.set(VIEW_PARAM, 'missoes');
    const search = rest.toString();
    navigate(
      { pathname: location.pathname, search: search === '' ? '' : `?${search}` },
      { replace: true, state: null },
    );
  }, [requested, location.key, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (creating || !restoreFocus.current) return;
    restoreFocus.current = false;
    rootRef.current?.focus();
  }, [creating]);

  function openForm() {
    setError(null);
    setCreating(true);
  }

  function closeForm() {
    restoreFocus.current = true;
    setError(null);
    setCreating(false);
  }

  /**
   * Cria a missão em rascunho e a abre. Falha fica na tela, com o formulário e o que foi digitado. Com "Criar e
   * orquestrar", a missão abre pedindo o plano: o pedido vai no estado da navegação, e a página da missão o roda.
   */
  async function createMission(values: MissionFormValues) {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      const created = await window.projectHub.missions.create({
        projectId,
        title: values.title,
        objective: values.objective,
        acceptanceCriteria: values.acceptanceCriteria,
        altersCode: values.altersCode,
      });
      if (!created.ok) {
        setError(created.error.message);
        return;
      }
      navigate(
        missionPath(projectId, created.data.id),
        values.orchestrate ? { state: { orchestrate: true } } : undefined,
      );
    } catch {
      setError(PROJECT_TEXT.genericError);
    } finally {
      submitting.current = false;
    }
  }

  let body: ReactNode;
  if (creating && project !== undefined) {
    body = (
      <MissionForm
        onSubmit={createMission}
        onCancel={closeForm}
        projectHasGit={project.repositoryKind === 'git'}
      />
    );
  } else if (board.status === 'error') {
    body = (
      <p className="page-alert" role="alert">
        {HOME_TEXT.missionsError}
      </p>
    );
  } else if (board.status === 'loading') {
    body = <p className="project-missions__note">{HOME_TEXT.loading}</p>;
  } else if (project === undefined) {
    // Lista pronta, mas o projeto não está entre os ativos: a página já avisa; aqui não se diz "nenhuma missão".
    body = null;
  } else if (board.items.length === 0) {
    body = (
      <div className="project-missions__empty">
        <p>{HOME_TEXT.missionsEmpty}</p>
        <button
          type="button"
          className="btn-secondary"
          disabled={project.repositoryKind !== 'git'}
          aria-describedby={project.repositoryKind === 'git' ? undefined : PROJECT_NO_GIT_NOTICE_ID}
          onClick={openForm}
        >
          {PROJECT_TEXT.newMission}
        </button>
      </div>
    );
  } else {
    body = <MissionProgressList items={board.items} />;
  }

  return (
    <div className="project-missions" ref={rootRef} tabIndex={-1}>
      {error === null ? null : (
        <p role="alert" className="page-alert">
          {error}
        </p>
      )}
      {body}
    </div>
  );
}
