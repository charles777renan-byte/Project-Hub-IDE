import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ProjectSummary } from '@project-hub/contracts';
import { HOME_TEXT, MISSIONS_VIEW_TEXT, PROJECT_TEXT } from '../../mission-text';
import { scheduleReload } from '../../overview-data';
import { NEW_MISSION_PARAM } from '../../project-views';
import { missionPath } from '../../routes';
import { useMissionsBoard } from '../../use-missions-board';
import { MissionForm, type MissionFormValues } from '../MissionForm';
import { MissionProgressList } from '../MissionProgressList';

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
 * uma vez por navegação: a rota é limpa logo depois, sem perder `?visao=`. Criar chama só `missions.create`
 * (o plano usa a cota do Claude e só nasce no Orquestrar) e abre a missão; com "Só criar, sem abrir" volta à
 * lista e avisa. `project` é `undefined` enquanto a lista da barra lateral não chegou (ou falhou): nesse caso a
 * frase de vazio nunca aparece, para não dizer que não há missões sem saber.
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
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice(null);
    setError(null);
    setCreating(true);
    const rest = new URLSearchParams(location.search);
    rest.delete(NEW_MISSION_PARAM);
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
    setNotice(null);
    setError(null);
    setCreating(true);
  }

  function closeForm() {
    restoreFocus.current = true;
    setError(null);
    setCreating(false);
  }

  /**
   * Cria a missão em rascunho. Falha fica na tela, com o formulário e o que foi digitado. Com "Só criar, sem
   * abrir" volta à lista e pede a leitura de novo; sem a opção, abre a missão, onde a pessoa clica em Orquestrar.
   */
  async function createMission(values: MissionFormValues) {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
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
        setError(created.error.message);
        return;
      }
      if (values.planOnly) {
        restoreFocus.current = true;
        setCreating(false);
        setNotice(MISSIONS_VIEW_TEXT.createdNotice);
        scheduleReload();
        return;
      }
      navigate(missionPath(projectId, created.data.id));
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
        <button type="button" className="btn-secondary" onClick={openForm}>
          {PROJECT_TEXT.newMission}
        </button>
      </div>
    );
  } else {
    body = <MissionProgressList items={board.items} />;
  }

  return (
    <div className="project-missions" ref={rootRef} tabIndex={-1}>
      <p role="status" className="project-missions__notice">
        {notice}
      </p>
      {error === null ? null : (
        <p role="alert" className="page-alert">
          {error}
        </p>
      )}
      {body}
    </div>
  );
}
