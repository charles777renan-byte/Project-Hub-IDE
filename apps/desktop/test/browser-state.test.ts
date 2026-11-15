import type { BrowserStateDto, BrowserTabDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { composeBrowserState } from '../src/main/browser/browser-state';

// O estado que a tela recebe: as abas da pessoa e, depois, as dos agentes do projeto.

function tab(id: string, owner: 'person' | 'agent'): BrowserTabDto {
  return {
    id,
    url: `http://localhost:1/${id}`,
    title: id,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    owner,
    ...(owner === 'agent' ? { terminalTitle: 'Claude Code · app' } : {}),
  };
}

const PERSON: BrowserStateDto = {
  projectId: 'p1',
  tabs: [tab('a', 'person'), tab('b', 'person')],
  activeTabId: 'b',
};

function agent(tabs: BrowserTabDto[], looking: string | null = null) {
  const asked: string[] = [];
  return {
    asked,
    tabsOf(projectId: string) {
      asked.push(projectId);
      return tabs;
    },
    lookingAt: () => looking,
  };
}

describe('composeBrowserState', () => {
  it('sem abas de agente, devolve o estado da pessoa como veio', () => {
    expect(composeBrowserState(PERSON, agent([]))).toBe(PERSON);
  });

  it('as abas da pessoa vêm primeiro, depois as do agente, cada uma com o seu dono', () => {
    const fake = agent([tab('g1', 'agent'), tab('g2', 'agent')]);
    const state = composeBrowserState(PERSON, fake);
    expect(state.tabs.map((item) => [item.id, item.owner])).toEqual([
      ['a', 'person'],
      ['b', 'person'],
      ['g1', 'agent'],
      ['g2', 'agent'],
    ]);
    expect(state.tabs[2]?.terminalTitle).toBe('Claude Code · app');
    // A ativa segue a da pessoa enquanto ela não olha uma aba de agente.
    expect(state.activeTabId).toBe('b');
    expect(state.projectId).toBe('p1');
    expect(fake.asked).toEqual(['p1']);
    // O estado da pessoa não é alterado.
    expect(PERSON.tabs).toHaveLength(2);
  });

  it('a aba de agente que a pessoa olha é a ativa', () => {
    const state = composeBrowserState(PERSON, agent([tab('g1', 'agent')], 'g1'));
    expect(state.activeTabId).toBe('g1');
  });

  it('olhar para uma aba de agente que já fechou não vale: a ativa volta a ser a da pessoa', () => {
    const state = composeBrowserState(PERSON, agent([tab('g1', 'agent')], 'sumiu'));
    expect(state.activeTabId).toBe('b');
  });
});
