import { describe, expect, it } from 'vitest';
import { GitError } from '../src/run-git';
import { buildWorktreeNames } from '../src/worktree-naming';

const missionId = 'abcdef123456';

function slugOf(title: string): string {
  return buildWorktreeNames({ missionId, title, projectSlug: 'app' }).slug;
}

describe('buildWorktreeNames: slug', () => {
  it('título com pontuação vira slug simples', () => {
    expect(slugOf('Corrigir login com Google!')).toBe('corrigir-login-com-google');
  });

  it('mantém dígitos e põe tudo em minúsculas', () => {
    expect(slugOf('Fix Bug 123 NO Login')).toBe('fix-bug-123-no-login');
  });

  it('acentos viram a letra base', () => {
    expect(slugOf('Ação')).toBe('acao');
    expect(slugOf('Coração é ÓTIMO')).toBe('coracao-e-otimo');
    expect(slugOf('Über Ñandú')).toBe('uber-nandu');
  });

  it('sequências fora de [a-z0-9] viram um único hífen', () => {
    expect(slugOf('a   --  b')).toBe('a-b');
    expect(slugOf('A_B.C/D\\E:F')).toBe('a-b-c-d-e-f');
  });

  it('não deixa hífen nas pontas', () => {
    expect(slugOf('--abc--')).toBe('abc');
    expect(slugOf('  ...abc!!!  ')).toBe('abc');
  });

  it.each([[''], ['   '], ['---'], ['!!!'], ['日本語'], ['😀😀']])(
    'título %j sem nenhuma letra ou dígito ASCII vira "missao"',
    (title) => {
      expect(slugOf(title)).toBe('missao');
    },
  );

  it('título longo fica em até 40 caracteres', () => {
    expect(slugOf('a'.repeat(100))).toBe('a'.repeat(40));
    expect(slugOf('palavra '.repeat(30)).length).toBeLessThanOrEqual(40);
  });

  it('não termina em hífen quando o corte de 40 cai num separador', () => {
    const slug = slugOf(`${'a'.repeat(39)} bbb`);

    expect(slug).toBe('a'.repeat(39));
  });

  it('um título de exatamente 40 caracteres não é cortado', () => {
    expect(slugOf('b'.repeat(40))).toBe('b'.repeat(40));
  });

  it.each(['con', 'prn', 'aux', 'nul', 'com1', 'com5', 'com9', 'lpt1', 'lpt5', 'lpt9'])(
    'nome reservado do Windows %s ganha o prefixo x-',
    (reserved) => {
      expect(slugOf(reserved)).toBe(`x-${reserved}`);
      expect(slugOf(reserved.toUpperCase())).toBe(`x-${reserved}`);
    },
  );

  it('nome reservado do Windows ganha prefixo', () => {
    expect(slugOf('CON')).toBe('x-con');
  });

  it('nome reservado com pontuação em volta também ganha prefixo', () => {
    expect(slugOf('  Com1. ')).toBe('x-com1');
  });

  it.each(['com0', 'com10', 'lpt0', 'console', 'con-fig', 'auxiliar', 'null', 'con.txt'])(
    '%s não é nome reservado e não ganha prefixo',
    (title) => {
      expect(slugOf(title)).not.toMatch(/^x-/);
    },
  );

  it.each([
    '../../etc',
    '..\\..\\Windows\\System32',
    'C:\\Windows',
    '/etc/passwd',
    'a\tb\nc\0d',
    '--option=valor',
    '"; rm -rf /',
    'título com emoji 🚀 e ligadura ﬁ',
    'x'.repeat(5000),
  ])('slug de %j só tem [a-z0-9] separados por hífen, em até 40 caracteres', (title) => {
    const slug = slugOf(title);

    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.length).toBeLessThanOrEqual(40);
  });
});

describe('buildWorktreeNames: nomes', () => {
  it('monta missionShortId, branch e pasta relativa', () => {
    expect(buildWorktreeNames({ missionId, title: 'Corrigir login', projectSlug: 'app' })).toEqual({
      missionShortId: 'abcdef12',
      slug: 'corrigir-login',
      branch: 'ph/abcdef12-corrigir-login',
      relativeDir: 'app/abcdef12-corrigir-login',
    });
  });

  it('tentativa de caminho não escapa do diretório', () => {
    const n = buildWorktreeNames({ missionId, title: '../../etc', projectSlug: 'app' });

    expect(n.relativeDir).not.toMatch(/\.\.|\\|\/\//);
    expect(n.relativeDir).toBe('app/abcdef12-etc');
    expect(n.branch).toBe('ph/abcdef12-etc');
  });

  it('a pasta relativa tem sempre duas partes, separadas por uma barra', () => {
    const n = buildWorktreeNames({ missionId, title: '/..//\\x', projectSlug: '../outro' });

    expect(n.relativeDir.split('/')).toHaveLength(2);
    expect(n.relativeDir).not.toMatch(/\.\.|\\|\/\//);
  });
});

describe('buildWorktreeNames: missionShortId', () => {
  it('são os 8 primeiros caracteres do id, em minúsculas', () => {
    const n = buildWorktreeNames({ missionId: 'ABCDEF1234', title: 't', projectSlug: 'app' });

    expect(n.missionShortId).toBe('abcdef12');
  });

  it('de um UUID, são os 8 primeiros caracteres hexadecimais', () => {
    const n = buildWorktreeNames({
      missionId: '0198A3B4-1234-7000-8000-000000000000',
      title: 't',
      projectSlug: 'app',
    });

    expect(n.missionShortId).toBe('0198a3b4');
  });

  it('um id curto é usado inteiro', () => {
    expect(
      buildWorktreeNames({ missionId: 'abc', title: 't', projectSlug: 'app' }).missionShortId,
    ).toBe('abc');
  });

  it.each([
    ['ab-cd-ef-gh', 'ab-cd-ef'],
    ['abc-----xyz', 'abc'],
    ['-abcdefghi', 'abcdefg'],
    ['abcdefg-hij', 'abcdefg'],
    ['Ação12345', 'acao1234'],
  ])('id %j dá o id curto %j, com as regras do slug e sem hífen nas pontas', (id, expected) => {
    const n = buildWorktreeNames({ missionId: id, title: 't', projectSlug: 'app' });

    expect(n.missionShortId).toBe(expected);
    expect(n.branch).toBe(`ph/${expected}-t`);
  });

  it.each([[''], ['!!!!!!!!'], ['--------'], ['日本語日本語日本語']])(
    'id %j, sem nenhum caractere ASCII utilizável, é recusado',
    (id) => {
      let thrown: unknown;
      try {
        buildWorktreeNames({ missionId: id, title: 't', projectSlug: 'app' });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(GitError);
      expect(thrown).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});

describe('buildWorktreeNames: projectSlug passa pelo mesmo sanitizador', () => {
  function relativeDirOf(projectSlug: string): string {
    return buildWorktreeNames({ missionId, title: 't', projectSlug }).relativeDir;
  }

  it('minúsculas, sem acento e com hífens', () => {
    expect(relativeDirOf('Meu App')).toBe('meu-app/abcdef12-t');
    expect(relativeDirOf('Projeção')).toBe('projecao/abcdef12-t');
  });

  it('nome reservado do Windows ganha prefixo', () => {
    expect(relativeDirOf('CON')).toBe('x-con/abcdef12-t');
    expect(relativeDirOf('lpt1')).toBe('x-lpt1/abcdef12-t');
  });

  it('em até 40 caracteres', () => {
    expect(relativeDirOf('p'.repeat(60))).toBe(`${'p'.repeat(40)}/abcdef12-t`);
  });

  it('vazio, ou só com pontuação, vira "missao"', () => {
    expect(relativeDirOf('')).toBe('missao/abcdef12-t');
    expect(relativeDirOf('../..')).toBe('missao/abcdef12-t');
  });

  it('caminho absoluto ou com barras não vira caminho', () => {
    expect(relativeDirOf('C:\\Users\\x')).toBe('c-users-x/abcdef12-t');
    expect(relativeDirOf('/etc/passwd')).toBe('etc-passwd/abcdef12-t');
  });
});
