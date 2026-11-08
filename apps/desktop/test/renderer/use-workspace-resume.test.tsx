import { act, renderHook } from '@testing-library/react';
import type { LayoutNode, ProjectHubApi, WorkspaceDto } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from '../../src/renderer/workspace/use-workspace';
import {
  RESUME_NEEDS_WORKSPACE,
  RESUME_SESSION_REQUEST_EVENT,
  requestResumeSession,
  type ResumeSessionRequest,
} from '../../src/renderer/workspaces-events';

/** Retomar em Worktree: a ponte da janela (evento) até o `useWorkspace` do projeto, que adota o layout novo. */

const SESSION = '22222222-2222-2222-2222-222222222222';

function dois(): LayoutNode {
  return {
    type: 'split',
    id: 'raiz',
    direction: 'row',
    ratio: 0.5,
    first: { type: 'leaf', id: 'a', provider: 'claude', terminalId: 't1' },
    second: { type: 'leaf', id: 'b', provider: 'shell', terminalId: null },
  };
}

/** Os dois de antes mais o painel novo `c`, que a retomada cria. */
function tres(): LayoutNode {
  return {
    type: 'split',
    id: 'raiz',
    direction: 'row',
    ratio: 0.5,
    first: { type: 'leaf', id: 'a', provider: 'claude', terminalId: 't1' },
    second: {
      type: 'split',
      id: 'r2',
      direction: 'column',
      ratio: 0.5,
      first: { type: 'leaf', id: 'b', provider: 'shell', terminalId: null },
      second: { type: 'leaf', id: 'c', provider: 'codex', terminalId: 't2' },
    },
  };
}

function dto(layout: LayoutNode, projectId = 'p1'): WorkspaceDto {
  return {
    id: `w-${projectId}`,
    projectId,
    layout,
    position: 0,
    lastActiveAt: '2026-11-07T10:00:00.000Z',
  };
}

const workspaces = {
  open: vi.fn(),
  saveLayout: vi.fn(),
};
const sessions = { resume: vi.fn() };

beforeEach(() => {
  workspaces.open.mockReset().mockImplementation(async (id: string) => ({
    ok: true,
    data: dto(dois(), id),
  }));
  workspaces.saveLayout.mockReset().mockResolvedValue({ ok: true, data: undefined });
  sessions.resume.mockReset();
  window.projectHub = { workspaces, sessions } as unknown as ProjectHubApi;
});

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

async function mount(projectId = 'p1') {
  const view = renderHook(() => useWorkspace(projectId));
  await act(async () => {});
  return view;
}

describe('resumeSession (ponte da janela)', () => {
  it('manda só o workspace e o id da sessão, e o painel novo fica ativo com foco', async () => {
    sessions.resume.mockResolvedValue({ ok: true, data: dto(tres()) });
    const { result } = await mount();
    let outcome: string | null = 'x';
    await act(async () => {
      outcome = await result.current.resumeSession(SESSION);
    });
    expect(sessions.resume).toHaveBeenCalledTimes(1);
    expect(sessions.resume).toHaveBeenCalledWith({ workspaceId: 'w-p1', sessionId: SESSION });
    expect(outcome).toBeNull();
    expect(result.current.activeLeafId).toBe('c');
    expect(result.current.focusLeafId).toBe('c');
  });

  it('erro do IPC devolve o texto e não muda o layout', async () => {
    sessions.resume.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Sessão sem pasta' },
    });
    const { result } = await mount();
    const before = result.current.state;
    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.resumeSession(SESSION);
    });
    expect(outcome).toBe('Sessão sem pasta');
    expect(result.current.state).toBe(before);
    expect(result.current.activeLeafId).toBe('a');
  });

  it('pedido que lança devolve um texto de erro', async () => {
    sessions.resume.mockRejectedValue(new Error('boom'));
    const { result } = await mount();
    let outcome: string | null = null;
    await act(async () => {
      outcome = await result.current.resumeSession(SESSION);
    });
    expect(outcome).toBe('Não foi possível concluir o pedido. Tente de novo.');
  });
});

describe('requestResumeSession (evento da janela)', () => {
  it('o workspace do projeto certo responde; o de outro projeto não', async () => {
    sessions.resume.mockResolvedValue({ ok: true, data: dto(tres()) });
    const { result } = await mount('p1');
    let outcome: Promise<string | null> = Promise.resolve('x');
    await act(async () => {
      outcome = requestResumeSession('p2', SESSION);
    });
    expect(await outcome).toBe(RESUME_NEEDS_WORKSPACE);
    expect(sessions.resume).not.toHaveBeenCalled();

    await act(async () => {
      outcome = requestResumeSession('p1', SESSION);
      await outcome;
    });
    expect(await outcome).toBeNull();
    expect(sessions.resume).toHaveBeenCalledWith({ workspaceId: 'w-p1', sessionId: SESSION });
    expect(result.current.activeLeafId).toBe('c');
  });

  it('sem a aba Terminais aberta, devolve o aviso para abri-la', async () => {
    const outcome = await requestResumeSession('p1', SESSION);
    expect(outcome).toBe(RESUME_NEEDS_WORKSPACE);
  });

  it('o ouvinte sai quando o workspace é desmontado', async () => {
    const { unmount } = await mount('p1');
    unmount();
    const seen: ResumeSessionRequest[] = [];
    const spy = (event: Event) => seen.push((event as CustomEvent<ResumeSessionRequest>).detail);
    window.addEventListener(RESUME_SESSION_REQUEST_EVENT, spy);
    try {
      const outcome = await requestResumeSession('p1', SESSION);
      expect(outcome).toBe(RESUME_NEEDS_WORKSPACE);
      expect(seen).toHaveLength(1);
      expect(sessions.resume).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(RESUME_SESSION_REQUEST_EVENT, spy);
    }
  });
});
