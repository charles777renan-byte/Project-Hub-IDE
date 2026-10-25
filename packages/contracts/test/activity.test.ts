import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ACTIVITY_WINDOW_DAYS as WINDOW_FROM_SUBPATH } from '../src/activity-window';
import {
  ACTIVITY_WINDOW_DAYS,
  CHANNELS,
  activityDailyInputSchema,
  activityDailyResponseSchema,
  responseSchemas,
  type ActivityDay,
  type AppResult,
  type ProjectHubApi,
} from '../src/index';

describe('contrato de atividade', () => {
  it('a janela é fixa em 90 dias', () => {
    expect(ACTIVITY_WINDOW_DAYS).toBe(90);
  });

  it('o subpath sem zod exporta a mesma janela e não importa nada', () => {
    expect(WINDOW_FROM_SUBPATH).toBe(ACTIVITY_WINDOW_DAYS);
    const source = readFileSync(new URL('../src/activity-window.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import|from\s+['"]/m);
  });

  it('declara o subpath nos exports do pacote, ao lado do layout-limits', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, string> };
    expect(manifest.exports['./activity-window']).toBe('./src/activity-window.ts');
    expect(manifest.exports['./layout-limits']).toBe('./src/layout-limits.ts');
  });

  it('aceita a lista vazia e dias válidos', () => {
    expect(activityDailyResponseSchema.safeParse([]).success).toBe(true);
    expect(
      activityDailyResponseSchema.safeParse([
        { date: '2026-10-24', count: 0 },
        { date: '2026-10-25', count: 12 },
      ]).success,
    ).toBe(true);
  });

  it('recusa data fora do formato, contagem negativa ou fracionada e campo faltando', () => {
    for (const day of [
      { date: '24/10/2026', count: 1 },
      { date: '2026-10-24T10:00:00Z', count: 1 },
      { date: '2026-10-24', count: -1 },
      { date: '2026-10-24', count: 1.5 },
      { date: '2026-10-24' },
      { count: 1 },
    ]) {
      expect(activityDailyResponseSchema.safeParse([day]).success).toBe(false);
    }
  });

  it('a entrada aceita chamada vazia e recusa qualquer parâmetro', () => {
    expect(activityDailyInputSchema.safeParse(undefined).success).toBe(true);
    expect(activityDailyInputSchema.safeParse({}).success).toBe(true);
    for (const input of [{ days: 30 }, 'texto', 7, null, []]) {
      expect(activityDailyInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it('o canal tem resposta conferida pelo AppResult', () => {
    const schema = responseSchemas[CHANNELS.activityDaily];
    expect(schema.safeParse({ ok: true, data: [{ date: '2026-10-24', count: 2 }] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ok: true, data: [{ date: 'ontem', count: 2 }] }).success).toBe(false);
  });

  it('a API expõe activity.daily sem parâmetro', () => {
    expectTypeOf<ProjectHubApi['activity']['daily']>().parameters.toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<ProjectHubApi['activity']['daily']>>().toEqualTypeOf<
      Promise<AppResult<ActivityDay[]>>
    >();
  });
});
