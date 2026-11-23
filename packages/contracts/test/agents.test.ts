import { describe, expect, it } from 'vitest';
import {
  addProfileInputSchema,
  agentsDtoSchema,
  BUILT_IN_PROFILE_ID,
  removeProfileInputSchema,
  setDefaultProfileInputSchema,
  setMissionProfileInputSchema,
  testProgramInputSchema,
  updateProfileInputSchema,
} from '../src';

const ID = '11111111-1111-4111-8111-111111111111';

describe('contrato dos agentes', () => {
  it('o perfil novo apara o nome e aceita só as opções das listas fixas', () => {
    expect(addProfileInputSchema.parse({ name: '  Rápido ', model: 'haiku' })).toEqual({
      name: 'Rápido',
      model: 'haiku',
    });
    expect(addProfileInputSchema.safeParse({ name: 'x', model: 'gpt-5' }).success).toBe(false);
    expect(addProfileInputSchema.safeParse({ name: 'x', effort: 'turbo' }).success).toBe(false);
    expect(addProfileInputSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('os modos que tiram a pessoa do controle, e o de planejar, não entram', () => {
    for (const permissionMode of ['bypassPermissions', 'dontAsk', 'plan']) {
      expect(addProfileInputSchema.safeParse({ name: 'x', permissionMode }).success).toBe(false);
    }
    expect(addProfileInputSchema.safeParse({ name: 'x', permissionMode: 'auto' }).success).toBe(
      true,
    );
  });

  it('nenhum campo a mais passa: argumento de linha de comando não vem da tela', () => {
    expect(addProfileInputSchema.safeParse({ name: 'x', args: ['--foo'] }).success).toBe(false);
    expect(testProgramInputSchema.safeParse({ provider: 'claude', command: 'x' }).success).toBe(
      false,
    );
  });

  it('o perfil embutido não se edita nem se remove, mas pode ser o padrão e o da missão', () => {
    expect(updateProfileInputSchema.safeParse({ id: BUILT_IN_PROFILE_ID, name: 'x' }).success).toBe(
      false,
    );
    expect(removeProfileInputSchema.safeParse({ id: BUILT_IN_PROFILE_ID }).success).toBe(false);
    expect(setDefaultProfileInputSchema.safeParse({ id: BUILT_IN_PROFILE_ID }).success).toBe(true);
    expect(
      setMissionProfileInputSchema.safeParse({ missionId: 'm1', profileId: BUILT_IN_PROFILE_ID })
        .success,
    ).toBe(true);
    expect(setMissionProfileInputSchema.safeParse({ missionId: 'm1', profileId: ID }).success).toBe(
      true,
    );
    expect(
      setMissionProfileInputSchema.safeParse({ missionId: 'm1', profileId: 'outro' }).success,
    ).toBe(false);
  });

  it('o shell não é um programa de agente', () => {
    expect(testProgramInputSchema.safeParse({ provider: 'shell' }).success).toBe(false);
    expect(testProgramInputSchema.safeParse({ provider: 'codex' }).success).toBe(true);
  });

  it('a resposta dos agentes é estrita', () => {
    const dto = {
      programs: [{ provider: 'claude', label: 'Claude Code', installed: true, role: 'missions' }],
      profiles: [
        { id: BUILT_IN_PROFILE_ID, name: 'Padrão do programa', builtIn: true, isDefault: true },
        { id: ID, name: 'Rápido', builtIn: false, isDefault: false, model: 'haiku' },
      ],
    };
    expect(agentsDtoSchema.parse(dto)).toEqual(dto);
    expect(
      agentsDtoSchema.safeParse({
        ...dto,
        programs: [{ ...dto.programs[0], path: 'C:\\claude.exe' }],
      }).success,
    ).toBe(false);
  });
});
