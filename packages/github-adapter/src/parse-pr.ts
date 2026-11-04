import {
  CHECK_RUN_CONCLUSIONS,
  CHECK_RUN_STATUSES,
  PR_MERGEABLE_VALUES,
  PR_MERGE_STATE_STATUSES,
  PR_REVIEW_DECISIONS,
  PR_STATES,
  STATUS_CONTEXT_STATES,
  prNumberSchema,
  prReadingSchema,
  type CheckDto,
  type CommentDto,
  type PrReadingDto,
  type PrSummaryDto,
} from '@project-hub/contracts';
import { GhError, GH_UNSUPPORTED_REPOSITORY_MESSAGE } from './run-gh';

/**
 * Converte a saída JSON do `gh` nos tipos do contrato (`packages/contracts/src/github.ts`). Os enums do
 * contrato são estritos: um valor que o GitHub acrescente amanhã faria a resposta inteira ser recusada. Por
 * isso cada enum é normalizado aqui, antes de montar o resultado, para o valor mais seguro (o que nunca
 * libera um merge nem passa por sucesso):
 *
 * - `state` desconhecido vira `CLOSED`; `mergeable` e `mergeStateStatus` viram `UNKNOWN`;
 * - `reviewDecision` desconhecido ou vazio vira `null`;
 * - `status` de um check desconhecido vira `PENDING`; `conclusion` desconhecida vira `ACTION_REQUIRED`
 *   (precisa de atenção, e não é sucesso); `state` de um status antigo desconhecido vira `PENDING`;
 * - um item do `statusCheckRollup` de tipo desconhecido vira um status `PENDING` com o nome que tiver.
 *
 * Todos os textos (título, nome de check, comentário) seguem como vieram: a tela os mostra como texto puro.
 */

const UNEXPECTED_OUTPUT_MESSAGE = 'O GitHub CLI devolveu dados que o Project Hub não entendeu.';
const UNKNOWN_CHECK_NAME = 'Check desconhecido';
const GHOST_AUTHOR = 'ghost';

type Raw = Record<string, unknown>;

function unexpected(cause?: unknown): GhError {
  return new GhError('UNKNOWN', UNEXPECTED_OUTPUT_MESSAGE, { cause });
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw unexpected(error);
  }
}

function asRecord(value: unknown): Raw | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Texto não vazio, ou `null`. O `gh` devolve `""` onde não há valor (`conclusion` de um check em curso). */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Data de início ou de fim de um check, ou `null`. O GraphQL do GitHub usa o ano 1 (`0001-01-01T00:00:00Z`)
 * como "sem data" num check que não terminou; isso não é uma data de verdade. (Não foi possível conferir no
 * `gh` real: o repositório não tem PR aberto com check em andamento. O tratamento é defensivo.)
 */
function timestamp(value: unknown): string | null {
  const raw = textOrNull(value);
  return raw === null || raw.startsWith('0001-01-01') ? null : raw;
}

/** O valor do enum, sem diferenciar maiúsculas, ou o `fallback` quando não é nenhum dos conhecidos. */
function pick<const T extends readonly string[]>(
  values: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  if (typeof value !== 'string') return fallback;
  const upper = value.toUpperCase();
  return values.find((known) => known === upper) ?? fallback;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * O PR precisa ser do `github.com`: `https:`, host exato, sem usuário, senha nem porta. O `gh` também lê
 * GitHub Enterprise e outros servidores, que o desenho da aba não cobre; e `github.com.exemplo.com` não pode
 * passar por prefixo.
 */
export function assertGithubUrl(value: unknown): string {
  const raw = text(value);
  let url: URL | undefined;
  try {
    url = raw === undefined ? undefined : new URL(raw);
  } catch {
    url = undefined;
  }
  if (
    url === undefined ||
    raw === undefined ||
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    throw new GhError('GH_NOT_AVAILABLE', GH_UNSUPPORTED_REPOSITORY_MESSAGE);
  }
  return raw;
}

function toSummary(source: Raw): PrSummaryDto {
  const number = prNumberSchema.safeParse(source['number']);
  if (!number.success) throw unexpected(number.error);
  const reviewDecision = textOrNull(source['reviewDecision']);
  const known = PR_REVIEW_DECISIONS.find((value) => value === reviewDecision?.toUpperCase());
  return {
    number: number.data,
    title: text(source['title']) ?? '',
    state: pick(PR_STATES, source['state'], 'CLOSED'),
    isDraft: source['isDraft'] === true,
    mergeable: pick(PR_MERGEABLE_VALUES, source['mergeable'], 'UNKNOWN'),
    mergeStateStatus: pick(PR_MERGE_STATE_STATUSES, source['mergeStateStatus'], 'UNKNOWN'),
    url: assertGithubUrl(source['url']),
    updatedAt: text(source['updatedAt']) ?? '',
    headRefName: text(source['headRefName']) ?? '',
    baseRefName: text(source['baseRefName']) ?? '',
    additions: count(source['additions']),
    deletions: count(source['deletions']),
    reviewDecision: known ?? null,
  };
}

function toCheck(source: Raw): CheckDto {
  switch (source['__typename']) {
    case 'CheckRun': {
      const conclusion = textOrNull(source['conclusion']);
      return {
        kind: 'check-run',
        name: text(source['name']) ?? UNKNOWN_CHECK_NAME,
        workflowName: textOrNull(source['workflowName']),
        status: pick(CHECK_RUN_STATUSES, source['status'], 'PENDING'),
        conclusion:
          conclusion === null ? null : pick(CHECK_RUN_CONCLUSIONS, conclusion, 'ACTION_REQUIRED'),
        startedAt: timestamp(source['startedAt']),
        completedAt: timestamp(source['completedAt']),
        detailsUrl: textOrNull(source['detailsUrl']),
      };
    }
    case 'StatusContext':
      return {
        kind: 'status-context',
        name: text(source['context']) ?? UNKNOWN_CHECK_NAME,
        state: pick(STATUS_CONTEXT_STATES, source['state'], 'PENDING'),
        targetUrl: textOrNull(source['targetUrl']),
        startedAt: timestamp(source['startedAt']),
      };
    default:
      // Tipo que o desenho não conhece: aparece na lista como pendente, em vez de sumir (e de parecer verde).
      return {
        kind: 'status-context',
        name: text(source['context']) ?? text(source['name']) ?? UNKNOWN_CHECK_NAME,
        state: 'PENDING',
        targetUrl: null,
        startedAt: null,
      };
  }
}

function toComment(source: Raw): CommentDto {
  return {
    author: text(asRecord(source['author'])?.['login']) ?? GHOST_AUTHOR,
    body: text(source['body']) ?? '',
    createdAt: text(source['createdAt']) ?? '',
  };
}

function records(value: unknown): Raw[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const record = asRecord(item);
    return record === undefined ? [] : [record];
  });
}

/**
 * Saída de `gh pr view <n> --json <PR_VIEW_FIELDS>` no formato do contrato. `readAt` é a hora da leitura
 * (ISO 8601), que o chamador escolhe. Falha com `GH_NOT_AVAILABLE` se a URL do PR não é do `github.com`, e
 * com `UNKNOWN` se a saída não é o JSON esperado. O resultado passa pelo schema do contrato antes de sair.
 */
export function parsePullRequest(stdout: string, readAt: string): PrReadingDto {
  const source = asRecord(parseJson(stdout));
  if (source === undefined) throw unexpected();
  const candidate = {
    pr: toSummary(source),
    checks: records(source['statusCheckRollup']).map(toCheck),
    comments: records(source['comments']).map(toComment),
    readAt,
  };
  const parsed = prReadingSchema.safeParse(candidate);
  if (!parsed.success) throw unexpected(parsed.error);
  return parsed.data;
}

/**
 * Saída de `gh pr list --head <branch> --state all --limit 30 --json number,isCrossRepository`: o número do
 * primeiro PR que não é de fork (`isCrossRepository` falso), ou `null` quando a lista é vazia ou só tem PR de
 * fork. O `--head` casa pelo nome da branch, inclusive o de um fork com o mesmo nome. Cada item precisa ter
 * `number` (inteiro positivo) e `isCrossRepository` (booleano); qualquer outra forma falha com `UNKNOWN`.
 */
export function parsePullRequestNumber(stdout: string): number | null {
  const list = parseJson(stdout);
  if (!Array.isArray(list)) throw unexpected();
  let local: number | null = null;
  for (const item of list as unknown[]) {
    const record = asRecord(item);
    const number = prNumberSchema.safeParse(record?.['number']);
    if (!number.success) throw unexpected(number.error);
    const crossRepository = record?.['isCrossRepository'];
    if (typeof crossRepository !== 'boolean') throw unexpected();
    if (!crossRepository && local === null) local = number.data;
  }
  return local;
}
