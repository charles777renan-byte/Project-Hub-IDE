import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { claudeFolderOf, jsonl, writeText } from './atividade-agentes';

// As sessões que a aba Sessões lê nos três programas, escritas nos formatos reais deles dentro das pastas de teste
// (nunca as da pessoa). Os horários são relativos a agora, para a lista cair sempre na janela do teste. Ficam no
// código e não em arquivos estáticos porque o caminho do projeto e a data mudam a cada rodada, e o `.zst` sai de
// `zlib` na hora.

/** Ids fixos: o teste acha cada sessão pelo texto dela; o id só precisa ser um UUID válido. */
export const SESSION_IDS = {
  claudeLogin: '11111111-1111-4111-8111-111111111111',
  claudeSemResposta: '22222222-2222-4222-8222-222222222222',
  codexMenu: '33333333-3333-4333-8333-333333333333',
  codexIlegivel: '44444444-4444-4444-8444-444444444444',
  antigravityTema: '55555555-5555-4555-8555-555555555555',
  antigravityImagem: '66666666-6666-4666-8666-666666666666',
} as const;

/** Um texto de sessão que parece HTML: tem de aparecer como texto, sem criar a imagem nem rodar o `onerror`. */
export const PAYLOAD = '<img src=x onerror="window.__xss = 1">';

/** Um instante `hours` horas atrás de agora: os horários das sessões ficam sempre dentro da janela da lista. */
function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export type SeedRoots = {
  /** A pasta do projeto no disco: é o `cwd` que as sessões gravam, e por ela a aba as liga ao projeto. */
  projectPath: string;
  /** `PROJECT_HUB_CLAUDE_DIR`: a pasta de dados do Claude Code de teste. */
  claudeConfigDir: string;
  /** `PROJECT_HUB_CODEX_HOME`: a pasta do Codex de teste. */
  codexHome: string;
  /** `PROJECT_HUB_AGY_HISTORY`: o `history.jsonl` do Antigravity de teste. */
  antigravityHistory: string;
};

/**
 * Cinco sessões em quatro arquivos e três programas, mais um arquivo que não se lê:
 *  - Claude: "Corrige o login com Google" (com resposta e um subagente) e "Organiza a pasta de testes" (sem resposta);
 *  - Codex: "Revisa o menu de terminais" (comprimida em zstd) e um `.jsonl.zst` corrompido, que conta como ilegível;
 *  - Antigravity: "Ajusta o tema escuro" (sem comando de retomada) e um texto com HTML que tem de aparecer como texto.
 *  Um comando de barra do Antigravity fica de fora, como manda a leitura.
 */
export function seedSessions(roots: SeedRoots): void {
  const { projectPath, claudeConfigDir, codexHome, antigravityHistory } = roots;

  // Claude Code: `projects/<pasta>/<sessão>.jsonl`. Cada linha leva o `sessionId` e o `cwd` da pasta real.
  const claudeDir = join(claudeConfigDir, 'projects', claudeFolderOf(projectPath));
  const claude = (sessionId: string) => ({ sessionId, cwd: projectPath });
  writeText(
    join(claudeDir, `${SESSION_IDS.claudeLogin}.jsonl`),
    jsonl(
      {
        ...claude(SESSION_IDS.claudeLogin),
        type: 'user',
        timestamp: hoursAgo(3).toISOString(),
        message: { role: 'user', content: 'Corrige o login com Google' },
      },
      {
        ...claude(SESSION_IDS.claudeLogin),
        type: 'assistant',
        timestamp: hoursAgo(2).toISOString(),
        message: {
          id: 'msg-login',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: 'Pronto, o login voltou a funcionar' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
    ),
  );
  // O subagente: um `agent-*.jsonl` na pasta da sessão. A aba conta o arquivo, não o lê como sessão.
  writeText(
    join(claudeDir, SESSION_IDS.claudeLogin, 'subagents', 'agent-1.jsonl'),
    jsonl({
      ...claude(SESSION_IDS.claudeLogin),
      isSidechain: true,
      agentId: 'agent-1',
      type: 'user',
      timestamp: hoursAgo(2.5).toISOString(),
      message: { role: 'user', content: 'Procura a tela de login' },
    }),
  );
  writeText(
    join(claudeDir, `${SESSION_IDS.claudeSemResposta}.jsonl`),
    jsonl({
      ...claude(SESSION_IDS.claudeSemResposta),
      type: 'user',
      timestamp: hoursAgo(1).toISOString(),
      message: { role: 'user', content: 'Organiza a pasta de testes' },
    }),
  );

  // Codex: `sessions/AAAA/MM/DD/rollout-*.jsonl[.zst]`, do dia de hoje.
  const today = new Date();
  const dayFolder = join(
    codexHome,
    'sessions',
    String(today.getFullYear()),
    pad(today.getMonth() + 1),
    pad(today.getDate()),
  );
  const stamp = today.toISOString().slice(0, 19).replace(/:/g, '-');
  const menuAt = hoursAgo(4).toISOString();
  const menuReplyAt = hoursAgo(3).toISOString();
  const menu = jsonl(
    {
      type: 'session_meta',
      timestamp: menuAt,
      payload: { id: SESSION_IDS.codexMenu, cwd: projectPath, timestamp: menuAt },
    },
    { type: 'turn_context', timestamp: menuAt, payload: { model: 'gpt-5-codex' } },
    {
      type: 'event_msg',
      timestamp: menuAt,
      payload: {
        type: 'item_completed',
        item: {
          type: 'UserMessage',
          content: [{ type: 'input_text', text: 'Revisa o menu de terminais' }],
        },
      },
    },
    {
      type: 'event_msg',
      timestamp: menuReplyAt,
      payload: {
        type: 'item_completed',
        item: {
          type: 'AgentMessage',
          content: [{ type: 'output_text', text: 'Revisei o menu de terminais' }],
        },
      },
    },
  );
  // O `.zst` é binário: cria a pasta do dia e grava com `writeFileSync` (o `writeText` só serve para texto).
  mkdirSync(dayFolder, { recursive: true });
  writeFileSync(
    join(dayFolder, `rollout-${stamp}-${SESSION_IDS.codexMenu}.jsonl.zst`),
    zstdCompressSync(Buffer.from(menu, 'utf8')),
  );
  writeFileSync(
    join(dayFolder, `rollout-${stamp}-${SESSION_IDS.codexIlegivel}.jsonl.zst`),
    Buffer.from('isto nao e zstd', 'utf8'),
  );

  // Antigravity: um só `history.jsonl`, uma sessão por conversa, com o horário em milissegundos.
  const ms = (hours: number) => hoursAgo(hours).getTime();
  writeText(
    antigravityHistory,
    jsonl(
      {
        conversationId: SESSION_IDS.antigravityTema,
        workspace: projectPath,
        timestamp: ms(5),
        display: 'Ajusta o tema escuro',
      },
      {
        conversationId: SESSION_IDS.antigravityTema,
        workspace: projectPath,
        timestamp: ms(4),
        display: 'Confere o contraste',
      },
      {
        type: 'slash_command',
        conversationId: SESSION_IDS.antigravityTema,
        workspace: projectPath,
        timestamp: ms(4),
        display: '/help',
      },
      {
        conversationId: SESSION_IDS.antigravityImagem,
        workspace: projectPath,
        timestamp: ms(2),
        display: PAYLOAD,
      },
    ),
  );
}
