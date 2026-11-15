import { describe, expect, it } from 'vitest';
import { createAgentTokens } from '../src/main/browser/agent/agent-tokens';

const A = { terminalId: 'term-a', projectId: 'proj-1' };
const B = { terminalId: 'term-b', projectId: 'proj-2' };

describe('registro de tokens do navegador dos agentes', () => {
  it('emite um token de 32 bytes em base64url, que resolve para o terminal e o projeto', () => {
    const tokens = createAgentTokens();
    const token = tokens.issue(A);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokens.resolve(token)).toEqual(A);
    expect(tokens.has('term-a')).toBe(true);
  });

  it('recusa token desconhecido, vazio, alterado e enorme', () => {
    const tokens = createAgentTokens();
    const token = tokens.issue(A);
    const flipped = (token.startsWith('A') ? 'B' : 'A') + token.slice(1);
    expect(tokens.resolve('')).toBeUndefined();
    expect(tokens.resolve('nao-e-um-token')).toBeUndefined();
    expect(tokens.resolve(flipped)).toBeUndefined();
    expect(tokens.resolve(token + 'x')).toBeUndefined();
    expect(tokens.resolve('a'.repeat(10_000))).toBeUndefined();
  });

  it('dois terminais têm tokens diferentes, cada um com o seu projeto', () => {
    const tokens = createAgentTokens();
    const a = tokens.issue(A);
    const b = tokens.issue(B);
    expect(a).not.toBe(b);
    expect(tokens.resolve(a)).toEqual(A);
    expect(tokens.resolve(b)).toEqual(B);
  });

  it('revogar invalida só o token daquele terminal', () => {
    const tokens = createAgentTokens();
    const a = tokens.issue(A);
    const b = tokens.issue(B);
    tokens.revoke('term-a');
    expect(tokens.resolve(a)).toBeUndefined();
    expect(tokens.has('term-a')).toBe(false);
    expect(tokens.resolve(b)).toEqual(B);
    tokens.revoke('term-inexistente');
  });

  it('emitir de novo para o mesmo terminal invalida o token anterior', () => {
    const tokens = createAgentTokens();
    const first = tokens.issue(A);
    const second = tokens.issue(A);
    expect(tokens.resolve(first)).toBeUndefined();
    expect(tokens.resolve(second)).toEqual(A);
  });

  it('limpar invalida todos', () => {
    const tokens = createAgentTokens();
    const a = tokens.issue(A);
    tokens.clear();
    expect(tokens.resolve(a)).toBeUndefined();
    expect(tokens.has('term-a')).toBe(false);
  });

  it('a identidade devolvida é uma cópia: mexer nela não muda o registro', () => {
    const tokens = createAgentTokens();
    const token = tokens.issue(A);
    const got = tokens.resolve(token);
    if (got !== undefined) got.projectId = 'outro';
    expect(tokens.resolve(token)).toEqual(A);
  });
});
