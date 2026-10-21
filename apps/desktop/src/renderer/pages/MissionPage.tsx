import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import type { AppResult, MissionViewDto } from '@project-hub/contracts';
import { ConversationPanel } from '../components/ConversationPanel';
import { Panel, PanelEmpty } from '../components/Panel';
import { PlanPanel } from '../components/PlanPanel';
import { DecisionColumn } from '../components/workspace/DecisionColumn';
import { LogsPanel } from '../components/workspace/LogsPanel';
import { MissionHeader } from '../components/workspace/MissionHeader';
import { needsDecisionInConversation } from '../mission-text';

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

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
  ): Promise<boolean> {
    setPending(true);
    setActionError(null);
    let ok = false;
    try {
      const result = await action();
      if (result.ok) {
        ok = true;
      } else {
        setActionError(result.error.message);
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
  /** Controle da execução: pausar, retomar e cancelar. Não espera a chamada longa terminar. */
  const runControl = (action: () => Promise<AppResult<unknown>>) => execute(action, setControlBusy);

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
            onStart={() => void run(() => window.projectHub.missions.start(missionId))}
          />
        </Panel>
        <Panel title="Diff" accent="orange">
          <PanelEmpty>{pendingNote(hasWorktree, 10)}</PanelEmpty>
        </Panel>
        <Panel title="Testes" accent="lime">
          <PanelEmpty>{pendingNote(hasWorktree, 12)}</PanelEmpty>
        </Panel>
        <Panel title="Terminal" accent="cyan">
          <PanelEmpty>{pendingNote(hasWorktree, 13)}</PanelEmpty>
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
