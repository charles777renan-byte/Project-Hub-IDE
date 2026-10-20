import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { AppResult, MissionViewDto } from '@project-hub/contracts';
import { ConversationPanel } from '../components/ConversationPanel';
import { PlanPanel } from '../components/PlanPanel';
import { StatusChip } from '../components/StatusChip';
import { Tabs, type TabItem } from '../components/Tabs';
import {
  MISSION_TEXT,
  canRetry,
  isEnded,
  needsDecisionInConversation,
  statusLabel,
  statusTone,
} from '../mission-text';
import { projectPath } from '../routes';

type MissionTab = 'plan' | 'conversation' | 'terminal' | 'diff' | 'tests' | 'logs' | 'artifacts';

/** Abas do workspace da missão (seção 10.7). Só Plano e Conversa têm conteúdo nesta etapa. */
const TABS: readonly TabItem<MissionTab>[] = [
  { id: 'plan', label: 'Plano' },
  { id: 'conversation', label: 'Conversa' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'diff', label: 'Diff' },
  { id: 'tests', label: 'Testes' },
  { id: 'logs', label: 'Logs' },
  { id: 'artifacts', label: 'Artefatos' },
];

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; view: MissionViewDto }
  | { status: 'error'; message: string };

/**
 * Workspace de uma missão (seção 10.7, R168). Cabeçalho com título, situação e as ações (pausar,
 * retomar, tentar de novo e cancelar); as abas, e a conversa e o plano com ação. A visão vem do
 * processo principal e é buscada de novo a cada ação e a cada evento da missão (R165). Uma resposta
 * antiga, que chega depois de uma mais nova, não substitui a tela.
 *
 * A aba começa na Conversa quando a missão espera a decisão da pessoa (R182). Enquanto a pessoa não
 * escolhe uma aba, a escolha segue a situação. A Conversa fica montada quando não está visível, para
 * que a resposta não enviada não se perca.
 */
export function MissionPage() {
  const { projectId = '', missionId = '' } = useParams();
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  /** Aba que a pessoa escolheu. `null` enquanto ela não escolheu: vale a aba da situação. */
  const [chosenTab, setChosenTab] = useState<MissionTab | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    let next: ViewState;
    try {
      const result = await window.projectHub.missions.get(missionId);
      next = result.ok
        ? { status: 'ready', view: result.data }
        : { status: 'error', message: result.error.message };
    } catch {
      next = { status: 'error', message: GENERIC_ERROR };
    }
    if (request === latestRequest.current) setState(next);
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

  /** Roda uma ação da missão. Falha vira mensagem na tela, e a visão é buscada de novo em qualquer caso. */
  async function run(action: () => Promise<AppResult<unknown>>): Promise<boolean> {
    setBusy(true);
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
    setBusy(false);
    await reload();
    return ok;
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

  const { mission, project } = state.view;
  const tab: MissionTab =
    chosenTab ?? (needsDecisionInConversation(mission.status) ? 'conversation' : 'plan');
  return (
    <>
      <p className="eyebrow">
        <Link to={projectPath(projectId)}>{project.name}</Link>
      </p>
      <header className="mission-header">
        <h1>{mission.title}</h1>
        <div className="inline-actions">
          <StatusChip label={statusLabel(mission.status)} tone={statusTone(mission.status)} />
          {mission.status === 'running' ? (
            <button
              type="button"
              className="btn-outline"
              disabled={busy}
              onClick={() => void run(() => window.projectHub.missions.pause(missionId))}
            >
              {MISSION_TEXT.pause}
            </button>
          ) : null}
          {mission.status === 'paused' ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void run(() => window.projectHub.missions.resume(missionId))}
            >
              {MISSION_TEXT.resume}
            </button>
          ) : null}
          {canRetry(mission.status) ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void run(() => window.projectHub.missions.retry(missionId))}
            >
              {MISSION_TEXT.retry}
            </button>
          ) : null}
          {isEnded(mission.status) ? null : (
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => void run(() => window.projectHub.missions.cancel(missionId))}
            >
              Cancelar missão
            </button>
          )}
        </div>
        {needsDecisionInConversation(mission.status) ? (
          <p className="mission-notice">
            <StatusChip label={MISSION_TEXT.decisionNotice} tone="violet" />
            <button type="button" className="btn-link" onClick={() => setChosenTab('conversation')}>
              {MISSION_TEXT.decisionLink}
            </button>
          </p>
        ) : null}
        <p className="mission-meta">
          {project.name} · branch {project.defaultBranch ?? 'sem Git'} · worktree{' '}
          {mission.worktreePath ?? 'ainda não criado'}
        </p>
      </header>

      {actionError === null ? null : (
        <p role="alert" className="page-alert">
          {actionError}
        </p>
      )}

      <Tabs
        label="Seções da missão"
        tabs={TABS}
        active={tab}
        onChange={(id) => setChosenTab(id)}
        filled
      />
      <div role="tabpanel" id="tab-panel" aria-labelledby={`tab-${tab}`}>
        {tab === 'plan' ? (
          <PlanPanel
            mission={mission}
            steps={state.view.steps}
            busy={busy}
            onGeneratePlan={() => void run(() => window.projectHub.missions.plan(missionId))}
            onApprovePlan={() => void run(() => window.projectHub.missions.approvePlan(missionId))}
            onRequestNewPlan={() => void run(() => window.projectHub.missions.plan(missionId))}
            onStart={() => void run(() => window.projectHub.missions.start(missionId))}
          />
        ) : null}
        <div hidden={tab !== 'conversation'}>
          <ConversationPanel
            view={state.view}
            busy={busy}
            onDecide={(approvalId, decision) =>
              void run(() => window.projectHub.approvals.decide({ approvalId, decision }))
            }
            onAnswer={(text) =>
              run(() => window.projectHub.missions.provideInput({ missionId, text }))
            }
          />
        </div>
        {tab !== 'plan' && tab !== 'conversation' ? (
          <p className="page-note">Disponível na próxima etapa.</p>
        ) : null}
      </div>
    </>
  );
}
