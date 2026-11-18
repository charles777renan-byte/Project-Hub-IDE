import type { AcceptanceCriterion, AuditEvent } from '@project-hub/domain';
import { describe, expect, it } from 'vitest';
import {
  VERIFY_INSTRUCTION,
  claimedCriteria,
  verificationPassed,
  verificationRequest,
} from '../src/missions/criteria';

const CRITERIA: AcceptanceCriterion[] = [
  { id: 'c2', position: 2, text: 'Testes passam' },
  { id: 'c1', position: 1, text: 'Login funciona' },
  { id: 'c3', position: 3, text: 'Sem regressão' },
];

function verification(sequence: number, payload: Record<string, unknown>): AuditEvent {
  return {
    id: `v${sequence}`,
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'verification.completed',
    severity: 'info',
    actor: 'agent',
    payload: { type: 'verification.completed', ...payload },
    sequence,
    createdAt: '2026-11-17T12:00:00.000Z',
  };
}

describe('verificationRequest', () => {
  it('lista os critérios numerados, na ordem da missão, e pede os testes e a linha final', () => {
    const request = verificationRequest(CRITERIA);
    expect(request).toContain(
      'Critérios de aceite:\n1. Login funciona\n2. Testes passam\n3. Sem regressão',
    );
    expect(request).toContain(VERIFY_INSTRUCTION);
    expect(request).toContain('Critérios comprovados:');
    expect(request.indexOf('Critérios de aceite:')).toBeLessThan(
      request.indexOf(VERIFY_INSTRUCTION),
    );
  });

  it('sem critérios, pede só os testes', () => {
    expect(verificationRequest([])).toBe(VERIFY_INSTRUCTION);
  });
});

describe('claimedCriteria', () => {
  it('lê os números da linha e devolve os textos, na ordem da missão', () => {
    expect(claimedCriteria('Rodei os testes.\n\nCritérios comprovados: 2, 1', CRITERIA)).toEqual([
      'Login funciona',
      'Testes passam',
    ]);
    expect(claimedCriteria('Critérios comprovados: 3', CRITERIA)).toEqual(['Sem regressão']);
  });

  it('aceita a linha com marcação, sem acento, com "e" e com ponto final', () => {
    expect(claimedCriteria('**Critérios comprovados:** 1 e 2.', CRITERIA)).toEqual([
      'Login funciona',
      'Testes passam',
    ]);
    expect(claimedCriteria('- `criterios comprovados: 1`', CRITERIA)).toEqual(['Login funciona']);
  });

  it('"nenhum" é uma indicação vazia, e "todos" indica todos', () => {
    expect(claimedCriteria('Critérios comprovados: nenhum', CRITERIA)).toEqual([]);
    expect(claimedCriteria('Critérios comprovados: todos', CRITERIA)).toEqual([
      'Login funciona',
      'Testes passam',
      'Sem regressão',
    ]);
  });

  it('número fora da lista é ignorado, e número repetido conta uma vez', () => {
    expect(claimedCriteria('Critérios comprovados: 1, 7, 1, 0', CRITERIA)).toEqual([
      'Login funciona',
    ]);
  });

  it('com mais de uma linha, vale a última', () => {
    const text = 'Critérios comprovados: 1\nMudei de ideia.\nCritérios comprovados: 2';
    expect(claimedCriteria(text, CRITERIA)).toEqual(['Testes passam']);
  });

  it('sem a linha, ou com a linha sem número nem "nenhum", não há indicação', () => {
    expect(claimedCriteria('Terminei o trabalho.', CRITERIA)).toBeUndefined();
    expect(claimedCriteria('Critérios comprovados: veja acima', CRITERIA)).toBeUndefined();
    expect(claimedCriteria('Critérios comprovados: 9', CRITERIA)).toBeUndefined();
    expect(claimedCriteria('', CRITERIA)).toBeUndefined();
  });
});

describe('verificationPassed', () => {
  it('sem verificação, ou com verificação sem teste nenhum, não passou', () => {
    expect(verificationPassed([])).toBe(false);
    expect(
      verificationPassed([verification(1, { command: 'make test', passed: 0, failed: 0 })]),
    ).toBe(false);
  });

  it('passou quando há testes e nenhum falhou', () => {
    expect(
      verificationPassed([verification(1, { command: 'pnpm test', passed: 3, failed: 0 })]),
    ).toBe(true);
  });

  it('vale a última rodada de cada comando', () => {
    const failedThenPassed = [
      verification(1, { command: 'pnpm test', passed: 2, failed: 1 }),
      verification(2, { command: 'pnpm test', passed: 3, failed: 0 }),
    ];
    expect(verificationPassed(failedThenPassed)).toBe(true);

    const passedThenFailed = [...failedThenPassed].reverse().map((event, index) => ({
      ...event,
      sequence: index + 1,
    }));
    expect(verificationPassed(passedThenFailed)).toBe(false);
  });

  it('um comando com falha derruba o conjunto, mesmo com outro que passou', () => {
    expect(
      verificationPassed([
        verification(1, { command: 'pnpm test', passed: 3, failed: 0 }),
        verification(2, { command: 'pnpm test:e2e', passed: 1, failed: 1 }),
      ]),
    ).toBe(false);
  });

  it('eventos de outro tipo e payload malformado não contam', () => {
    expect(
      verificationPassed([
        { ...verification(1, { command: 'pnpm test', passed: 3, failed: 0 }), eventType: 'x' },
        verification(2, { command: 'pnpm test', passed: 'três', failed: 0 }),
      ]),
    ).toBe(false);
  });
});
