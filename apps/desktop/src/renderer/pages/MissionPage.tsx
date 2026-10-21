import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { AppError, AppResult, ErrorCode, MissionViewDto } from '@project-hub/contracts';
import { ConversationPanel } from '../components/ConversationPanel';
import { PlanPanel } from '../components/PlanPanel';
import { Tabs, type TabItem } from '../components/Tabs';
import { AcceptancePanel } from '../components/workspace/AcceptancePanel';
import { DecisionBanner } from '../components/workspace/DecisionBanner';
import { DiffPanel, type DiffSummary } from '../components/workspace/DiffPanel';
import { LogsPanel } from '../components/workspace/LogsPanel';
import { MissionSummary } from '../components/workspace/MissionSummary';
import { TerminalPanel } from '../components/workspace/TerminalPanel';
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

/** As abas da missão, na ordem em que aparecem. A Conversa é a aba de abertura. */
type MissionTab = 'conversation' | 'plan' | 'diff' | 'tests' | 'terminal' | 'logs';

const MISSION_TABS: readonly TabItem<MissionTab>[] = [
  { id: 'conversation', label: 'Conversa' },
  { id: 'plan', label: 'Plano' },
  { id: 'diff', label: 'Diff' },
  { id: 'tests', label: 'Testes' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'logs', label: 'Logs' },
];

const tabPanelId = (id: MissionTab) => `mission-panel-${id}`;

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; view: MissionViewDto }
  | { status: 'error'; message: string };

/**
 * Workspace de uma missão (seção 10.7, R168): o resumo fixo no topo (título, situação, ação principal e
 * indicadores), o banner "Aguardando você" quando há decisão pendente, e seis abas (Conversa, Plano,
 * Diff, Testes, Terminal e Logs), cada uma com a própria rolagem. A visão vem do processo principal e é
 * buscada de novo a cada ação e a cada evento da missão (R165). Uma resposta antiga, que chega depois
 * de uma mais nova, não substitui a tela.
 *
 * Os painéis das abas ficam montados o tempo todo (os de fora ficam escondidos), então a resposta
 * digitada na Conversa não se perde quando a pessoa olha outra aba. Quando a missão espera a decisão
 * (R182), a página vai para a Conversa e o foco vai para o lugar da decisão.
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
  const [tab, setTab] = useState<MissionTab>('conversation');
  /** Contagem dos pedidos de foco na decisão: cada pedido muda a aba e, depois dela pintada, o foco. */
  const [focusRequest, setFocusRequest] = useState(0);
  /** Quantos arquivos o Diff leu, para o resumo. `undefined` até a primeira leitura. */
  const [diffSummary, setDiffSummary] = useState<DiffSummary | undefined>(undefined);
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
  /** A situação mais recente, lida só no momento de pôr o foco (sem refazer o efeito a cada mudança). */
  const decisionStatusRef = useRef(decisionStatus);
  decisionStatusRef.current = decisionStatus;
  /** Leva à Conversa, onde ficam os controles da decisão, e pede o foco para depois da troca de aba. */
  const openDecision = useCallback(() => {
    setTab('conversation');
    setFocusRequest((count) => count + 1);
  }, []);

  /** Quando a missão passa a esperar a decisão da pessoa, o foco vai para o lugar dela (R182). */
  useEffect(() => {
    if (needsDecision) openDecision();
  }, [needsDecision, decisionStatus, openDecision]);

  /** O foco vai para a aprovação, ou para a Conversa quando o agente pede uma resposta. */
  useEffect(() => {
    if (focusRequest === 0) return;
    const target =
      decisionStatusRef.current === 'waiting_approval'
        ? (decisionRef.current ?? conversationRef.current)
        : conversationRef.current;
    target?.focus();
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
      <MissionSummary
        mission={mission}
        project={project}
        events={events}
        diff={diffSummary}
        busy={busy}
        controlBusy={controlBusy}
        onGeneratePlan={() => void run(() => window.projectHub.missions.plan(missionId))}
        onApprovePlan={() => void run(() => window.projectHub.missions.approvePlan(missionId))}
        onStart={() => void runStart()}
        onOpenDecision={openDecision}
        onPause={() => void runControl(() => window.projectHub.missions.pause(missionId))}
        onResume={() => void runControl(() => window.projectHub.missions.resume(missionId))}
        onRetry={() => void run(() => window.projectHub.missions.retry(missionId))}
        onCancel={() => void runControl(() => window.projectHub.missions.cancel(missionId))}
        onDelete={() => void removeMission(project.id)}
      />

      <DecisionBanner view={state.view} onOpen={openDecision} />

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

      <div className="mission-tabs">
        <Tabs
          label="Abas da missão"
          tabs={MISSION_TABS}
          active={tab}
          onChange={setTab}
          panelId={tabPanelId}
        />
        <TabPanel id="conversation" active={tab}>
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
              decisionRef={decisionRef}
            />
          </div>
        </TabPanel>
        <TabPanel id="plan" active={tab}>
          <PlanPanel
            mission={mission}
            steps={steps}
            busy={busy}
            onRequestNewPlan={() => void run(() => window.projectHub.missions.plan(missionId))}
          />
        </TabPanel>
        <TabPanel id="diff" active={tab}>
          <DiffPanel
            missionId={missionId}
            hasWorktree={hasWorktree}
            refreshKey={events.length}
            onSummary={setDiffSummary}
          />
        </TabPanel>
        <TabPanel id="tests" active={tab}>
          <TestsPanel events={events} />
          <AcceptancePanel
            criteria={mission.acceptanceCriteria}
            verified={verifiedCriteria(events)}
          />
        </TabPanel>
        <TabPanel id="terminal" active={tab}>
          <TerminalPanel events={events} />
        </TabPanel>
        <TabPanel id="logs" active={tab}>
          <LogsPanel events={events} />
        </TabPanel>
      </div>
    </div>
  );
}

/**
 * Painel de uma aba. Fica montado mesmo escondido, para não perder o estado (a resposta digitada, o
 * arquivo escolhido no Diff). O painel ativo rola dentro de si e recebe o foco do teclado, para a
 * rolagem funcionar sem mouse.
 */
function TabPanel({
  id,
  active,
  children,
}: {
  id: MissionTab;
  active: MissionTab;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(id)}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      hidden={id !== active}
      className="mission-tabpanel"
    >
      {children}
    </div>
  );
}
