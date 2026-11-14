import { describe, expect, it, vi } from 'vitest';
import {
  requestShowTerminal,
  SHOW_TERMINAL_EVENT,
  showTerminalRequest,
} from '../../src/renderer/right-panel-events';

describe('pedido de mostrar um terminal', () => {
  it('requestShowTerminal dispara o evento com o projeto e o terminal', () => {
    const heard = vi.fn();
    const listener = (event: Event) => heard(showTerminalRequest(event));
    window.addEventListener(SHOW_TERMINAL_EVENT, listener);

    requestShowTerminal('p1', 'term-1');

    window.removeEventListener(SHOW_TERMINAL_EVENT, listener);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ projectId: 'p1', terminalId: 'term-1' });
  });

  it.each([
    ['evento sem detalhe', new Event(SHOW_TERMINAL_EVENT)],
    ['detalhe que não é objeto', new CustomEvent(SHOW_TERMINAL_EVENT, { detail: 'term-1' })],
    ['sem terminal', new CustomEvent(SHOW_TERMINAL_EVENT, { detail: { projectId: 'p1' } })],
    [
      'ids vazios',
      new CustomEvent(SHOW_TERMINAL_EVENT, { detail: { projectId: '', terminalId: '' } }),
    ],
    [
      'ids que não são texto',
      new CustomEvent(SHOW_TERMINAL_EVENT, { detail: { projectId: 1, terminalId: 2 } }),
    ],
  ])('showTerminalRequest devolve null para %s', (_label, event) => {
    expect(showTerminalRequest(event)).toBeNull();
  });
});
