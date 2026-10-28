import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  addProjectInputSchema,
  CHANNELS,
  ERROR_CODES,
  responseSchemas,
  setProjectGroupInputSchema,
  setProjectNicknameInputSchema,
  type AppError,
  type AppResult,
  type ErrorCode,
  type ProjectHubApi,
  type ProjectSummary,
} from '../src/index';

describe('addProjectInputSchema', () => {
  it('recusa caminho vazio', () => {
    expect(addProjectInputSchema.safeParse({ path: '' }).success).toBe(false);
  });

  it('aceita caminho absoluto do Windows', () => {
    expect(addProjectInputSchema.safeParse({ path: 'C:\\Projetos\\app' }).success).toBe(true);
  });

  it.each([{}, { path: 123 }, { path: null }, null, 'C:\\Projetos\\app'])(
    'recusa payload que não é um objeto com path em texto: %j',
    (payload) => {
      expect(addProjectInputSchema.safeParse(payload).success).toBe(false);
    },
  );
});

describe('setProjectGroupInputSchema', () => {
  it('aceita grupo de 40 caracteres, contando depois de aparar os espaços', () => {
    expect(
      setProjectGroupInputSchema.safeParse({ projectId: 'p1', group: `  ${'x'.repeat(40)}  ` })
        .success,
    ).toBe(true);
  });

  it('recusa grupo com mais de 40 caracteres', () => {
    expect(
      setProjectGroupInputSchema.safeParse({ projectId: 'p1', group: 'x'.repeat(41) }).success,
    ).toBe(false);
  });

  it('aceita nulo, que tira o projeto do grupo', () => {
    expect(setProjectGroupInputSchema.safeParse({ projectId: 'p1', group: null }).success).toBe(
      true,
    );
  });
});

describe('setProjectNicknameInputSchema', () => {
  it('aceita apelido de 24 caracteres, contando depois de aparar os espaços', () => {
    const parsed = setProjectNicknameInputSchema.safeParse({
      projectId: 'p1',
      nickname: `  ${'x'.repeat(24)}  `,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.nickname).toBe('x'.repeat(24));
  });

  it('recusa apelido com mais de 24 caracteres', () => {
    expect(
      setProjectNicknameInputSchema.safeParse({ projectId: 'p1', nickname: 'x'.repeat(25) })
        .success,
    ).toBe(false);
  });

  it('aceita nulo, que tira o apelido', () => {
    expect(
      setProjectNicknameInputSchema.safeParse({ projectId: 'p1', nickname: null }).success,
    ).toBe(true);
  });
});

describe('CHANNELS', () => {
  // As tarefas seguintes acrescentam canais, então o teste confere presença, não igualdade.
  it('inclui os canais da seção 13.4 e da Tarefa 2', () => {
    expect(Object.values(CHANNELS)).toEqual(
      expect.arrayContaining([
        'app:ping:v1',
        'projects:list:v1',
        'projects:add:v1',
        'projects:choose-directory:v1',
      ]),
    );
  });

  it('inclui os canais de workspace e de provedores', () => {
    expect(Object.values(CHANNELS)).toEqual(
      expect.arrayContaining([
        'workspaces:list:v1',
        'workspaces:open:v1',
        'workspaces:close:v1',
        'workspaces:save-layout:v1',
        'workspaces:start-session:v1',
        'workspaces:end-session:v1',
        'workspaces:add-pane:v1',
        'workspaces:remove-pane:v1',
        'providers:list:v1',
      ]),
    );
  });

  it('inclui o canal de atividade, só de leitura', () => {
    expect(Object.values(CHANNELS)).toContain('activity:daily:v1');
  });

  it('todo canal tem versão no nome e nenhum se repete', () => {
    const channels = Object.values(CHANNELS);
    for (const channel of channels) {
      expect(channel).toMatch(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:v[1-9]\d*$/);
    }
    expect(new Set(channels).size).toBe(channels.length);
  });
});

describe('ERROR_CODES', () => {
  it('inclui todos os códigos da seção 13.7', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        'PROJECT_NOT_FOUND',
        'PROJECT_PATH_UNAVAILABLE',
        'PROJECT_ALREADY_EXISTS',
        'GIT_NOT_AVAILABLE',
        'GIT_DIRTY_BASE_REQUIRES_DECISION',
        'WORKTREE_COLLISION',
        'WORKTREE_CREATE_FAILED',
        'MISSION_INVALID_STATE',
        'AGENT_UNAVAILABLE',
        'AGENT_AUTH_REQUIRED',
        'AGENT_PROTOCOL_ERROR',
        'APPROVAL_REQUIRED',
        'APPROVAL_EXPIRED',
        'PROCESS_START_FAILED',
        'PERMISSION_DENIED',
        'PATH_OUTSIDE_ALLOWED_SCOPE',
        'DATABASE_MIGRATION_FAILED',
      ]),
    );
  });

  it('acrescenta os códigos da Tarefa 2', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        'WORKTREE_HAS_UNSAVED_CHANGES',
        'PROJECT_WITHOUT_GIT',
        'VALIDATION_FAILED',
        'UNKNOWN',
      ]),
    );
  });

  it('acrescenta os códigos de missão e de aprovação da Tarefa 9', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining(['MISSION_NOT_FOUND', 'APPROVAL_NOT_FOUND']),
    );
  });

  it('acrescenta o código de capacidade do agente da Tarefa 10b', () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining(['AGENT_CAPABILITY_UNSUPPORTED']));
  });

  it('acrescenta os códigos de terminal da Tarefa 4', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        'TERMINAL_NOT_FOUND',
        'TERMINAL_ALREADY_EXISTS',
        'TERMINAL_EXITED',
        'TERMINAL_HOST_UNAVAILABLE',
      ]),
    );
  });

  it('acrescenta o código de trava do Git do plano de travas', () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining(['GIT_LOCKED']));
  });

  it('não repete códigos', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

// Estas conferências de tipo valem para o `tsc` (pnpm typecheck), que inclui a pasta test.
// O Vitest só as executa como chamadas vazias.
describe('tipos públicos', () => {
  it('AppError tem código, mensagem, detalhes opcionais e retryable', () => {
    expectTypeOf<AppError>().toEqualTypeOf<{
      code: ErrorCode;
      message: string;
      details?: Record<string, unknown>;
      retryable: boolean;
    }>();
  });

  it('AppResult<T> é a união discriminada por ok', () => {
    expectTypeOf<AppResult<number>>().toEqualTypeOf<
      { ok: true; data: number } | { ok: false; error: AppError }
    >();
  });

  it('ProjectSummary segue a seção Interfaces da Tarefa 2', () => {
    expectTypeOf<ProjectSummary>().toEqualTypeOf<{
      id: string;
      name: string;
      path: string;
      repositoryKind: 'git' | 'none';
      available: boolean;
      defaultBranch?: string | undefined;
      group?: string | undefined;
      nickname?: string | undefined;
    }>();
  });

  it('addProjectInputSchema é um ZodObject com path em texto', () => {
    expectTypeOf(addProjectInputSchema).toExtend<z.ZodObject<{ path: z.ZodString }>>();
    expectTypeOf<z.infer<typeof addProjectInputSchema>>().toEqualTypeOf<{ path: string }>();
  });

  it('ErrorCode aceita os códigos novos e recusa texto qualquer', () => {
    expectTypeOf<
      | 'AGENT_UNAVAILABLE'
      | 'AGENT_PROTOCOL_ERROR'
      | 'WORKTREE_HAS_UNSAVED_CHANGES'
      | 'PROJECT_WITHOUT_GIT'
      | 'VALIDATION_FAILED'
      | 'UNKNOWN'
    >().toExtend<ErrorCode>();
    expectTypeOf<string>().not.toExtend<ErrorCode>();
  });
});

describe('responseSchemas', () => {
  it('tem um schema de resposta para cada canal de pedido, e só para eles', () => {
    // Os canais de eventos vão do processo principal ao renderer e não têm resposta (R165).
    const eventChannels: string[] = [
      CHANNELS.missionsEvent,
      CHANNELS.missionsUsage,
      CHANNELS.limitsEvent,
      CHANNELS.terminalsEvent,
    ];
    const requestChannels = Object.values(CHANNELS).filter((c) => !eventChannels.includes(c));
    expect(Object.keys(responseSchemas).sort()).toEqual(requestChannels.sort());
  });

  it('aceita a lista de projetos no formato AppResult', () => {
    const project = {
      id: 'p1',
      name: 'app',
      path: 'C:\\Projetos\\app',
      repositoryKind: 'none',
      available: true,
    };
    expect(
      responseSchemas[CHANNELS.projectsList].safeParse({ ok: true, data: [project] }).success,
    ).toBe(true);
  });

  it('recusa a lista quando um projeto não tem o campo available', () => {
    const { available: _available, ...withoutAvailable } = {
      id: 'p1',
      name: 'app',
      path: 'C:\\Projetos\\app',
      repositoryKind: 'none',
      available: true,
    };
    expect(
      responseSchemas[CHANNELS.projectsList].safeParse({ ok: true, data: [withoutAvailable] })
        .success,
    ).toBe(false);
  });

  it('recusa falha cujo código não está em ERROR_CODES', () => {
    const response = { ok: false, error: { code: 'INVENTADO', message: 'x', retryable: false } };
    expect(responseSchemas[CHANNELS.projectsAdd].safeParse(response).success).toBe(false);
  });

  it('recusa resposta sem o envelope ok', () => {
    expect(responseSchemas[CHANNELS.appPing].safeParse('pong').success).toBe(false);
  });

  it('aceita escolha de pasta cancelada (null) e escolhida ({ path })', () => {
    const schema = responseSchemas[CHANNELS.projectsChooseDirectory];
    expect(schema.safeParse({ ok: true, data: null }).success).toBe(true);
    expect(schema.safeParse({ ok: true, data: { path: 'C:\\Projetos\\app' } }).success).toBe(true);
  });
});

describe('ProjectHubApi', () => {
  it('projects.add recebe { path } e devolve o resumo do projeto', () => {
    expectTypeOf<ProjectHubApi['projects']['add']>().parameter(0).toEqualTypeOf<{ path: string }>();
    expectTypeOf<ProjectHubApi['projects']['add']>().returns.toEqualTypeOf<
      Promise<AppResult<ProjectSummary>>
    >();
  });

  it('projects.list e projects.chooseDirectory devolvem AppResult', () => {
    expectTypeOf<ProjectHubApi['projects']['list']>().returns.toEqualTypeOf<
      Promise<AppResult<ProjectSummary[]>>
    >();
    expectTypeOf<ProjectHubApi['projects']['chooseDirectory']>().returns.toEqualTypeOf<
      Promise<AppResult<{ path: string } | null>>
    >();
  });
});

describe('package.json', () => {
  it('o pacote não depende de electron', () => {
    // new URL(..., import.meta.url) não depende do diretório em que o Vitest roda (raiz ou pacote).
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(manifest) as Record<string, Record<string, string> | undefined>;
    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      expect(pkg[section]?.electron).toBeUndefined();
    }
  });
});
