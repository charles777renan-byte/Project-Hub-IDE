import { describe, expect, it } from 'vitest';
import { PROJECT_VIEWS, parseProjectView } from '../../src/renderer/project-views';

describe('project-views', () => {
  it('as visões seguem a ordem da barra, com Progresso entre Missões e Worktrees', () => {
    expect([...PROJECT_VIEWS]).toEqual([
      'terminais',
      'missoes',
      'progresso',
      'worktrees',
      'configuracoes',
    ]);
  });

  it('parseProjectView aceita progresso e devolve terminais para valor desconhecido', () => {
    expect(parseProjectView('progresso')).toBe('progresso');
    expect(parseProjectView('nada')).toBe('terminais');
    expect(parseProjectView(null)).toBe('terminais');
  });
});
