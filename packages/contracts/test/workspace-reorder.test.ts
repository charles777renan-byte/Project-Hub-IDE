import { describe, expect, it } from 'vitest';
import { reorderWorkspacesInputSchema } from '../src/workspace';

describe('reorderWorkspacesInputSchema', () => {
  it('aceita uma lista de ids diferentes', () => {
    expect(reorderWorkspacesInputSchema.parse({ workspaceIds: ['w1', 'w2'] })).toEqual({
      workspaceIds: ['w1', 'w2'],
    });
  });

  it('recusa lista vazia, id repetido, id vazio e lista longa demais', () => {
    expect(reorderWorkspacesInputSchema.safeParse({ workspaceIds: [] }).success).toBe(false);
    expect(reorderWorkspacesInputSchema.safeParse({ workspaceIds: ['w1', 'w1'] }).success).toBe(
      false,
    );
    expect(reorderWorkspacesInputSchema.safeParse({ workspaceIds: [''] }).success).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, index) => `w${index}`);
    expect(reorderWorkspacesInputSchema.safeParse({ workspaceIds: tooMany }).success).toBe(false);
  });

  it('recusa entrada que não é uma lista de textos', () => {
    for (const payload of [undefined, {}, 'w1', { workspaceIds: 'w1' }, { workspaceIds: [1] }]) {
      expect(reorderWorkspacesInputSchema.safeParse(payload).success).toBe(false);
    }
  });
});
