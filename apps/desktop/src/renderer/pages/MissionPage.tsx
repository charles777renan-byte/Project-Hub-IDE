import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type {
  AppError,
  AppResult,
  ErrorCode,
  MissionViewDto,
  PlanEditInput,
} from '@project-hub/contracts';
import { ConversationPanel } from '../components/ConversationPanel';
import { PlanPanel } from '../components/PlanPanel';
import { ChangedFiles } from '../components/mission/ChangedFiles';
import { DecisionBlock } from '../components/mission/DecisionBlock';
import { MissionBottomPanel, type MissionTab } from '../components/mission/MissionBottomPanel';
import { AcceptancePanel } from '../components/workspace/AcceptancePanel';
import { DiffPanel, type DiffSummary } from '../components/workspace/DiffPanel';
import { LogsPanel } from '../components/workspace/LogsPanel';
import { MissionSummary } from '../components/workspace/MissionSummary';
import { MissionTerminal } from '../components/workspace/MissionTerminal';
import { TestsPanel } from '../components/workspace/TestsPanel';
import { needsDecisionInConversation, verifiedCriteria } from '../mission-text';
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
 * A missão aberta no centro da aba do projeto (`/workspaces/:projectId/missoes/:missionId`). O workspace é
 * remontado a cada missão (a chave é o `missionId`), para a aba aberta, o resumo do Diff, o pedido de foco
 * e a visão carregada não passarem de uma missão para a outra.
 */
export function MissionPage({ missionId }: { missionId: string }) {
  return <MissionWorkspace key={missionId} missionId={missionId} />;
}

/**
 * Workspace de uma missão (seção 10.7, R168), no formato do protótipo: o cabeçalho (título, objetivo,
 * situação e Mais ações), o quadro do orquestrador com a tabela de tarefas, os arquivos alterados e o
 * bloco "Sua decisão" rolam em cima; embaixo, o painel redimensionável com as abas Conversa, Diff,
 * Testes, Terminal e Logs, cada uma com a própria rolagem. A visão vem do processo principal e é buscada
 * de novo a cada ação e a cada evento da missão (R165). Uma resposta antiga, que chega depois de uma mais
 * nova, não substitui a tela.
 *
 * Os painéis das abas ficam montados o tempo todo (os de fora ficam escondidos), então a resposta
 * digitada na Conversa não se perde quando a pessoa olha outra aba. Quando a missão espera a decisão
 * (R182), o foco vai para o lugar da decisão, mas só quando a pessoa já está na Conversa: em outra aba,
 * nada troca e nada toma o foco, e o aviso do bloco "Sua decisão" avisa.
 */
function MissionWorkspace({ missionId }: { missionId: string }) {
  const navigate = useNavigate();
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  /** Falha de uma recarga com a visão já na tela: a visão antiga fica, e o aviso aparece acima do plano. */
  const [reloadError, setReloadError] = useState<string | null>(null);
  /** Chamadas longas (início, decisão, resposta, nova tentativa e planejamento). Não bloqueiam os controles. */
  const [busy, setBusy] = useState(false);
  /** O planejamento (Orquestrar) leva até alguns minutos e muda o rótulo do botão. */
  const [planning, setPlanning] = useState(false);
  /** Falha de uma edição das tarefas do plano: aparece junto das tarefas, não na página toda. */
  const [planEditError, setPlanEditError] = useState<string | null>(null);
  /** Pausar, retomar e cancelar: cada uma só cobre a própria chamada, e vale com a longa em curso. */
  const [controlBusy, setControlBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<MissionTab>('conversation');
  /** Contagem dos pedidos de foco na decisão: cada pedido muda a aba e, depois dela pintada, o foco. */
  const [focusRequest, setFocusRequest] = useState(0);
  /** Quantos arquivos o Diff leu, para a contagem da aba. `undefined` até a primeira leitura. */
  const [diffSummary, setDiffSummary] = useState<DiffSummary | undefined>(undefined);
  const conversationRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const latestRequest = useRef(0);
  /** Planejamento ou edição do plano em curso: o React só mostra o bloqueio depois, a trava é imediata. */
  const planMutation = useRef(false);

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
  /** A aba e a situação mais recentes, lidas só ao pedir ou pôr o foco (sem refazer os efeitos a cada mudança). */
  const tabRef = useRef(tab);
  const decisionStatusRef = useRef(decisionStatus);
  useEffect(() => {
    tabRef.current = tab;
    decisionStatusRef.current = decisionStatus;
  });
  const requestFocus = useCallback(() => setFocusRequest((count) => count + 1), []);
  /** Pedido da pessoa (aviso da decisão): leva à Conversa, onde ficam os controles da decisão, e pede o foco. */
  const openDecision = useCallback(() => {
    setTab('conversation');
    requestFocus();
  }, [requestFocus]);

  /**
   * Quando a missão passa a esperar a decisão da pessoa, o foco vai para o lugar dela (R182), mas só se
   * ela já está na Conversa. Em outra aba nada troca e nada toma o foco: o aviso do bloco "Sua decisão" avisa.
   */
  useEffect(() => {
    if (needsDecision && tabRef.current === 'conversation') requestFocus();
  }, [needsDecision, decisionStatus, requestFocus]);

  /** O foco vai para a aprovação, para a caixa de resposta ou, na falta delas, para a Conversa. */
  useEffect(() => {
    if (focusRequest === 0) return;
    const status = decisionStatusRef.current;
    const target =
      status === 'waiting_approval' || status === 'review'
        ? decisionRef.current
        : status === 'waiting_input'
          ? answerRef.current
          : null;
    (target ?? conversationRef.current)?.focus();
  }, [focusRequest]);

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
  /**
   * Planeja a missão (Orquestrar). Gasta a cota do Claude, então só roda num clique. Sem instrução, a
   * chamada leva só o id da missão. A falha fica na página, visível em qualquer aba.
   */
  const runPlan = (instruction = '') => {
    // Um segundo clique com o planejamento (ou uma edição) em curso é ignorado: duas mudanças no mesmo plano.
    if (planMutation.current) return Promise.resolve(false);
    planMutation.current = true;
    setPlanEditError(null);
    const call = () =>
      instruction === ''
        ? window.projectHub.missions.plan(missionId)
        : window.projectHub.missions.plan(missionId, instruction);
    return execute(call, (pending) => {
      setBusy(pending);
      setPlanning(pending);
    }).finally(() => {
      planMutation.current = false;
    });
  };
  /** Edição de uma tarefa do plano (renomear, remover, mover ou trocar o programa). A falha vai ao painel. */
  async function runEditStep(stepId: string, edit: PlanEditInput) {
    if (planMutation.current) return;
    planMutation.current = true;
    setBusy(true);
    setPlanEditError(null);
    setActionError(null);
    try {
      const result = await window.projectHub.missions.editPlanStep({ missionId, stepId, edit });
      if (!result.ok) setPlanEditError(result.error.message);
    } catch {
      setPlanEditError(GENERIC_ERROR);
    }
    try {
      await reload();
    } finally {
      setBusy(false);
      planMutation.current = false;
    }
  }
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
   * Exclui a missão encerrada e volta à lista de missões do projeto. Fora do `execute`: quando dá certo,
   * não há visão para recarregar, então a página só troca de rota. Falha fica na tela, e a visão é buscada
   * de novo.
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

  const { mission, project, events, steps, conclusion } = state.view;
  const hasWorktree = mission.worktreePath !== undefined;

  const main = (
    <>
      <MissionSummary
        mission={mission}
        project={project}
        conclusion={conclusion}
        controlBusy={controlBusy}
        onPause={() => void runControl(() => window.projectHub.missions.pause(missionId))}
        onCancel={() => void runControl(() => window.projectHub.missions.cancel(missionId))}
        onDelete={() => void removeMission(project.id)}
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
      <PlanPanel
        mission={mission}
        steps={steps}
        busy={busy}
        planning={planning}
        error={planEditError ?? undefined}
        onEditStep={(stepId, edit) => void runEditStep(stepId, edit)}
      />
      <ChangedFiles missionId={missionId} hasWorktree={hasWorktree} refreshKey={events.length} />
      <DecisionBlock
        view={state.view}
        busy={busy}
        planning={planning}
        controlBusy={controlBusy}
        onGeneratePlan={() => void runPlan()}
        onApprovePlan={() => void run(() => window.projectHub.missions.approvePlan(missionId))}
        onStart={() => void runStart()}
        onResume={() => void runControl(() => window.projectHub.missions.resume(missionId))}
        onRetry={() => void run(() => window.projectHub.missions.retry(missionId))}
        onOpenDecision={openDecision}
      />
    </>
  );

  return (
    <div className="mission-page">
      <MissionBottomPanel
        main={main}
        tab={tab}
        onTabChange={setTab}
        steps={steps}
        diff={diffSummary}
        events={events}
        panels={{
          conversation: (
            <div ref={conversationRef} tabIndex={-1} className="mission-focus">
              <ConversationPanel
                view={state.view}
                busy={busy}
                onAnswer={(text) =>
                  run(() => window.projectHub.missions.provideInput({ missionId, text }))
                }
                onDecide={(approvalId, decision) =>
                  void run(() => window.projectHub.approvals.decide({ approvalId, decision }))
                }
                onApprove={() =>
                  void run(() => window.projectHub.missions.approveReview(missionId))
                }
                onRequestChanges={(text) =>
                  run(() =>
                    window.projectHub.missions.requestChanges({ missionId, feedback: text }),
                  )
                }
                decisionRef={decisionRef}
                answerRef={answerRef}
              />
            </div>
          ),
          diff: (
            <DiffPanel
              missionId={missionId}
              hasWorktree={hasWorktree}
              refreshKey={events.length}
              onSummary={setDiffSummary}
            />
          ),
          tests: (
            <>
              <TestsPanel events={events} />
              <AcceptancePanel
                criteria={mission.acceptanceCriteria}
                verified={verifiedCriteria(events)}
              />
            </>
          ),
          terminal: <MissionTerminal missionId={missionId} events={events} />,
          logs: <LogsPanel events={events} />,
        }}
      />
    </div>
  );
}
