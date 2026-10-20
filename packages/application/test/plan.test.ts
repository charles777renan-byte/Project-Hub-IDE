import { describe, expect, it } from 'vitest';
import { planFromCriteria } from '../src/missions/plan';

describe('planFromCriteria', () => {
  it('cria um passo por critério, na ordem dos critérios', () => {
    expect(planFromCriteria(['Login funciona', 'Testes passam', 'Sem regressão'])).toEqual({
      steps: [
        { position: 1, title: 'Login funciona' },
        { position: 2, title: 'Testes passam' },
        { position: 3, title: 'Sem regressão' },
      ],
    });
  });

  it('sem critérios, não há passos', () => {
    expect(planFromCriteria([])).toEqual({ steps: [] });
  });
});
