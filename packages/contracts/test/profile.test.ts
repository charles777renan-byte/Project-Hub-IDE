import { describe, expect, it } from 'vitest';
import { profileDtoSchema, setDisplayNameInputSchema } from '../src/profile';

describe('setDisplayNameInputSchema', () => {
  it('aceita nulo para tirar o nome e apara os espaços do texto', () => {
    expect(setDisplayNameInputSchema.parse({ name: null })).toEqual({ name: null });
    expect(setDisplayNameInputSchema.parse({ name: '  Ana  ' })).toEqual({ name: 'Ana' });
  });

  it('aceita 40 caracteres depois de aparar e recusa 41', () => {
    expect(setDisplayNameInputSchema.safeParse({ name: `  ${'a'.repeat(40)}  ` }).success).toBe(
      true,
    );
    expect(setDisplayNameInputSchema.safeParse({ name: 'a'.repeat(41) }).success).toBe(false);
  });

  it('exige a chave name, mesmo que seja nula', () => {
    expect(setDisplayNameInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('profileDtoSchema', () => {
  it('aceita nome ou nulo e recusa outro tipo', () => {
    expect(profileDtoSchema.safeParse({ displayName: null }).success).toBe(true);
    expect(profileDtoSchema.safeParse({ displayName: 'Ana' }).success).toBe(true);
    expect(profileDtoSchema.safeParse({ displayName: 3 }).success).toBe(false);
  });
});
