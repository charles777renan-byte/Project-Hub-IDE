import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { AppError, AppResult, ErrorCode, MissionViewDto } from '@project-hub/contracts';
import { ConversationPanel } from '../components/ConversationPanel';
import { Panel, PanelEmpty } from '../components/Panel';
import { PlanPanel } from '../components/PlanPanel';
import { DecisionColumn } from '../components/workspace/DecisionColumn';
import { DiffPanel } from '../components/workspace/DiffPanel';
import { LogsPanel } from '../components/workspace/LogsPanel';
import { MissionHeader } from '../components/workspace/MissionHeader';
import { TerminalPanel } from '../components/workspace/TerminalPanel';
import { needsDecisionInConversation } from '../mission-text';
import { PROJECTS_CHANGED_EVENT } from '../projects-events';
import { projectPath } from '../routes';

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

/**
 * Mensagens do início da missão para as falhas do worktree (R213). Cada código diz o que aconteceu
 * e o que fazer. Só `PROJECT_WITHOUT_GIT` manda inicializar o Git, porque é o único caso em que isso
 * resolve. Os demais códigos seguem com a própria mensagem.
 */
const WORKTREE_START_MESSAGES: ReadonlyMap<ErrorCode, string> = new Map<ErrorCode, string>([
  [
    'WORKTREE_COLLISION',
    'Já existe uma branch ou uma pasta com o nome do worktree desta missão, provavelmente de uma tentativa anterior. Confira o que sobrou no Git antes de apagar algo e tente de novo.',
  ],
  [
    'WORKTREE_CREATE_FAILED',
    'Não foi possível criar o worktree da missão. Tente de novo; se o erro voltar, confira o repositório do projeto no Git.',
  ],
  [
    'PROJECT_WITHOUT_GIT',
    'Este projeto não é um repositório Git. Inicialize o Git na pasta e tente de novo.',
  ],
]);

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; view: MissionViewDto }
  | { status: 'error'; message: string };

/**
 * Texto do estado vazio de um painel que chega numa tarefa futura. Sem worktree, o texto diz o porquê
 * antes de dizer a tarefa.
 */
function pendingNote(hasWorktree: boolean, task: number): string {
  const note = `Chega com a Tarefa ${task}.`;
  return hasWorktree ? note : `A missão ainda não tem worktree. ${note}`;
}

/**
 * Workspace de uma missão (seção 10.7, R168): o cabeçalho com título, situação e ações, e seis painéis
 * numa grade 2×3 (Conversa, Plano, Diff, Testes, Terminal e Logs do sistema), com a coluna "Aguardando
 * você" à direita (Tarefa 6), onde a decisão acontece. A visão vem do processo principal e é buscada
 * de novo a cada ação e a cada evento da missão (R165). Uma resposta antiga, que chega depois de uma
 * mais nova, não substitui a tela.
 *
 * Os painéis ficam montados o tempo todo, então a resposta digitada na Conversa não se perde quando a
 * pessoa age em outro painel. Quando a missão espera a decisão (R182), o foco vai para a Conversa.
 */
export function MissionPage() {
  const { missionId = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  /** Falha de uma recarga com a visão já na tela: a visão antiga fica, e o aviso aparece acima da grade. */
  const [reloadError, setReloadError] = useState<string | null>(null);
  /** Chamadas longas (início, decisão, resposta, nova tentativa e planejamento). Não bloqueiam os controles. */
  const [busy, setBusy] = useState(false);
  /** Pausar, retomar e cancelar: cada uma só cobre a própria chamada, e vale com a longa em curso. */
  const [controlBusy, setControlBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLElement>(null);
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    let view: MissionViewDto | null = null;
    let failure: string | null = null;
    try {
      const result = await window.projectHub.missions.get(missionId);
      if (result.ok) view = result.data;
      else failure = result.error.message;
    } catch {
      failure = GENERIC_ERROR;
    }
    if (request !== latestRequest.current) return;
    if (view !== null) {
      setState({ status: 'ready', view });
      setReloadError(null);
      return;
    }
    // Com a visão já na tela, uma falha de recarga não a apaga: a Conversa e a resposta digitada seguem.
    setState((current) =>
      current.status === 'ready' ? current : { status: 'error', message: failure ?? GENERIC_ERROR },
    );
    setReloadError(failure ?? GENERIC_ERROR);
  }, [missionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(
    () =>
      window.projectHub.missions.subscribe((event) => {
        if (event.missionId === missionId) void reload();
      }),
    [missionId, reload],
  );

  const decisionStatus = state.status === 'ready' ? state.view.mission.status : undefined;
  const needsDecision = decisionStatus !== undefined && needsDecisionInConversation(decisionStatus);
  /**
   * Quando a missão passa a esperar a decisão da pessoa, o foco vai para o lugar dela (R182): a
   * aprovação na coluna Aguardando você, e a resposta do agente na Conversa.
   */
  useEffect(() => {
    if (!needsDecision) return;
    const target =
      decisionStatus === 'waiting_approval' ? decisionRef.current : conversationRef.current;
    target?.focus();
  }, [needsDecision, decisionStatus]);

  /**
   * Roda uma ação da missão, marcando `pending` enquanto ela não volta. Falha vira mensagem na tela,
   * e a visão é buscada de novo em qualquer caso.
   */
  async function execute(
    action: () => Promise<AppResult<unknown>>,
    setPending: (pending: boolean) => void,
    failureText: (error: AppError) => string = (error) => error.message,
  ): Promise<boolean> {
    setPending(true);
    setActionError(null);
    let ok = false;
    try {
      const result = await action();
      if (result.ok) {
        ok = true;
      } else {
        setActionError(failureText(result.error));
      }
    } catch {
      setActionError(GENERIC_ERROR);
    }
    setPending(false);
    await reload();
    return ok;
  }

  /** Chamada longa: início, decisão, resposta, nova tentativa e planejamento. */
  const run = (action: () => Promise<AppResult<unknown>>) => execute(action, setBusy);
  /** Início da missão: falha de worktree ganha a mensagem do seu código (R213). */
  const runStart = () =>
    execute(
      () => window.projectHub.missions.start(missionId),
      setBusy,
      (error) => WORKTREE_START_MESSAGES.get(error.code) ?? error.message,
    );
  /** Controle da execução: pausar, retomar e cancelar. Não espera a chamada longa terminar. */
  const runControl = (action: () => Promise<AppResult<unknown>>) => execute(action, setControlBusy);

  /**
   * Exclui a missão encerrada e volta ao projeto. Fora do `execute`: quando dá certo, não há visão para
   * recarregar, então a página só troca de rota. Falha fica na tela, e a visão é buscada de novo.
   */
  async function removeMission(projectId: string) {
    setControlBusy(true);
    setActionError(null);
    try {
      const result = await window.projectHub.missions.delete(missionId);
      if (result.ok) {
        window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
        navigate(projectPath(projectId));
        return;
      }
      setActionError(result.error.message);
    } catch {
      setActionError(GENERIC_ERROR);
    }
    setControlBusy(false);
    await reload();
  }

  if (state.status === 'loading') {
    return <p role="status">Carregando missão…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="page-alert">
        {state.message}
      </p>
    );
  }

  const { mission, project, events, steps } = state.view;
  const hasWorktree = mission.worktreePath !== undefined;
  return (
    <div className="mission-workspace">
      <MissionHeader
        mission={mission}
        project={project}
        busy={busy}
        controlBusy={controlBusy}
        onPause={() => void runControl(() => window.projectHub.missions.pause(missionId))}
        onResume={() => void runControl(() => window.projectHub.missions.resume(missionId))}
        onRetry={() => void run(() => window.projectHub.missions.retry(missionId))}
        onCancel={() => void runControl(() => window.projectHub.missions.cancel(missionId))}
        onDelete={() => void removeMission(project.id)}
        onOpenDecision={() =>
          (decisionStatus === 'waiting_approval'
            ? decisionRef.current
            : conversationRef.current
          )?.focus()
        }
      />

      {actionError === null ? null : (
        <p role="alert" className="page-alert">
          {actionError}
        </p>
      )}
      {reloadError === null ? null : (
        <p role="alert" className="page-alert">
          {reloadError}
        </p>
      )}

      <div className="mission-grid">
        <Panel title="Conversa" accent="magenta">
          <div ref={conversationRef} tabIndex={-1} className="mission-focus">
            <ConversationPanel
              view={state.view}
              busy={busy}
              onAnswer={(text) =>
                run(() => window.projectHub.missions.provideInput({ missionId, text }))
              }
            />
          </div>
        </Panel>
        <Panel title="Plano" accent="blue">
          <PlanPanel
            mission={mission}
            steps={steps}
            busy={busy}
            onGeneratePlan={() => void run(() => window.projectHub.missions.plan(missionId))}
            onApprovePlan={() => void run(() => window.projectHub.missions.approvePlan(missionId))}
            onRequestNewPlan={() => void run(() => window.projectHub.missions.plan(missionId))}
            onStart={() => void runStart()}
          />
        </Panel>
        <Panel title="Diff" accent="orange">
          <DiffPanel missionId={missionId} hasWorktree={hasWorktree} refreshKey={events.length} />
        </Panel>
        <Panel title="Testes" accent="lime">
          <PanelEmpty>{pendingNote(hasWorktree, 12)}</PanelEmpty>
        </Panel>
        <Panel title="Terminal" accent="cyan">
          <TerminalPanel events={events} />
        </Panel>
        <Panel title="Logs do sistema" accent="yellow">
          <LogsPanel events={events} />
        </Panel>
        <DecisionColumn
          view={state.view}
          busy={busy}
          focusRef={decisionRef}
          onDecide={(approvalId, decision) =>
            void run(() => window.projectHub.approvals.decide({ approvalId, decision }))
          }
        />
      </div>
    </div>
  );
}
