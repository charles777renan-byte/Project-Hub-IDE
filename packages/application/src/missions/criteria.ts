import type { AcceptanceCriterion, AuditEvent } from '@project-hub/domain';

/**
 * Critérios de aceite comprovados pelo que o agente indica. O prompt lista os critérios numerados e pede
 * que a resposta termine com a linha `Critérios comprovados:` e os números. O app marca os indicados só
 * quando os testes da tentativa passaram: a palavra do agente liga o teste ao critério, mas a prova é o teste.
 */

/** Pedido para rodar os testes. O app lê o resultado do que o agente roda (`verification.completed`). */
export const VERIFY_INSTRUCTION =
  'Antes de encerrar, rode os testes do projeto, se houver, e diga o resultado.';

/** Começo da linha em que o agente indica os critérios. */
const MARKER = 'Critérios comprovados:';

/** Pedido da linha final, que `claimedCriteria` lê. */
const CLAIM_INSTRUCTION = `Termine a resposta com a linha "${MARKER}" seguida dos números dos critérios de aceite que esses testes comprovam, separados por vírgula, ou de "nenhum".`;

function inOrder(criteria: readonly AcceptanceCriterion[]): AcceptanceCriterion[] {
  return [...criteria].sort((a, b) => a.position - b.position);
}

/**
 * O fim do prompt da missão e de cada tarefa: os critérios numerados, o pedido dos testes e o da linha
 * final. Sem critérios, só o pedido dos testes.
 */
export function verificationRequest(criteria: readonly AcceptanceCriterion[]): string {
  if (criteria.length === 0) return VERIFY_INSTRUCTION;
  const list = inOrder(criteria)
    .map((criterion, index) => `${index + 1}. ${criterion.text.trim()}`)
    .join('\n');
  return `Critérios de aceite:\n${list}\n\n${VERIFY_INSTRUCTION} ${CLAIM_INSTRUCTION}`;
}

/** A linha do agente, com ou sem acento e com a marcação do Markdown em volta. */
const CLAIM_LINE = /crit[ée]rios comprovados\s*:(.*)$/i;

/**
 * Os critérios que o agente indicou na resposta, pelo texto e na ordem da missão. Vale a última linha
 * `Critérios comprovados:`. `nenhum` é uma indicação vazia, e `todos` indica todos. Sem a linha, ou com a
 * linha sem número válido nem uma dessas palavras, devolve undefined: não houve indicação.
 */
export function claimedCriteria(
  text: string,
  criteria: readonly AcceptanceCriterion[],
): string[] | undefined {
  const ordered = inOrder(criteria);
  let claim: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = CLAIM_LINE.exec(line.replace(/[*_`]/g, ''));
    if (match?.[1] !== undefined) claim = match[1];
  }
  if (claim === undefined) return undefined;

  const numbers = [...claim.matchAll(/\d+/g)].map((match) => Number(match[0]));
  if (numbers.length > 0) {
    const chosen = ordered.filter((_, index) => numbers.includes(index + 1));
    return chosen.length === 0 ? undefined : chosen.map((criterion) => criterion.text.trim());
  }
  if (/\btodos\b/i.test(claim)) return ordered.map((criterion) => criterion.text.trim());
  if (/\bnenhum\b/i.test(claim)) return [];
  return undefined;
}

function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Os testes da tentativa passaram: há ao menos um teste e nenhum falhou. Vale a última rodada de cada
 * comando, como no resumo da tela. `events` são os eventos da tentativa.
 */
export function verificationPassed(events: readonly AuditEvent[]): boolean {
  const latest = new Map<string, { passed: number; failed: number }>();
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.eventType !== 'verification.completed') continue;
    const command = event.payload['command'];
    const passed = countOf(event.payload['passed']);
    const failed = countOf(event.payload['failed']);
    if (typeof command !== 'string' || passed === undefined || failed === undefined) continue;
    latest.set(command, { passed, failed });
  }
  let passed = 0;
  let failed = 0;
  for (const run of latest.values()) {
    passed += run.passed;
    failed += run.failed;
  }
  return passed > 0 && failed === 0;
}
