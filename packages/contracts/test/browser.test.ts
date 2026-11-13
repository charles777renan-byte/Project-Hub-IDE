import { describe, expect, it } from 'vitest';
import {
  BROWSER_ADDRESS_MAX,
  BROWSER_ERROR_MESSAGES,
  BROWSER_TAB_LIMIT,
  CHANNELS,
  browserBoundsInputSchema,
  browserNavigateInputSchema,
  browserShortcutEventSchema,
  browserStateSchema,
  responseSchemas,
} from '../src/index';

const tab = {
  id: 't',
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
};

describe('contratos do navegador', () => {
  it('o limite de abas é 8', () => {
    expect(BROWSER_TAB_LIMIT).toBe(8);
  });

  it('recusa retângulo com número não finito', () => {
    const bad = { projectId: 'p', bounds: { x: 0, y: 0, width: Infinity, height: 10 } };
    expect(browserBoundsInputSchema.safeParse(bad).success).toBe(false);
  });

  it('recusa retângulo com largura negativa', () => {
    const bad = { projectId: 'p', bounds: { x: 0, y: 0, width: -1, height: 10 } };
    expect(browserBoundsInputSchema.safeParse(bad).success).toBe(false);
  });

  it('aceita "escondido"', () => {
    expect(browserBoundsInputSchema.safeParse({ projectId: 'p', bounds: null }).success).toBe(true);
  });

  it('aceita endereço vazio e recusa acima do limite', () => {
    const base = { projectId: 'p', tabId: 't' };
    expect(browserNavigateInputSchema.safeParse({ ...base, text: '' }).success).toBe(true);
    const text = 'a'.repeat(BROWSER_ADDRESS_MAX + 1);
    expect(browserNavigateInputSchema.safeParse({ ...base, text }).success).toBe(false);
  });

  it('tem resposta para cada canal de pedido do navegador', () => {
    const requests = Object.entries(CHANNELS)
      .filter(
        ([key]) =>
          key.startsWith('browser') && key !== 'browserChanged' && key !== 'browserShortcut',
      )
      .map(([, channel]) => channel);
    expect(requests).toHaveLength(15);
    for (const channel of requests) expect(responseSchemas).toHaveProperty([channel]);
  });

  it('o estado aceita uma aba sem erro', () => {
    const state = { projectId: 'p', tabs: [tab], activeTabId: 't' };
    expect(browserStateSchema.safeParse(state).success).toBe(true);
  });

  it('o estado recusa código de erro desconhecido', () => {
    const broken = { ...tab, error: { code: 'NOPE', message: 'x' } };
    const state = { projectId: 'p', tabs: [broken], activeTabId: 't' };
    expect(browserStateSchema.safeParse(state).success).toBe(false);
  });

  it('o evento de atalho só aceita as três ações do app', () => {
    const ok = { projectId: 'p', action: 'focus-address' };
    expect(browserShortcutEventSchema.safeParse(ok).success).toBe(true);
    expect(browserShortcutEventSchema.safeParse({ ...ok, action: 'reload' }).success).toBe(false);
  });

  it('a mensagem de servidor recusado fala do servidor local', () => {
    expect(BROWSER_ERROR_MESSAGES.REFUSED).toBe(
      'O servidor recusou a conexão. Se for o seu servidor local, veja se ele está rodando.',
    );
  });
});
