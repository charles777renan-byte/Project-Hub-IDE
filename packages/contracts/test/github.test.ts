import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  ERROR_CODES,
  checkSchema,
  commentSchema,
  githubCommentInputSchema,
  githubMergeInputSchema,
  githubOpenUrlInputSchema,
  githubPanelSchema,
  githubProjectInputSchema,
  prResultSchema,
  prSummarySchema,
  responseSchemas,
} from '../src/index';

/**
 * Saída real de `gh pr view 47 --json number,title,state,isDraft,mergeable,mergeStateStatus,url,updatedAt,
 * headRefName,baseRefName,additions,deletions,statusCheckRollup,comments,reviewDecision`, num PR mesclado
 * deste repositório. Tem 7 `CheckRun`. Nenhum PR do repositório tem `StatusContext` nem comentário, então
 * esses dois casos são SINTÉTICOS (escritos à mão, no formato documentado do `gh`), e vêm marcados abaixo.
 */
const rawUrl = new URL('./fixtures/gh-pr-view.json', import.meta.url);
const raw = JSON.parse(readFileSync(rawUrl, 'utf8')) as RawPr;

type RawCheck = Record<string, unknown> & { __typename: string };
type RawPr = Record<string, unknown> & {
  statusCheckRollup: RawCheck[];
  comments: { author: { login: string }; body: string; createdAt: string }[];
};

/** Troca mínima da saída do `gh` pelo contrato; o adaptador (`parse-pr`) faz o mesmo de verdade. */
function toSummary(source: RawPr): unknown {
  const { statusCheckRollup: _checks, comments: _comments, ...rest } = source;
  return { ...rest, reviewDecision: rest['reviewDecision'] === '' ? null : rest['reviewDecision'] };
}

function toCheck(source: RawCheck): unknown {
  if (source.__typename === 'StatusContext') {
    return {
      kind: 'status-context',
      name: source['context'],
      state: source['state'],
      targetUrl: source['targetUrl'] ?? null,
      startedAt: source['startedAt'] ?? null,
    };
  }
  return {
    kind: 'check-run',
    name: source['name'],
    workflowName: source['workflowName'] || null,
    status: source['status'],
    conclusion: source['conclusion'] || null,
    startedAt: source['startedAt'] ?? null,
    completedAt: source['completedAt'] ?? null,
    detailsUrl: source['detailsUrl'] ?? null,
  };
}

/** Caso SINTÉTICO: `StatusContext` no formato do `gh` (nenhum PR do repositório tem um). */
const syntheticStatusContext: RawCheck = {
  __typename: 'StatusContext',
  context: 'ci/externo',
  state: 'PENDING',
  targetUrl: 'https://example.com/ci/externo/1',
  startedAt: '2026-11-03T20:49:00Z',
};

/** Caso SINTÉTICO: comentário no formato do `gh` (nenhum PR do repositório tem comentário). */
const syntheticComment = {
  author: { login: 'charles777renan-byte' },
  body: 'Pode mesclar.',
  createdAt: '2026-11-03T21:00:00Z',
};

describe('prSummarySchema com a saída real do gh', () => {
  it('aceita o resumo do PR 47', () => {
    const parsed = prSummarySchema.parse(toSummary(raw));
    expect(parsed.number).toBe(47);
    expect(parsed.state).toBe('MERGED');
    expect(parsed.reviewDecision).toBeNull();
  });

  it.each([
    ['número zero', { number: 0 }],
    ['número fracionário', { number: 1.5 }],
    ['estado desconhecido', { state: 'DRAFT' }],
    ['mesclável desconhecido', { mergeable: 'MAYBE' }],
    ['linhas negativas', { additions: -1 }],
    ['URL inválida', { url: 'não é url' }],
    ['decisão vazia (o adaptador converte para null)', { reviewDecision: '' }],
  ])('recusa %s', (_nome, campo) => {
    expect(prSummarySchema.safeParse({ ...(toSummary(raw) as object), ...campo }).success).toBe(
      false,
    );
  });

  it.each(['OPEN', 'MERGED', 'CLOSED'])('aceita o estado %s', (state) => {
    expect(prSummarySchema.safeParse({ ...(toSummary(raw) as object), state }).success).toBe(true);
  });
});

describe('checkSchema', () => {
  it('aceita cada CheckRun real, com kind check-run', () => {
    expect(raw.statusCheckRollup).toHaveLength(7);
    for (const item of raw.statusCheckRollup) {
      const parsed = checkSchema.parse(toCheck(item));
      expect(parsed.kind).toBe('check-run');
    }
  });

  it('aceita uma lista mista de CheckRun e StatusContext (StatusContext sintético)', () => {
    const lista = [...raw.statusCheckRollup.slice(0, 2), syntheticStatusContext].map(toCheck);
    const parsed = lista.map((item) => checkSchema.parse(item));
    expect(parsed.map((check) => check.kind)).toEqual(['check-run', 'check-run', 'status-context']);
  });

  it('aceita CheckRun ainda em andamento, sem conclusão', () => {
    const emAndamento = {
      kind: 'check-run',
      name: 'Windows (testes)',
      workflowName: 'CI',
      status: 'IN_PROGRESS',
      conclusion: null,
      startedAt: '2026-11-03T20:48:30Z',
      completedAt: null,
      detailsUrl: null,
    };
    expect(checkSchema.safeParse(emAndamento).success).toBe(true);
  });

  it.each([
    ['kind desconhecido', { kind: 'outro' }],
    ['status desconhecido', { kind: 'check-run', status: 'DONE' }],
    ['conclusão desconhecida', { kind: 'check-run', conclusion: 'OK' }],
    ['estado de StatusContext desconhecido', { kind: 'status-context', state: 'SUCCEEDED' }],
  ])('recusa %s', (_nome, campo) => {
    const base = toCheck(raw.statusCheckRollup[0] as RawCheck) as object;
    const contexto = toCheck(syntheticStatusContext) as object;
    const origem = campo.kind === 'status-context' ? contexto : base;
    expect(checkSchema.safeParse({ ...origem, ...campo }).success).toBe(false);
  });
});

describe('commentSchema', () => {
  it('aceita um comentário (sintético) no formato do gh', () => {
    const parsed = commentSchema.parse({
      author: syntheticComment.author.login,
      body: syntheticComment.body,
      createdAt: syntheticComment.createdAt,
    });
    expect(parsed.author).toBe('charles777renan-byte');
  });

  it('a lista de comentários real do PR 47 está vazia', () => {
    expect(raw.comments).toEqual([]);
  });

  it('recusa comentário sem autor', () => {
    expect(commentSchema.safeParse({ body: 'x', createdAt: '2026-11-03T21:00:00Z' }).success).toBe(
      false,
    );
  });
});

describe('prResultSchema e githubPanelSchema', () => {
  const reading = {
    pr: toSummary(raw),
    checks: [...raw.statusCheckRollup, syntheticStatusContext].map(toCheck),
    comments: [
      { author: 'charles777renan-byte', body: 'Pode mesclar.', createdAt: '2026-11-03T21:00:00Z' },
    ],
    readAt: '2026-11-03T21:05:00Z',
  };

  it('aceita a leitura ok', () => {
    const ok = prResultSchema.safeParse({ state: 'ok', reading });
    expect(ok.success).toBe(true);
  });

  it('aceita a leitura stale com a última leitura e o erro', () => {
    const stale = {
      state: 'stale',
      reading,
      error: { code: 'GH_NETWORK_FAILED', message: 'Sem conexão.', retryable: true },
    };
    expect(prResultSchema.safeParse(stale).success).toBe(true);
  });

  it('recusa stale sem a última leitura, ou com código de erro fora da lista', () => {
    const error = { code: 'GH_NETWORK_FAILED', message: 'Sem conexão.', retryable: true };
    expect(prResultSchema.safeParse({ state: 'stale', error }).success).toBe(false);
    expect(
      prResultSchema.safeParse({
        state: 'stale',
        reading,
        error: { ...error, code: 'GH_INVENTADO' },
      }).success,
    ).toBe(false);
  });

  it('a resposta do painel aceita pr, no-pr e not-applicable, e recusa kind desconhecido', () => {
    expect(
      githubPanelSchema.safeParse({ kind: 'pr', result: { state: 'ok', reading } }).success,
    ).toBe(true);
    expect(githubPanelSchema.safeParse({ kind: 'no-pr' }).success).toBe(true);
    expect(githubPanelSchema.safeParse({ kind: 'not-applicable' }).success).toBe(true);
    expect(githubPanelSchema.safeParse({ kind: 'outro' }).success).toBe(false);
  });
});

describe('entradas dos canais github', () => {
  it('githubProjectInputSchema pede só o projeto', () => {
    expect(githubProjectInputSchema.safeParse({ projectId: 'p1' }).success).toBe(true);
    expect(githubProjectInputSchema.safeParse({ projectId: '' }).success).toBe(false);
  });

  it('githubCommentInputSchema preserva o início do comentário e apara só o final', () => {
    const parse = (body: string) =>
      githubCommentInputSchema.parse({ projectId: 'p1', prNumber: 47, body }).body;
    expect(parse('  ok  ')).toBe('  ok');
    expect(parse('    código\n')).toBe('    código');
    expect(parse('\n\n    bloco\n    de código \t\n')).toBe('\n\n    bloco\n    de código');
  });

  it('o limite de 65 536 caracteres vale para o texto enviado, sem o espaço do final', () => {
    const at = (body: string) =>
      githubCommentInputSchema.safeParse({ projectId: 'p1', prNumber: 47, body }).success;
    expect(at('a'.repeat(65_536))).toBe(true);
    expect(at(`${'a'.repeat(65_536)}   \n`)).toBe(true);
    expect(at(`  ${'a'.repeat(65_536)}`)).toBe(false);
  });

  it.each([
    ['corpo vazio', { body: '' }],
    ['corpo só com espaços', { body: '   ' }],
    ['corpo longo demais', { body: 'a'.repeat(65_537) }],
  ])('githubCommentInputSchema recusa %s', (_nome, campo) => {
    expect(
      githubCommentInputSchema.safeParse({ ...{ projectId: 'p1', prNumber: 47 }, ...campo })
        .success,
    ).toBe(false);
  });

  it.each([
    ['zero', 0],
    ['negativo', -3],
    ['fracionário', 1.5],
    ['texto numérico', '47'],
    ['NaN', Number.NaN],
    ['infinito', Number.POSITIVE_INFINITY],
    ['nulo', null],
    ['opção de linha de comando', '--admin'],
  ])('recusa número de PR %s, no comentário e no merge', (_nome, prNumber) => {
    expect(
      githubCommentInputSchema.safeParse({ projectId: 'p1', prNumber, body: 'ok' }).success,
    ).toBe(false);
    expect(
      githubMergeInputSchema.safeParse({ projectId: 'p1', prNumber, method: 'squash' }).success,
    ).toBe(false);
  });

  it.each(['merge', 'squash', 'rebase'])('githubMergeInputSchema aceita o método %s', (method) => {
    expect(
      githubMergeInputSchema.safeParse({ projectId: 'p1', prNumber: 47, method }).success,
    ).toBe(true);
  });

  it.each(['', 'fast-forward', 'admin', '--squash'])(
    'githubMergeInputSchema recusa o método %j',
    (method) => {
      expect(
        githubMergeInputSchema.safeParse({ projectId: 'p1', prNumber: 47, method }).success,
      ).toBe(false);
    },
  );
});

describe('githubOpenUrlInputSchema', () => {
  it('aceita um texto de URL e recusa o que não é texto ou passa do limite', () => {
    expect(githubOpenUrlInputSchema.safeParse({ url: 'https://github.com/a/b' }).success).toBe(
      true,
    );
    expect(githubOpenUrlInputSchema.safeParse({ url: '' }).success).toBe(true);
    expect(githubOpenUrlInputSchema.safeParse({ url: 3 }).success).toBe(false);
    expect(githubOpenUrlInputSchema.safeParse({}).success).toBe(false);
    expect(githubOpenUrlInputSchema.safeParse({ url: 'x'.repeat(4097) }).success).toBe(false);
  });
});

describe('canais e erros do GitHub', () => {
  it('os três canais têm nome versionado', () => {
    expect(CHANNELS.githubPr).toBe('github:pr:v1');
    expect(CHANNELS.githubComment).toBe('github:comment:v1');
    expect(CHANNELS.githubMerge).toBe('github:merge:v1');
    expect(CHANNELS.githubOpenUrl).toBe('github:open-url:v1');
  });

  it('cada canal tem resposta no formato AppResult', () => {
    expect(
      responseSchemas[CHANNELS.githubPr].safeParse({ ok: true, data: { kind: 'no-pr' } }).success,
    ).toBe(true);
    expect(
      responseSchemas[CHANNELS.githubPr].safeParse({ ok: true, data: { kind: 'x' } }).success,
    ).toBe(false);
    expect(
      responseSchemas[CHANNELS.githubComment].safeParse({ ok: true, data: undefined }).success,
    ).toBe(true);
    expect(
      responseSchemas[CHANNELS.githubMerge].safeParse({ ok: true, data: undefined }).success,
    ).toBe(true);
    expect(
      responseSchemas[CHANNELS.githubOpenUrl].safeParse({ ok: true, data: undefined }).success,
    ).toBe(true);
  });

  it('acrescenta os códigos de erro do GitHub', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        'GH_NOT_AVAILABLE',
        'GH_NOT_AUTHENTICATED',
        'GH_NETWORK_FAILED',
        'GH_PR_NOT_FOUND',
        'GH_PR_NOT_MERGEABLE',
      ]),
    );
  });
});
