import type { MissionViewDto } from '@project-hub/contracts';
import { conversationEvents } from '../mission-text';
import { Timeline } from './Timeline';

/**
 * Aba Conversa do painel inferior da missão (seção 10.7): só a história da missão em linguagem simples.
 * O detalhe técnico (ferramentas, worktree, tentativas) fica nos Logs. As decisões (aprovações, resposta
 * ao agente e revisão da conclusão) moram no bloco "Sua decisão", no corpo da missão.
 */
export function ConversationPanel({ view }: { view: MissionViewDto }) {
  return (
    <section aria-label="Conversa da missão" className="workspace-panel">
      <Timeline events={conversationEvents(view.events)} />
    </section>
  );
}
