import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prReadingSchema } from '@project-hub/contracts';
import { assertGithubUrl, parsePullRequest, parsePullRequestNumber } from '../src/parse-pr';

/**
 * Saída real de `gh pr view 47 --json ...` num PR mesclado deste repositório (7 `CheckRun`, sem comentário).
 * O `StatusContext` e o comentário abaixo são SINTÉTICOS (escritos à mão, no formato documentado do `gh`):
 * nenhum PR do repositório tem um. Os demais desvios (enums novos, tipos desconhecidos) também são sintéticos.
 */
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/gh-pr-view.json', import.meta.url), 'utf8'),
) as Record<string, unknown> & { statusCheckRollup: Record<string, unknown>[] };

const READ_AT = '2026-11-03T21:30:00.000Z';

/** Caso SINTÉTICO: `StatusContext` no formato do `gh`. */
const syntheticStatusContext = {
  __typename: 'StatusContext',
  context: 'ci/externo',
  state: 'PENDING',
  targetUrl: 'https://example.com/ci/externo/1',
  startedAt: '2026-11-03T20:49:00Z',
};

/** Caso SINTÉTICO: comentário no formato do `gh`. */
const syntheticComment = {
  author: { login: 'charles777renan-byte' },
  body: 'Pode mesclar.\n\n<img src=x onerror=alert(1)>',
  createdAt: '2026-11-03T21:00:00Z',
};

function parse(overrides: Record<string, unknown> = {}) {
  return parsePullRequest(JSON.stringify({ ...fixture, ...overrides }), READ_AT);
}

describe('parsePullRequest com a saída real do gh', () => {
  it('lê o resumo do PR mesclado', () => {
    const { pr } = parse();

    expect(pr).toEqual({
      number: 47,
      title: 'feat(desktop): redesenha a Visão geral do Início em colunas',
      state: 'MERGED',
      isDraft: false,
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
      url: 'https://github.com/charles777renan-byte/Project-Hub-IDE/pull/47',
      updatedAt: '2026-11-03T20:53:49Z',
      headRefName: 'feat/inicio-visao-geral-redesenho',
      baseRefName: 'main',
      additions: 1657,
      deletions: 261,
      reviewDecision: null,
    });
  });

  it('lê os 7 checks como check-run, com a conclusão e as datas', () => {
    const { checks } = parse();

    expect(checks).toHaveLength(7);
    expect(checks[0]).toEqual({
      kind: 'check-run',
      name: 'Windows (lint, tipos, build)',
      workflowName: 'CI',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      startedAt: '2026-11-03T20:48:30Z',
      completedAt: '2026-11-03T20:50:47Z',
      detailsUrl:
        'https://github.com/charles777renan-byte/Project-Hub-IDE/actions/runs/41715947027/job/126195831318',
    });
    expect(checks.every((check) => check.kind === 'check-run')).toBe(true);
  });

  it('sem comentários, a lista é vazia, e a leitura carrega a hora recebida', () => {
    const reading = parse();

    expect(reading.comments).toEqual([]);
    expect(reading.readAt).toBe(READ_AT);
  });

  it('o resultado passa pelo schema do contrato', () => {
    expect(prReadingSchema.safeParse(parse()).success).toBe(true);
  });
});

describe('parsePullRequest com lista mista de checks e comentários (sintéticos)', () => {
  const inProgress = {
    __typename: 'CheckRun',
    name: 'Windows (e2e)',
    workflowName: 'CI',
    status: 'IN_PROGRESS',
    conclusion: '',
    startedAt: '2026-11-03T20:49:00Z',
    completedAt: '0001-01-01T00:00:00Z',
    detailsUrl: '',
  };
  const failed = {
    ...fixture.statusCheckRollup[0],
    name: 'Windows (lint)',
    conclusion: 'FAILURE',
  };

  it('mistura CheckRun concluído, em andamento, com falha e StatusContext, separados por `kind`', () => {
    const { checks } = parse({
      statusCheckRollup: [fixture.statusCheckRollup[0], inProgress, failed, syntheticStatusContext],
    });

    expect(checks.map((check) => check.kind)).toEqual([
      'check-run',
      'check-run',
      'check-run',
      'status-context',
    ]);
    expect(checks[1]).toMatchObject({
      status: 'IN_PROGRESS',
      conclusion: null,
      completedAt: null,
      detailsUrl: null,
    });
    expect(checks[2]).toMatchObject({ status: 'COMPLETED', conclusion: 'FAILURE' });
    expect(checks[3]).toEqual({
      kind: 'status-context',
      name: 'ci/externo',
      state: 'PENDING',
      targetUrl: 'https://example.com/ci/externo/1',
      startedAt: '2026-11-03T20:49:00Z',
    });
  });

  it('check sem workflow, sem data e sem endereço vira null nesses campos', () => {
    const { checks } = parse({
      statusCheckRollup: [{ __typename: 'CheckRun', name: 'x', status: 'QUEUED', conclusion: '' }],
    });

    expect(checks[0]).toEqual({
      kind: 'check-run',
      name: 'x',
      workflowName: null,
      status: 'QUEUED',
      conclusion: null,
      startedAt: null,
      completedAt: null,
      detailsUrl: null,
    });
  });

  it('lê o comentário, com o corpo como veio (texto não confiável, sem tratamento)', () => {
    const { comments } = parse({ comments: [syntheticComment] });

    expect(comments).toEqual([
      {
        author: 'charles777renan-byte',
        body: 'Pode mesclar.\n\n<img src=x onerror=alert(1)>',
        createdAt: '2026-11-03T21:00:00Z',
      },
    ]);
  });

  it('comentário de usuário apagado (autor null) fica com o autor "ghost"', () => {
    const { comments } = parse({ comments: [{ ...syntheticComment, author: null }] });

    expect(comments[0]?.author).toBe('ghost');
  });

  it('sem statusCheckRollup nem comments (PR sem checks), as listas são vazias', () => {
    const { checks, comments } = parse({ statusCheckRollup: null, comments: undefined });

    expect(checks).toEqual([]);
    expect(comments).toEqual([]);
  });

  it('reviewDecision conhecido passa como veio', () => {
    expect(parse({ reviewDecision: 'APPROVED' }).pr.reviewDecision).toBe('APPROVED');
    expect(parse({ reviewDecision: 'CHANGES_REQUESTED' }).pr.reviewDecision).toBe(
      'CHANGES_REQUESTED',
    );
  });
});

describe('parsePullRequest normaliza valores que o contrato não conhece (R13)', () => {
  it('state, mergeable e mergeStateStatus desconhecidos viram CLOSED, UNKNOWN e UNKNOWN', () => {
    const { pr } = parse({ state: 'SUSPENDED', mergeable: 'MAYBE', mergeStateStatus: 'NEW_VALUE' });

    expect(pr).toMatchObject({
      state: 'CLOSED',
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
    });
  });

  it('um state desconhecido nunca vira OPEN (não liberaria o merge)', () => {
    expect(parse({ state: 'REOPENING', mergeable: 'MERGEABLE' }).pr.state).not.toBe('OPEN');
    expect(parse({ state: 42 }).pr.state).toBe('CLOSED');
    expect(parse({ state: undefined }).pr.state).toBe('CLOSED');
  });

  it('reviewDecision desconhecido vira null', () => {
    expect(parse({ reviewDecision: 'SOMETHING_ELSE' }).pr.reviewDecision).toBeNull();
  });

  it('o gh em minúsculas é reconhecido', () => {
    const { pr } = parse({ state: 'open', mergeable: 'mergeable' });

    expect(pr).toMatchObject({ state: 'OPEN', mergeable: 'MERGEABLE' });
  });

  it('status de check desconhecido vira PENDING, e conclusão desconhecida vira ACTION_REQUIRED (nunca sucesso)', () => {
    const { checks } = parse({
      statusCheckRollup: [
        { ...fixture.statusCheckRollup[0], status: 'TELEPORTING' },
        { ...fixture.statusCheckRollup[0], conclusion: 'NEW_CONCLUSION' },
      ],
    });

    expect(checks[0]).toMatchObject({ status: 'PENDING', conclusion: 'SUCCESS' });
    expect(checks[1]).toMatchObject({ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' });
  });

  it('estado desconhecido de um status antigo vira PENDING', () => {
    const { checks } = parse({
      statusCheckRollup: [{ ...syntheticStatusContext, state: 'GALACTIC' }],
    });

    expect(checks[0]).toMatchObject({ kind: 'status-context', state: 'PENDING' });
  });

  it('item de tipo desconhecido aparece como status pendente, em vez de sumir', () => {
    const { checks } = parse({
      statusCheckRollup: [
        { __typename: 'FutureThing', name: 'novo-tipo' },
        { foo: 'sem tipo nem nome' },
        'texto solto',
      ],
    });

    expect(checks).toEqual([
      {
        kind: 'status-context',
        name: 'novo-tipo',
        state: 'PENDING',
        targetUrl: null,
        startedAt: null,
      },
      {
        kind: 'status-context',
        name: 'Check desconhecido',
        state: 'PENDING',
        targetUrl: null,
        startedAt: null,
      },
    ]);
  });

  it('additions e deletions inválidos viram 0', () => {
    const { pr } = parse({ additions: -3, deletions: 'muitas' });

    expect(pr).toMatchObject({ additions: 0, deletions: 0 });
  });
});

describe('host do PR (github.com)', () => {
  it.each([
    'https://ghe.example.com/org/repo/pull/47',
    'https://github.com.exemplo.com/org/repo/pull/47',
    'https://exemplo.com/github.com/org/repo/pull/47',
    'http://github.com/org/repo/pull/47',
    'https://usuario@github.com/org/repo/pull/47',
    'https://usuario:senha@github.com/org/repo/pull/47',
    'https://github.com:8443/org/repo/pull/47',
    'https://api.github.com/org/repo/pull/47',
    'github.com/org/repo/pull/47',
    '',
  ])('recusa %j com GH_NOT_AVAILABLE e mensagem de repositório não suportado', (url) => {
    expect(() => parse({ url })).toThrowError(
      expect.objectContaining({
        name: 'GhError',
        code: 'GH_NOT_AVAILABLE',
        message: expect.stringContaining('não é do github.com') as unknown,
      }) as Error,
    );
  });

  it('recusa PR sem url', () => {
    expect(() => parse({ url: undefined })).toThrowError(
      expect.objectContaining({ code: 'GH_NOT_AVAILABLE' }) as Error,
    );
  });

  it('aceita github.com em outra caixa (o host é normalizado)', () => {
    expect(assertGithubUrl('https://GitHub.com/org/repo/pull/1')).toBe(
      'https://GitHub.com/org/repo/pull/1',
    );
  });
});

describe('saída inesperada do gh', () => {
  it.each([
    ['texto que não é JSON', 'isto não é JSON'],
    ['vazio', ''],
    ['um array', '[]'],
    ['null', 'null'],
    ['sem número', JSON.stringify({ ...fixture, number: undefined })],
    ['número inválido', JSON.stringify({ ...fixture, number: -4 })],
    ['número fracionário', JSON.stringify({ ...fixture, number: 1.5 })],
  ])('%s vira UNKNOWN com mensagem fixa, sem o texto do gh', (_name, stdout) => {
    expect(() => parsePullRequest(stdout, READ_AT)).toThrowError(
      expect.objectContaining({
        name: 'GhError',
        code: 'UNKNOWN',
        message: 'O GitHub CLI devolveu dados que o Project Hub não entendeu.',
      }) as Error,
    );
  });
});

describe('parsePullRequestNumber', () => {
  const list = (...items: { number: number; isCrossRepository: boolean }[]) =>
    JSON.stringify(items);

  it('só PR local: devolve o número dele', () => {
    expect(parsePullRequestNumber(list({ number: 47, isCrossRepository: false }))).toBe(47);
  });

  it('PR de fork antes do PR local: devolve o número do PR local', () => {
    expect(
      parsePullRequestNumber(
        list(
          { number: 99, isCrossRepository: true },
          { number: 47, isCrossRepository: false },
          { number: 12, isCrossRepository: false },
        ),
      ),
    ).toBe(47);
  });

  it('só PR de fork: a branch não tem PR (null)', () => {
    expect(
      parsePullRequestNumber(
        list({ number: 99, isCrossRepository: true }, { number: 98, isCrossRepository: true }),
      ),
    ).toBeNull();
  });

  it('lista vazia: a branch não tem PR', () => {
    expect(parsePullRequestNumber('[]')).toBeNull();
  });

  it.each([
    '',
    'não é json',
    '{}',
    '[{}]',
    '[null]',
    '[{"number":47}]',
    '[{"isCrossRepository":false}]',
    '[{"number":0,"isCrossRepository":false}]',
    '[{"number":1.5,"isCrossRepository":false}]',
    '[{"number":"47","isCrossRepository":false}]',
    '[{"number":47,"isCrossRepository":"false"}]',
    '[{"number":47,"isCrossRepository":null}]',
    '[{"number":47,"isCrossRepository":false},{"number":5}]',
  ])('recusa %j com UNKNOWN', (stdout) => {
    expect(() => parsePullRequestNumber(stdout)).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN' }) as Error,
    );
  });
});
