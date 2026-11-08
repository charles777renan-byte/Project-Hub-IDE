import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionDetail } from '../../src/renderer/components/right-panel/SessionDetail';
import { SESSIONS_TEXT } from '../../src/renderer/components/right-panel/sessions-text';
import {
  RESUME_SESSION_REQUEST_EVENT,
  type ResumeSessionRequest,
} from '../../src/renderer/workspaces-events';

/** O detalhe de uma sessão: cabeçalho, primeiro prompt com Copiar, turnos, Retomar com motivo e o "sem dado". */

const ID = '11111111-1111-1111-1111-111111111111';

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: ID,
    provider: 'claude',
    title: 'Corrigir o login',
    folder: 'C:\\trabalho\\auth',
    projectId: 'p1',
    branch: null,
    isWorktree: false,
    startedAt: '2026-11-07T10:00:00.000Z',
    lastActivityAt: '2026-11-07T10:30:00.000Z',
    messages: 4,
    subagents: null,
    model: null,
    firstPrompt: 'Corrige o login com Google',
    lastAgentText: 'Pronto, o login voltou.',
    lastTurns: [
      { role: 'user', text: 'Oi' },
      { role: 'agent', text: 'Pronto' },
    ],
    resumable: true,
    resumeBlockedReason: null,
    ...overrides,
  };
}

/** Escuta o pedido de retomada; `answer` responde como o workspace faria. */
function listen(answer?: string | null) {
  const seen: ResumeSessionRequest[] = [];
  const handler = (event: Event) => {
    const request = (event as CustomEvent<ResumeSessionRequest>).detail;
    seen.push(request);
    if (answer !== undefined) request.answer = Promise.resolve(answer);
  };
  window.addEventListener(RESUME_SESSION_REQUEST_EVENT, handler);
  return {
    seen,
    stop: () => window.removeEventListener(RESUME_SESSION_REQUEST_EVENT, handler),
  };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('SessionDetail', () => {
  it('mostra o cabeçalho, o primeiro prompt com Copiar e os últimos turnos', () => {
    render(<SessionDetail session={session()} projectId="p1" onBack={() => undefined} />);
    expect(screen.getByText(SESSIONS_TEXT.firstPrompt)).toBeInTheDocument();
    expect(screen.getByText('Corrige o login com Google')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SESSIONS_TEXT.copy })).toBeInTheDocument();
    expect(screen.getByText(SESSIONS_TEXT.lastTurns)).toBeInTheDocument();
    expect(screen.getByText('Oi')).toBeInTheDocument();
    expect(screen.getByText('Pronto')).toBeInTheDocument();
  });

  it('Copiar põe o primeiro prompt na área de transferência e confirma', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SessionDetail session={session()} projectId="p1" onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.copy }));
    expect(writeText).toHaveBeenCalledWith('Corrige o login com Google');
    await screen.findByRole('button', { name: SESSIONS_TEXT.copied });
  });

  it('Retomar desligado mostra o motivo ao lado e não envia pedido', () => {
    const spy = listen();
    try {
      render(
        <SessionDetail
          session={session({
            resumable: false,
            resumeBlockedReason: 'A pasta da sessão não existe mais.',
          })}
          projectId="p1"
          onBack={() => undefined}
        />,
      );
      const button = screen.getByRole('button', { name: SESSIONS_TEXT.resume });
      expect(button).toBeDisabled();
      expect(screen.getByText('A pasta da sessão não existe mais.')).toBeInTheDocument();
      fireEvent.click(button);
      expect(spy.seen).toHaveLength(0);
    } finally {
      spy.stop();
    }
  });

  it('Retomar ligado manda o pedido só com o projeto e o id da sessão', () => {
    const spy = listen();
    try {
      render(<SessionDetail session={session()} projectId="p1" onBack={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.resume }));
      expect(spy.seen).toHaveLength(1);
      expect(spy.seen[0]).toEqual({ projectId: 'p1', sessionId: ID });
    } finally {
      spy.stop();
    }
  });

  it('sem projeto aberto, Retomar fica desligado com o aviso para abrir um', () => {
    render(<SessionDetail session={session()} projectId={null} onBack={() => undefined} />);
    expect(screen.getByRole('button', { name: SESSIONS_TEXT.resume })).toBeDisabled();
    expect(screen.getByText(SESSIONS_TEXT.resumeNeedsProject)).toBeInTheDocument();
  });

  it('o erro da retomada aparece no detalhe, em texto de alerta', async () => {
    const spy = listen('Sessão sem pasta');
    try {
      render(<SessionDetail session={session()} projectId="p1" onBack={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.resume }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Sessão sem pasta');
    } finally {
      spy.stop();
    }
  });

  it('Antigravity mostra "sem dado" no último texto e nos turnos, sem sumir com a seção', async () => {
    render(
      <SessionDetail
        session={session({
          provider: 'antigravity',
          title: null,
          lastAgentText: null,
          lastTurns: null,
          resumable: false,
          resumeBlockedReason: 'O Antigravity CLI não tem comando para retomar uma sessão.',
        })}
        projectId="p1"
        onBack={() => undefined}
      />,
    );
    expect(screen.getByText(SESSIONS_TEXT.lastAgentText)).toBeInTheDocument();
    expect(screen.getByText(SESSIONS_TEXT.lastTurns)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(SESSIONS_TEXT.noData)).toHaveLength(2));
  });

  it('o botão voltar chama onBack', () => {
    const onBack = vi.fn();
    render(<SessionDetail session={session()} projectId="p1" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: SESSIONS_TEXT.back }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
