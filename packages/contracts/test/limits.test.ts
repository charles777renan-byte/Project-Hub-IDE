import { describe, expect, it } from 'vitest';
import {
  LIMIT_PROBLEM_VALUES,
  LIMIT_PROVIDER_VALUES,
  limitWindowDtoSchema,
  limitsDtoSchema,
} from '../src';

const WINDOW = { id: 'five_hour', usedPercent: 16, resetsAt: '2026-10-28T15:00:00.000Z' };

describe('contrato de limites', () => {
  it('aceita o DTO antigo, sem durationMinutes', () => {
    const dto = {
      providers: [
        {
          provider: 'claude',
          windows: [WINDOW],
          capturedAt: '2026-10-28T10:00:00.000Z',
          refreshing: false,
        },
      ],
    };
    expect(limitsDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('aceita o provedor codex', () => {
    expect(LIMIT_PROVIDER_VALUES).toContain('codex');
    const dto = { providers: [{ provider: 'codex', windows: [], refreshing: false }] };
    expect(limitsDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('aceita o problema no-data', () => {
    expect(LIMIT_PROBLEM_VALUES).toContain('no-data');
    const dto = {
      providers: [{ provider: 'codex', windows: [], refreshing: false, problem: 'no-data' }],
    };
    expect(limitsDtoSchema.safeParse(dto).success).toBe(true);
  });

  it('recusa provedor desconhecido', () => {
    const dto = { providers: [{ provider: 'antigravity', windows: [], refreshing: false }] };
    expect(limitsDtoSchema.safeParse(dto).success).toBe(false);
  });

  it('aceita durationMinutes inteiro positivo até 527040', () => {
    expect(limitWindowDtoSchema.safeParse({ ...WINDOW, durationMinutes: 43200 }).success).toBe(
      true,
    );
    expect(limitWindowDtoSchema.safeParse({ ...WINDOW, durationMinutes: 527040 }).success).toBe(
      true,
    );
  });

  it.each([1.5, -300, 0, 527041])('recusa durationMinutes %s', (durationMinutes) => {
    expect(limitWindowDtoSchema.safeParse({ ...WINDOW, durationMinutes }).success).toBe(false);
  });
});
