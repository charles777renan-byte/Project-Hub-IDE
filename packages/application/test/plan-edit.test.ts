import type { AppResult } from '@project-hub/contracts';
import type { MissionStep } from '@project-hub/domain';
import { describe, expect, it } from 'vitest';
import { applyPlanEdit, type PlanEdit } from '../src/missions/plan-edit';

function step(id: string, position: number, overrides: Partial<MissionStep> = {}): MissionStep {
  return {
    id,
    missionId: 'm1',
    position,
    title: `Tarefa ${id}`,
    description: `Descrição ${id}`,
    kind: 'custom',
    status: 'pending',
    dependsOn: [],
    agent: 'claude-code',
    role: 'general',
    ...overrides,
  };
}

/** Cadeia A -> B -> C. */
function chain(): MissionStep[] {
  return [step('a', 1), step('b', 2, { dependsOn: ['a'] }), step('c', 3, { dependsOn: ['b'] })];
}

function data<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso: ${result.error.code} ${result.error.message}`);
  return result.data;
}

function failed(result: AppResult<unknown>): { code: string; message: string } {
  if (result.ok) throw new Error('esperava falha, veio sucesso');
  return { code: result.error.code, message: result.error.message };
}

function positions(steps: readonly MissionStep[]): number[] {
  return steps.map((s) => s.position);
}

describe('applyPlanEdit: renomear', () => {
  it('apara o título, troca a descrição e mantém o resto', () => {
    const before = chain();
    const result = data(
      applyPlanEdit(before, 'b', { op: 'rename', title: '  Novo nome  ', description: ' Texto ' }),
    );

    expect(result[1]).toMatchObject({
      id: 'b',
      title: 'Novo nome',
      description: 'Texto',
      dependsOn: ['a'],
      role: 'general',
    });
    expect(positions(result)).toEqual([1, 2, 3]);
    expect(before[1]?.title).toBe('Tarefa b');
  });

  it('sem descrição, mantém a descrição que já existia', () => {
    const result = data(applyPlanEdit(chain(), 'a', { op: 'rename', title: 'Outro' }));
    expect(result[0]).toMatchObject({ title: 'Outro', description: 'Descrição a' });
  });

  it('recusa título vazio ou só com espaços, dizendo a posição', () => {
    const result = failed(applyPlanEdit(chain(), 'b', { op: 'rename', title: '   ' }));
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.message).toContain('2');
  });

  it('recusa título com mais de 120 caracteres e aceita exatamente 120', () => {
    expect(failed(applyPlanEdit(chain(), 'a', { op: 'rename', title: 'x'.repeat(121) })).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(applyPlanEdit(chain(), 'a', { op: 'rename', title: 'x'.repeat(120) }).ok).toBe(true);
  });

  it('recusa descrição com mais de 2000 caracteres', () => {
    const result = applyPlanEdit(chain(), 'a', {
      op: 'rename',
      title: 'Ok',
      description: 'y'.repeat(2001),
    });
    expect(failed(result).code).toBe('VALIDATION_FAILED');
  });
});

describe('applyPlanEdit: remover', () => {
  it('remove o meio da cadeia A -> B -> C: C passa a depender de A e as posições fecham', () => {
    const result = data(applyPlanEdit(chain(), 'b', { op: 'remove' }));

    expect(result.map((s) => s.id)).toEqual(['a', 'c']);
    expect(positions(result)).toEqual([1, 2]);
    expect(result[1]?.dependsOn).toEqual(['a']);
  });

  it('religa sem repetir dependências quando o dependente já dependia da herdada', () => {
    const steps = [
      step('a', 1),
      step('b', 2, { dependsOn: ['a'] }),
      step('c', 3, { dependsOn: ['a', 'b'] }),
    ];
    const result = data(applyPlanEdit(steps, 'b', { op: 'remove' }));
    expect(result[1]?.dependsOn).toEqual(['a']);
  });

  it('remover a primeira tarefa deixa o dependente sem dependência', () => {
    const result = data(applyPlanEdit(chain(), 'a', { op: 'remove' }));
    expect(result.map((s) => s.id)).toEqual(['b', 'c']);
    expect(result[0]?.dependsOn).toEqual([]);
    expect(result[1]?.dependsOn).toEqual(['b']);
  });

  it('remover a última tarefa da cadeia não mexe nas outras', () => {
    const result = data(applyPlanEdit(chain(), 'c', { op: 'remove' }));
    expect(result.map((s) => s.id)).toEqual(['a', 'b']);
    expect(result[1]?.dependsOn).toEqual(['a']);
  });

  it('recusa remover a única tarefa do plano', () => {
    const result = failed(applyPlanEdit([step('a', 1)], 'a', { op: 'remove' }));
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.message).toContain('Tarefa a');
  });
});

describe('applyPlanEdit: reordenar', () => {
  it('move uma tarefa independente e renumera de 1 a n', () => {
    const steps = [step('a', 1), step('b', 2), step('c', 3)];
    const result = data(applyPlanEdit(steps, 'c', { op: 'move', toPosition: 1 }));
    expect(result.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(positions(result)).toEqual([1, 2, 3]);
  });

  it('recusa mover C para a posição 1 (C depende de B)', () => {
    const result = failed(applyPlanEdit(chain(), 'c', { op: 'move', toPosition: 1 }));
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.message).toContain('Tarefa c');
    expect(result.message).toContain('Tarefa b');
  });

  it('recusa mover A para o fim (B depende de A)', () => {
    const result = failed(applyPlanEdit(chain(), 'a', { op: 'move', toPosition: 3 }));
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.message).toContain('Tarefa b');
    expect(result.message).toContain('Tarefa a');
  });

  it('recusa trocar B e C de lugar (C depende de B), nos dois sentidos', () => {
    expect(failed(applyPlanEdit(chain(), 'b', { op: 'move', toPosition: 3 })).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(failed(applyPlanEdit(chain(), 'c', { op: 'move', toPosition: 2 })).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('aceita a ordem nova quando respeita as dependências', () => {
    const steps = [
      step('a', 1),
      step('b', 2, { dependsOn: ['a'] }),
      step('c', 3),
      step('d', 4, { dependsOn: ['a'] }),
    ];
    const result = data(applyPlanEdit(steps, 'd', { op: 'move', toPosition: 2 }));
    expect(result.map((s) => s.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(positions(result)).toEqual([1, 2, 3, 4]);
  });

  it('mover para a posição em que já está não muda nada', () => {
    const result = data(applyPlanEdit(chain(), 'b', { op: 'move', toPosition: 2 }));
    expect(result).toEqual(chain());
  });

  it('recusa posição fora de 1 a n ou não inteira', () => {
    for (const toPosition of [0, 4, -1, 1.5, Number.NaN]) {
      expect(failed(applyPlanEdit(chain(), 'b', { op: 'move', toPosition })).code).toBe(
        'VALIDATION_FAILED',
      );
    }
  });

  it('usa a ordem por posição mesmo que a lista chegue embaralhada', () => {
    const [a, b, c] = chain() as [MissionStep, MissionStep, MissionStep];
    const result = data(applyPlanEdit([c, a, b], 'a', { op: 'rename', title: 'Z' }));
    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyPlanEdit: programa', () => {
  it('aceita claude-code', () => {
    const result = data(applyPlanEdit(chain(), 'b', { op: 'agent', agent: 'claude-code' }));
    expect(result[1]?.agent).toBe('claude-code');
  });

  it('recusa um programa que não existe', () => {
    const edit = { op: 'agent', agent: 'gpt' } as unknown as PlanEdit;
    const result = failed(applyPlanEdit(chain(), 'b', edit));
    expect(result.code).toBe('VALIDATION_FAILED');
    expect(result.message).toContain('Tarefa b');
  });
});

describe('applyPlanEdit: geral', () => {
  it('recusa uma tarefa que não está no plano', () => {
    expect(failed(applyPlanEdit(chain(), 'zzz', { op: 'remove' })).code).toBe('VALIDATION_FAILED');
  });

  it('recusa uma operação desconhecida', () => {
    const edit = { op: 'explode' } as unknown as PlanEdit;
    expect(failed(applyPlanEdit(chain(), 'a', edit)).code).toBe('VALIDATION_FAILED');
  });

  it('preserva os ids e termina com posições 1..n em toda edição válida', () => {
    const edits: PlanEdit[] = [
      { op: 'rename', title: 'N' },
      { op: 'remove' },
      { op: 'move', toPosition: 3 },
      { op: 'agent', agent: 'claude-code' },
    ];
    const steps = [step('a', 1), step('b', 2), step('c', 3)];
    for (const edit of edits) {
      const result = data(applyPlanEdit(steps, 'a', edit));
      expect(positions(result)).toEqual(result.map((_, index) => index + 1));
      expect(result.every((s) => ['a', 'b', 'c'].includes(s.id))).toBe(true);
    }
  });
});
