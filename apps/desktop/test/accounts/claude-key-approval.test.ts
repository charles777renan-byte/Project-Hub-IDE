import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeKeyApproval } from '../../src/main/accounts/claude-key-approval';

const A = '11111111-1111-4111-8111-111111111111';
const KEY = 'sk-ant-api03-chave-falsa-0123456789-abcdefghijKLMNOPQRST';
const OLD = 'sk-ant-api03-chave-antiga-9876543210-zyxwvutsrqPONMLKJIHG';

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ph-aprovacao-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const folderOf = (id: string) => join(root, 'claude', id);
const configOf = (id: string) => join(folderOf(id), '.claude.json');
const read = (id: string): Record<string, unknown> =>
  JSON.parse(readFileSync(configOf(id), 'utf8')) as Record<string, unknown>;

describe('aprovação da chave no .claude.json da conta', () => {
  it('cria o arquivo com a aprovação dos 20 últimos caracteres, e nunca a chave inteira', async () => {
    const approval = createClaudeKeyApproval({ folderOf });

    expect(await approval.grant(A, KEY)).toBe(true);

    expect(read(A)).toEqual({
      customApiKeyResponses: { approved: [KEY.slice(-20)], rejected: [] },
    });
    const raw = readFileSync(configOf(A), 'utf8');
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain(KEY.slice(0, 30));
  });

  it('preserva o resto do arquivo e troca a aprovação da chave antiga pela nova', async () => {
    mkdirSync(folderOf(A), { recursive: true });
    writeFileSync(
      configOf(A),
      JSON.stringify({
        theme: 'dark',
        projects: { 'C:/x': { hasTrustDialogAccepted: true } },
        customApiKeyResponses: { approved: [OLD.slice(-20)], rejected: [KEY.slice(-20)], extra: 1 },
      }),
    );
    const approval = createClaudeKeyApproval({ folderOf });

    expect(await approval.grant(A, KEY)).toBe(true);

    expect(read(A)).toEqual({
      theme: 'dark',
      projects: { 'C:/x': { hasTrustDialogAccepted: true } },
      customApiKeyResponses: { approved: [KEY.slice(-20)], rejected: [], extra: 1 },
    });
  });

  it('revoke tira a aprovação e deixa o resto', async () => {
    const approval = createClaudeKeyApproval({ folderOf });
    await approval.grant(A, KEY);

    expect(await approval.revoke(A)).toBe(true);

    expect(read(A)).toEqual({ customApiKeyResponses: { approved: [], rejected: [] } });
  });

  it('revoke sem arquivo não cria nada', async () => {
    const approval = createClaudeKeyApproval({ folderOf });

    expect(await approval.revoke(A)).toBe(true);

    expect(existsSync(configOf(A))).toBe(false);
  });

  it('arquivo que não é um objeto JSON não é sobrescrito', async () => {
    mkdirSync(folderOf(A), { recursive: true });
    writeFileSync(configOf(A), '{ quebrado');
    const approval = createClaudeKeyApproval({ folderOf });

    expect(await approval.grant(A, KEY)).toBe(false);
    expect(await approval.revoke(A)).toBe(false);

    expect(readFileSync(configOf(A), 'utf8')).toBe('{ quebrado');
  });

  it('não deixa arquivo temporário para trás', async () => {
    const approval = createClaudeKeyApproval({ folderOf });

    await approval.grant(A, KEY);
    await approval.revoke(A);

    const { readdirSync } = await import('node:fs');
    expect(readdirSync(folderOf(A))).toEqual(['.claude.json']);
  });
});
