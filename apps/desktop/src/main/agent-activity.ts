import { readFile, stat } from 'node:fs/promises';
import {
  antigravityHistoryFile,
  claudeConfigDirOf,
  codexHomeOf,
  listClaudeTranscripts,
  listCodexSessions,
  localDayOf,
  readAntigravityHistory,
  readClaudeTranscriptActivity,
  readCodexSessionActivity,
  readCodexSessionFile,
  type SessionActivity,
} from '@project-hub/agent-adapters';
import type { AgentActivity, AgentActivityAgent, ProviderInfo } from '@project-hub/contracts';
import {
  linkToApp,
  sumByDay,
  type AppTerminal,
  type MissionTokens,
  type SessionForLink,
} from '@project-hub/domain';
import { buildTerminalEnv } from '../terminal-host/env';

/** Quanto o resultado vale sem reler os arquivos de sessão: 60 s. */
const DEFAULT_CACHE_MS = 60_000;

/** Folga do `linkToApp` antes da criação do terminal; o filtro por data de arquivo usa a mesma. */
const LINK_SLACK_MS = 60_000;

export type AgentActivityDeps = {
  /** Terminais do app com a pasta do projeto (todos, abertos e fechados). */
  terminals(): AppTerminal[];
  /** Tokens das execuções de missão terminadas. */
  missions(): MissionTokens[];
  /** As sessões de um agente que podem ter começado a partir de `sinceIso`, ainda sem ligar ao app. */
  readSessions(agent: string, sinceIso: string): Promise<SessionForLink[]>;
  agents: AgentActivityAgent[];
  /** Instante atual em ISO. */
  now(): string;
  /** Prazo do cache, em ms. Padrão 60 000. */
  cacheMs?: number;
  /** Compara pastas sem diferenciar maiúsculas. Padrão: verdadeiro no Windows. */
  caseInsensitive?: boolean;
};

export type AgentActivityService = { read(): Promise<AgentActivity> };

/**
 * Monta a resposta do canal `activity:agents:v1`: lê as sessões de cada agente que tem leitor e terminal,
 * liga cada uma a um terminal do app (`linkToApp`) e soma por dia, junto com os tokens das missões. O
 * resultado fica em cache por `cacheMs`, e chamadas simultâneas dividem a mesma leitura. Falha ao ler um
 * agente deixa só aquele agente sem dias: falta de dado nunca vira zero.
 */
export function createAgentActivityService(deps: AgentActivityDeps): AgentActivityService {
  const cacheMs = deps.cacheMs ?? DEFAULT_CACHE_MS;
  const caseInsensitive = deps.caseInsensitive ?? process.platform === 'win32';
  let cached: { value: AgentActivity; at: number } | undefined;
  let inflight: Promise<AgentActivity> | undefined;

  async function readAgent(
    agent: AgentActivityAgent,
    terminals: AppTerminal[],
  ): Promise<SessionForLink[]> {
    // Só o agente que tem leitor e terminal do app é lido.
    if (!agent.messagesAvailable) return [];
    const own = terminals.filter((terminal) => terminal.provider === agent.id);
    const since = own.map((terminal) => terminal.createdAt).sort()[0];
    if (since === undefined) return [];
    try {
      return await deps.readSessions(agent.id, since);
    } catch (error) {
      console.error(`Falha ao ler a atividade de ${agent.id}:`, error);
      return [];
    }
  }

  async function compute(): Promise<AgentActivity> {
    const nowIso = deps.now();
    const terminals = deps.terminals();
    const missions = deps.missions();
    const sessions = (
      await Promise.all(deps.agents.map((agent) => readAgent(agent, terminals)))
    ).flat();
    const linked = linkToApp(sessions, terminals, nowIso, caseInsensitive);
    const days = sumByDay(linked, missions);
    // O shell não entra no bloco, então o terminal dele não puxa o início do "Tudo".
    const agentIds = new Set(deps.agents.map((agent) => agent.id));
    const known = [
      ...terminals
        .filter((terminal) => agentIds.has(terminal.provider))
        .map((terminal) => terminal.createdAt),
      ...missions.map((mission) => mission.finishedAt),
    ]
      .map((iso) => localDayOf(iso))
      .filter((day): day is string => day !== undefined)
      .sort();
    return { agents: deps.agents, days, since: known[0] ?? null };
  }

  return {
    read() {
      const at = Date.parse(deps.now());
      if (cached !== undefined && at - cached.at < cacheMs) return Promise.resolve(cached.value);
      if (inflight !== undefined) return inflight;
      const run = compute().then(
        (value) => {
          cached = { value, at };
          inflight = undefined;
          return value;
        },
        (error: unknown) => {
          inflight = undefined;
          throw error;
        },
      );
      inflight = run;
      return run;
    },
  };
}

/**
 * Os agentes do bloco, a partir do registro de provedores. O shell fica de fora. Claude e Codex têm
 * mensagens e tokens; o Antigravity só mensagens (o histórico dele não traz tokens). Agente novo do
 * registro entra com os dois indisponíveis até ganhar leitor.
 */
export function agentActivityAgents(providers: ProviderInfo[]): AgentActivityAgent[] {
  return providers
    .filter((provider) => provider.id !== 'shell')
    .map((provider) => {
      const tokens = provider.id === 'claude' || provider.id === 'codex';
      const messages = tokens || provider.id === 'antigravity';
      return {
        id: provider.id,
        label: provider.label,
        messagesAvailable: messages,
        tokensAvailable: tokens,
      };
    });
}

export type SessionReaderDeps = {
  /** Os terminais do app com a pasta do projeto: dizem onde procurar os transcripts do Claude. */
  terminals(): AppTerminal[];
  /** O ambiente que o terminal recebe (já filtrado): dele saem a pasta do Claude e a do Codex. */
  env: Readonly<Record<string, string | undefined>>;
  /** Histórico do Antigravity. Padrão: `~/.gemini/antigravity-cli/history.jsonl`. */
  antigravityHistory?: string;
};

/** Troca (ou põe) uma variável do ambiente sem diferenciar maiúsculas no nome, como o Windows faz. */
function withVariable(
  env: Record<string, string | undefined>,
  name: string,
  value: string,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  for (const [key, current] of Object.entries(env)) {
    if (key.toUpperCase() !== name) next[key] = current;
  }
  next[name] = value;
  return next;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/**
 * De onde o leitor tira as sessões dos CLIs: o ambiente que os terminais recebem (dele saem a pasta do Claude e a do
 * Codex) e o histórico do Antigravity. Só com `PROJECT_HUB_ENV=test` as variáveis `PROJECT_HUB_CLAUDE_DIR`,
 * `PROJECT_HUB_CODEX_HOME` e `PROJECT_HUB_AGY_HISTORY` trocam essas pastas, para os testes de ponta a ponta nunca
 * lerem as sessões da pessoa; em qualquer outro caso elas não valem. O ambiente que o terminal de verdade
 * recebe não muda: só o do leitor.
 */
export function sessionSourcesOf(
  processEnv: NodeJS.ProcessEnv,
): Pick<SessionReaderDeps, 'env' | 'antigravityHistory'> {
  let env: Record<string, string | undefined> = buildTerminalEnv(processEnv);
  if (processEnv['PROJECT_HUB_ENV'] !== 'test') return { env };

  const claude = nonEmpty(processEnv['PROJECT_HUB_CLAUDE_DIR']);
  if (claude !== undefined) env = withVariable(env, 'CLAUDE_CONFIG_DIR', claude);
  const codex = nonEmpty(processEnv['PROJECT_HUB_CODEX_HOME']);
  if (codex !== undefined) env = withVariable(env, 'CODEX_HOME', codex);
  const history = nonEmpty(processEnv['PROJECT_HUB_AGY_HISTORY']);
  // Com exactOptionalPropertyTypes, a chave ausente fica ausente, e não undefined.
  return history === undefined ? { env } : { env, antigravityHistory: history };
}

/** Cede a vez ao laço de eventos entre um arquivo e outro, para a leitura não travar o processo principal. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/** A meia-noite local do dia anterior ao de `iso`. O `Date` com componentes locais acerta a virada de horário de verão. */
function dayBefore(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).toISOString();
}

/**
 * Leitor das sessões de cada CLI no disco. Cada agente tem o seu formato; o que não existe (CLI nunca
 * usado) devolve lista vazia. A leitura é assíncrona; quem chama decide o que fazer com a falha de um agente.
 */
export function createSessionReader(
  deps: SessionReaderDeps,
): (agent: string, sinceIso: string) => Promise<SessionForLink[]> {
  async function readClaude(sinceIso: string): Promise<SessionActivity[]> {
    const configDir = claudeConfigDirOf(deps.env);
    const folders = [
      ...new Set(
        deps
          .terminals()
          .filter((terminal) => terminal.provider === 'claude')
          .map((terminal) => terminal.folder),
      ),
    ];
    // Transcript sem alteração desde antes do terminal mais antigo não pode ter sessão dele.
    const oldest = Date.parse(sinceIso) - LINK_SLACK_MS;
    const sessions: SessionActivity[] = [];
    for (const folder of folders) {
      for (const file of listClaudeTranscripts(configDir, folder)) {
        try {
          if ((await stat(file)).mtimeMs < oldest) continue;
          const activity = readClaudeTranscriptActivity(await readFile(file, 'utf8'), folder);
          if (activity !== undefined) sessions.push(activity);
        } catch {
          // Arquivo que sumiu ou não abre: aquela sessão fica de fora, as outras seguem.
        }
        await yieldToEventLoop();
      }
    }
    return sessions;
  }

  async function readCodex(sinceIso: string): Promise<SessionActivity[]> {
    // A pasta do dia é a do início da sessão: um dia antes do terminal mais antigo, para não perder
    // a que começou antes da meia-noite e continuou depois.
    const files = listCodexSessions(codexHomeOf(deps.env), dayBefore(sinceIso));
    const sessions: SessionActivity[] = [];
    for (const file of files) {
      try {
        // Por `readCodexSessionFile`, que descomprime as sessões `.zst`; direto do disco elas viram zero.
        const activity = readCodexSessionActivity(readCodexSessionFile(file));
        if (activity !== undefined) sessions.push(activity);
      } catch {
        // Arquivo ilegível ou zstd corrompido: aquela sessão fica de fora, nunca entra como zero.
      }
      await yieldToEventLoop();
    }
    return sessions;
  }

  async function readAntigravity(): Promise<SessionActivity[]> {
    try {
      const text = await readFile(deps.antigravityHistory ?? antigravityHistoryFile(), 'utf8');
      return readAntigravityHistory(text);
    } catch (error) {
      // CLI nunca usado: sem histórico, sem sessões. Qualquer outra falha sobe.
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  return async (agent, sinceIso) => {
    if (agent === 'claude') return readClaude(sinceIso);
    if (agent === 'codex') return readCodex(sinceIso);
    if (agent === 'antigravity') return readAntigravity();
    return [];
  };
}
