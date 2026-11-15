import type { BrowserStateDto } from '@project-hub/contracts';
import type { AgentBrowser } from './agent/agent-browser';

/**
 * O estado que a tela recebe: as abas da pessoa e, depois, as dos agentes do projeto. Se a pessoa olha uma aba de
 * agente, ela é a ativa; a aba ativa da pessoa segue guardada no serviço dela e volta quando ela deixa de olhar.
 * Sem abas de agente, o estado sai como veio.
 */
export function composeBrowserState(
  person: BrowserStateDto,
  agent: Pick<AgentBrowser, 'tabsOf' | 'lookingAt'>,
): BrowserStateDto {
  const agentTabs = agent.tabsOf(person.projectId);
  if (agentTabs.length === 0) return person;
  const looking = agent.lookingAt(person.projectId);
  const watched = looking !== null && agentTabs.some((tab) => tab.id === looking);
  return {
    projectId: person.projectId,
    tabs: [...person.tabs, ...agentTabs],
    activeTabId: watched ? looking : person.activeTabId,
  };
}
