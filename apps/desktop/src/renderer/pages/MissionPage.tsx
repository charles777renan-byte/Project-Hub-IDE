import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
import { revealDecision } from '../components/mission/decision-visibility';
import { MissionBottomPanel, type MissionTab } from '../components/mission/MissionBottomPanel';
import { TokenUsage } from '../components/mission/TokenUsage';
import { AcceptancePanel } from '../components/workspace/AcceptancePanel';
import { DiffPanel, type DiffSummary } from '../components/workspace/DiffPanel';
import { MissionSummary } from '../components/workspace/MissionSummary';
import { TestsPanel } from '../components/workspace/TestsPanel';
import { needsDecision, primaryActionOf, verifiedCriteria } from '../mission-text';
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
 * Quando o bloco "Sua decisão" aparece, fixo no topo da missão: a situação espera algo da pessoa (uma ação
 * principal, ou a aprovação, a resposta ou a revisão). Em execução, e concluída sem resumo, nada espera a
 * pessoa e o bloco se recolhe: continua montado, só sem ocupar a tela.
 *
 * EXCEÇÃO ao desenho (D3 e A2: "some quando não há decisão pendente"), a confirmar com a pessoa: a missão
 * concluída com resumo (`succeeded` com `conclusion`) mantém o bloco à vista, e fixo como os outros, mesmo
 * sem decisão. O resumo da conclusão (a frase final do agente, o próximo passo do Git, os testes e os
 * critérios) só existe dentro do bloco, e recolhê-lo apagaria da tela um conteúdo que a missão já mostrava.
 * O custo é um bloco fixo, de até 40% da janela, numa missão já encerrada. Para seguir o desenho à risca,
 * basta tirar o último termo da condição abaixo, e o resumo precisa ganhar outro lugar na tela (a aba
 * Atividade, por exemplo).
 */
function showsDecision(
  status: MissionViewDto['mission']['status'],
  hasConclusion: boolean,
): boolean {
  return (
    needsDecision(status) ||
    primaryActionOf(status) !== undefined ||
    (status === 'succeeded' && hasConclusion)
  );
}

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
 * situação e Mais ações) fica fixo no alto do corpo (`mission-top`); abaixo dele, no fluxo, vêm o bloco
 * "Sua decisão" (com uma barra compacta no alto quando ele rola para trás do cabeçalho), o quadro do
 * orquestrador e a tabela de tarefas; embaixo, o
 * painel redimensionável com as abas Atividade (com o filtro Técnico, os Logs), Alterações (os arquivos
 * alterados e o diff) e Testes, cada uma com a própria rolagem. A visão vem do processo principal e é buscada de novo a cada ação e a cada
 * evento da missão (R165). Uma resposta antiga, que chega depois de uma mais nova, não substitui a tela.
 *
 * As decisões (aprovações, resposta ao agente e revisão) moram no bloco "Sua decisão", logo abaixo do
 * cabeçalho e dos avisos dele, visível em qualquer aba do painel inferior; a Conversa tem só a história.
 * O bloco só aparece com uma decisão pendente (`showsDecision`). Sem ela, o invólucro se recolhe e o
 * bloco segue montado, porque a região de anúncio dele precisa existir antes da decisão chegar. O
 * cabeçalho, os avisos e o invólucro dividem o grupo fixo porque o CSS não sabe a altura do cabeçalho (ela
 * muda com o título, o objetivo e a largura): no grupo, o bloco fica sempre logo abaixo dele. Os painéis
 * das abas ficam montados o tempo todo (os de fora ficam escondidos). Quando a missão espera a decisão
 * (R182), o foco vai para o bloco (ou para a caixa de resposta), mas só quando a pessoa não está
 * trabalhando em outra aba do painel: aí nada troca e nada toma o foco (ela pode estar digitando no
 * terminal), e a região de anúncio do bloco avisa o leitor de tela.
 */
function MissionWorkspace({ missionId }: { missionId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  /**
   * Falha de uma recarga com a visão já na tela: a visão antiga fica, e o aviso aparece acima do plano.
   * É da visão, não de uma ação, então fica na página e não no bloco "Sua decisão".
   */
  const [reloadError, setReloadError] = useState<string | null>(null);
  /** Chamadas longas (início, decisão, resposta, nova tentativa e planejamento). Não bloqueiam os controles. */
  const [busy, setBusy] = useState(false);
  /** O planejamento (Orquestrar) leva até alguns minutos e muda o rótulo do botão. */
  const [planning, setPlanning] = useState(false);
  /** Falha de uma edição das tarefas do plano: aparece junto das tarefas, não na página toda. */
  const [planEditError, setPlanEditError] = useState<string | null>(null);
  /** Pausar, retomar e cancelar: cada uma só cobre a própria chamada, e vale com a longa em curso. */
  const [controlBusy, setControlBusy] = useState(false);
  /** Falha de uma ação da decisão (planejar, aprovar, iniciar, responder…): aparece no bloco, junto dos botões. */
  const [actionError, setActionError] = useState<string | null>(null);
  /** Falha de uma ação do cabeçalho (pausar, cancelar e excluir): aparece logo abaixo dele. */
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [tab, setTab] = useState<MissionTab>('conversation');
  /** Quantos arquivos o Diff leu, para a contagem da aba. `undefined` até a primeira leitura. */
  const [diffSummary, setDiffSummary] = useState<DiffSummary | undefined>(undefined);
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

  /**
   * O gasto de tokens chega por um canal próprio, a cada 1,5 s no máximo por tentativa, e cada evento traz o
   * total da tentativa: ele substitui o `usage` dela na visão, sem somar e sem recarregar (não é evento da
   * missão). Uma tentativa que ainda não está na visão é ignorada: o evento da missão que a criou já faz a
   * recarga, e ela vem com o gasto.
   */
  useEffect(
    () =>
      window.projectHub.missions.subscribeUsage((event) => {
        if (event.missionId !== missionId) return;
        setState((current) => {
          if (current.status !== 'ready') return current;
          const { executions } = current.view;
          if (!executions.some((execution) => execution.id === event.executionId)) return current;
          return {
            status: 'ready',
            view: {
              ...current.view,
              executions: executions.map((execution) =>
                execution.id === event.executionId
                  ? { ...execution, usage: event.usage }
                  : execution,
              ),
            },
          };
        });
      }),
    [missionId],
  );

  const decisionStatus = state.status === 'ready' ? state.view.mission.status : undefined;
  const awaitingDecision = decisionStatus !== undefined && needsDecision(decisionStatus);
  /** A aba mais recente, lida só ao pôr o foco (sem refazer o efeito a cada troca de aba). */
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  });

  /**
   * Quando a missão passa a esperar a decisão da pessoa (ou abre já esperando, vinda do aviso "Precisa de
   * você"), o foco vai para o bloco "Sua decisão" (R182), ou para a caixa de resposta quando o agente
   * pergunta. Só se a pessoa não está numa outra aba do painel inferior: lá ela pode estar digitando, e a
   * região de anúncio do bloco avisa. A Conversa só tem a história, então ali nada se perde.
   */
  useEffect(() => {
    if (!awaitingDecision || tabRef.current !== 'conversation') return;
    const target = decisionStatus === 'waiting_input' ? answerRef.current : decisionRef.current;
    (target ?? decisionRef.current)?.focus();
  }, [awaitingDecision, decisionStatus]);

  /**
   * Ao abrir a missão, se a situação tem uma ação principal ou espera uma decisão, o bloco "Sua decisão" é
   * trazido à vista (o corpo rola e ele pode ficar abaixo da dobra). Só rola, não move o foco: o foco é do
   * efeito acima. Uma vez por missão aberta, não a cada recarga.
   */
  const scrolledToDecision = useRef(false);
  /** O encaixe da barra de decisão, no grupo fixo do alto do corpo. */
  const barSlotRef = useRef<HTMLDivElement | null>(null);
  const [barSlot, setBarSlot] = useState<HTMLDivElement | null>(null);
  const setBarSlotNode = useCallback((node: HTMLDivElement | null) => {
    barSlotRef.current = node;
    setBarSlot(node);
  }, []);
  useEffect(() => {
    if (decisionStatus === undefined || scrolledToDecision.current) return;
    scrolledToDecision.current = true;
    if (primaryActionOf(decisionStatus) === undefined && !needsDecision(decisionStatus)) return;
    // O jsdom dos testes não tem scrollIntoView.
    const block = decisionRef.current;
    if (block !== null && typeof block.scrollIntoView === 'function') {
      block.scrollIntoView({ block: 'nearest' });
    }
    // O cabeçalho fixo cobre o alto do corpo, e o navegador não o conta: se o topo do bloco ficou por baixo
    // dele, desce o bloco até a borda do cabeçalho.
    if (block !== null) revealDecision(block, barSlotRef.current);
  }, [decisionStatus]);

  /** Toda ação nova apaga a falha da anterior, esteja ela no bloco ou no cabeçalho. */
  const clearErrors = () => {
    setActionError(null);
    setHeaderError(null);
  };

  /**
   * Roda uma ação da missão, marcando `pending` enquanto ela não volta. Falha vira mensagem na tela (por
   * padrão a do bloco da decisão; `setError` escolhe onde ela cai), e a visão é buscada de novo em
   * qualquer caso.
   */
  async function execute(
    action: () => Promise<AppResult<unknown>>,
    setPending: (pending: boolean) => void,
    failureText: (error: AppError) => string = (error) => error.message,
    setError: (message: string | null) => void = setActionError,
  ): Promise<boolean> {
    setPending(true);
    clearErrors();
    let ok = false;
    try {
      const result = await action();
      if (result.ok) {
        ok = true;
      } else {
        setError(failureText(result.error));
      }
    } catch {
      setError(GENERIC_ERROR);
    }
    setPending(false);
    await reload();
    return ok;
  }

  /** Chamada longa: início, decisão, resposta, nova tentativa e planejamento. */
  const run = (action: () => Promise<AppResult<unknown>>) => execute(action, setBusy);
  /**
   * Planeja a missão (Orquestrar). Gasta a cota do Claude, então só roda num clique. Sem instrução, a
   * chamada leva só o id da missão. A falha aparece no bloco "Sua decisão", junto do botão.
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
  /**
   * "Criar e orquestrar": a missão nasce em rascunho e abre com `state.orchestrate`. Na primeira visão pronta, se
   * ela ainda está em rascunho, o planejamento roda uma vez, como um clique no Orquestrar (a pessoa clicou para
   * isso no formulário). O estado sai da rota logo, para voltar ou recarregar não planejar de novo.
   */
  const orchestrateRequested =
    typeof location.state === 'object' &&
    location.state !== null &&
    (location.state as { orchestrate?: unknown }).orchestrate === true;
  const orchestrateConsumed = useRef(false);
  useEffect(() => {
    if (!orchestrateRequested || orchestrateConsumed.current || decisionStatus === undefined)
      return;
    orchestrateConsumed.current = true;
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    );
    if (decisionStatus === 'draft') void runPlan();
  });

  /** Edição de uma tarefa do plano (renomear, remover, mover ou trocar o programa). A falha vai ao painel. */
  async function runEditStep(stepId: string, edit: PlanEditInput) {
    if (planMutation.current) return;
    planMutation.current = true;
    setBusy(true);
    setPlanEditError(null);
    clearErrors();
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
  /** Retomar, no bloco da decisão: não espera a chamada longa terminar. A falha vai ao bloco. */
  const runResume = () =>
    execute(() => window.projectHub.missions.resume(missionId), setControlBusy);
  /** Pausar e cancelar, no menu do cabeçalho: não esperam a chamada longa. A falha vai ao cabeçalho. */
  const runHeaderControl = (action: () => Promise<AppResult<unknown>>) =>
    execute(action, setControlBusy, (error) => error.message, setHeaderError);

  /**
   * Exclui a missão encerrada e volta à lista de missões do projeto. Fora do `execute`: quando dá certo,
   * não há visão para recarregar, então a página só troca de rota. Falha fica na tela, e a visão é buscada
   * de novo.
   */
  async function removeMission(projectId: string) {
    setControlBusy(true);
    clearErrors();
    try {
      const result = await window.projectHub.missions.delete(missionId);
      if (result.ok) {
        window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
        navigate(projectPath(projectId));
        return;
      }
      setHeaderError(result.error.message);
    } catch {
      setHeaderError(GENERIC_ERROR);
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

  const { mission, project, events, steps, executions, conclusion } = state.view;
  const hasWorktree = mission.worktreePath !== undefined;
  const decisionShown = showsDecision(mission.status, conclusion !== undefined);

  const main = (
    <>
      {/*
        O cabeçalho e as falhas dele formam um grupo fixo no alto do corpo (`mission-top`): ao rolar, o
        cabeçalho continua à vista. Num grupo só porque o CSS não sabe a altura do cabeçalho, que muda com o
        título, o objetivo e a largura da janela. No fim do grupo fica o encaixe da barra de decisão, vazio
        até o bloco "Sua decisão" rolar para trás do cabeçalho.
      */}
      <div className="mission-top">
        <div className="mission-top__body">
          <MissionSummary
            mission={mission}
            project={project}
            controlBusy={controlBusy}
            onPause={() => void runHeaderControl(() => window.projectHub.missions.pause(missionId))}
            onCancel={() =>
              void runHeaderControl(() => window.projectHub.missions.cancel(missionId))
            }
            onDelete={() => void removeMission(project.id)}
          />
          {headerError === null ? null : (
            <p role="alert" className="page-alert">
              {headerError}
            </p>
          )}
          {reloadError === null ? null : (
            <p role="alert" className="page-alert">
              {reloadError}
            </p>
          )}
        </div>
        <div className="decision-bar-slot" ref={setBarSlotNode} />
      </div>
      {/*
        "Sua decisão", no fluxo do corpo, inteiro e sem rolagem própria, logo depois do grupo fixo. O
        invólucro é o mesmo com ou sem decisão: só a classe muda, e o bloco dentro dele nunca é remontado
        (a região de anúncio precisa existir antes de a decisão chegar). Com decisão, ele fica à vista
        (`mission-decision`). Sem decisão, `visually-hidden` o tira da tela e do fluxo, e o leitor de tela
        segue ouvindo a região de anúncio.
      */}
      <div
        className={decisionShown ? 'mission-decision' : 'visually-hidden'}
        data-decision={decisionShown ? 'pending' : 'idle'}
      >
        <DecisionBlock
          view={state.view}
          busy={busy}
          planning={planning}
          controlBusy={controlBusy}
          error={actionError ?? undefined}
          onGeneratePlan={() => void runPlan()}
          onApprovePlan={() => void run(() => window.projectHub.missions.approvePlan(missionId))}
          onRequestNewPlan={(instruction) => void runPlan(instruction)}
          onStart={() => void runStart()}
          onResume={() => void runResume()}
          onRetry={() => void run(() => window.projectHub.missions.retry(missionId))}
          onDecide={(approvalId, decision) =>
            void run(() => window.projectHub.approvals.decide({ approvalId, decision }))
          }
          onAnswer={(text) =>
            run(() => window.projectHub.missions.provideInput({ missionId, text }))
          }
          onApproveReview={() =>
            void run(() => window.projectHub.missions.approveReview(missionId))
          }
          onRequestChanges={(text) =>
            run(() => window.projectHub.missions.requestChanges({ missionId, feedback: text }))
          }
          decisionRef={decisionRef}
          answerRef={answerRef}
          barSlot={decisionShown ? barSlot : null}
        />
      </div>
      <PlanPanel
        mission={mission}
        steps={steps}
        busy={busy}
        planning={planning}
        error={planEditError ?? undefined}
        onEditStep={(stepId, edit) => void runEditStep(stepId, edit)}
      />
      <TokenUsage executions={executions} steps={steps} />
    </>
  );

  return (
    <div className="mission-page">
      <MissionBottomPanel
        main={main}
        tab={tab}
        onTabChange={setTab}
        diff={diffSummary}
        events={events}
        changedFiles={<ChangedFiles hasWorktree={hasWorktree} summary={diffSummary} />}
        panels={{
          conversation: <ConversationPanel view={state.view} />,
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
        }}
      />
    </div>
  );
}
