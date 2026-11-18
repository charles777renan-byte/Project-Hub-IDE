import { describe, expect, it } from 'vitest';
import {
  gitIdentitySchema,
  initRepositoryInputSchema,
  repositoryInitPreviewSchema,
} from '../src/project';

describe('gitIdentitySchema', () => {
  it('apara os espaços e aceita um e-mail local, que não é caixa de correio', () => {
    expect(
      gitIdentitySchema.parse({ name: '  Ana Souza ', email: ' ana@project-hub.local ' }),
    ).toEqual({ name: 'Ana Souza', email: 'ana@project-hub.local' });
  });

  it('recusa o que o Git leria como opção, caractere de controle, < e > e e-mail sem @', () => {
    const invalid = [
      { name: '--global', email: 'ana@empresa.com' },
      { name: 'Ana\nSouza', email: 'ana@empresa.com' },
      { name: 'Ana <x>', email: 'ana@empresa.com' },
      { name: '   ', email: 'ana@empresa.com' },
      { name: 'a'.repeat(101), email: 'ana@empresa.com' },
      { name: 'Ana', email: 'sem-arroba' },
      { name: 'Ana', email: '-x@empresa.com' },
      { name: 'Ana', email: 'ana @empresa.com' },
      { name: 'Ana', email: 'ana@' },
    ];
    for (const identity of invalid) {
      expect(gitIdentitySchema.safeParse(identity).success, JSON.stringify(identity)).toBe(false);
    }
  });
});

describe('initRepositoryInputSchema', () => {
  it('aceita só o projeto, ou o projeto com o autor confirmado', () => {
    expect(initRepositoryInputSchema.safeParse({ projectId: 'p1' }).success).toBe(true);
    expect(
      initRepositoryInputSchema.safeParse({
        projectId: 'p1',
        identity: { name: 'Ana', email: 'ana@empresa.com' },
      }).success,
    ).toBe(true);
    expect(
      initRepositoryInputSchema.safeParse({ identity: { name: 'Ana', email: 'a@b' } }).success,
    ).toBe(false);
  });
});

describe('repositoryInitPreviewSchema', () => {
  it('aceita a prévia com e sem o autor proposto', () => {
    const base = { identityConfigured: false, createsGitignore: true, sensitiveFiles: [] };
    expect(repositoryInitPreviewSchema.safeParse(base).success).toBe(true);
    expect(
      repositoryInitPreviewSchema.safeParse({
        ...base,
        suggestedIdentity: { name: 'Ana', email: 'ana@project-hub.local' },
      }).success,
    ).toBe(true);
  });
});
