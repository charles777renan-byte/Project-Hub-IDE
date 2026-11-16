import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Quem está por trás de uma chamada ao navegador: o terminal do agente e o projeto dele. */
export type AgentIdentity = { terminalId: string; projectId: string };

export type AgentTokens = {
  /** Um token novo para o terminal. Um segundo `issue` do mesmo terminal revoga o primeiro. */
  issue(identity: AgentIdentity): string;
  resolve(token: string): AgentIdentity | undefined;
  revoke(terminalId: string): void;
  has(terminalId: string): boolean;
  clear(): void;
};

const TOKEN_BYTES = 32;

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Os tokens do navegador dos agentes: um por terminal, só na memória do processo principal. O registro guarda o
 * SHA-256 do token, não o token, e é dele que sai o projeto de cada chamada: nenhuma ferramenta recebe um id de
 * projeto. A comparação é em tempo constante sobre os resumos, que têm sempre o mesmo tamanho.
 */
export function createAgentTokens(random: (bytes: number) => Buffer = randomBytes): AgentTokens {
  const byTerminal = new Map<string, { hash: Buffer; identity: AgentIdentity }>();

  return {
    issue(identity) {
      const token = random(TOKEN_BYTES).toString('base64url');
      byTerminal.set(identity.terminalId, { hash: digest(token), identity: { ...identity } });
      return token;
    },
    resolve(token) {
      if (token === '') return undefined;
      const wanted = digest(token);
      let found: AgentIdentity | undefined;
      // Percorre todos, sem parar no primeiro: o tempo não diz qual terminal casou.
      for (const entry of byTerminal.values()) {
        if (timingSafeEqual(entry.hash, wanted)) found = entry.identity;
      }
      return found === undefined ? undefined : { ...found };
    },
    revoke(terminalId) {
      byTerminal.delete(terminalId);
    },
    has: (terminalId) => byTerminal.has(terminalId),
    clear() {
      byTerminal.clear();
    },
  };
}
