import { describe, expect, it } from 'vitest';
import {
  API_KEY_VARIABLE,
  apiKeyProblem,
  isApiKeyProvider,
  keyProblemText,
} from '../../src/main/accounts/api-key-shape';

describe('forma da chave de API', () => {
  it.each([
    ['sk-ant-api03-' + 'a'.repeat(40), undefined],
    ['sk-ant-api03-' + 'A1_-'.repeat(10), undefined],
    ['sk-ant-admin01-' + 'a'.repeat(40), 'admin-key'],
    ['sk-proj-' + 'a'.repeat(40), 'not-a-key'], // chave da OpenAI na conta do Claude
    ['sk-' + 'a'.repeat(40), 'not-a-key'],
    ['sk-ant-' + 'a'.repeat(10), 'not-a-key'], // menos de 20
    ['sk-ant-' + 'a'.repeat(520), 'not-a-key'], // mais de 512
    ['sk-ant-abc def' + 'a'.repeat(20), 'not-a-key'], // espaço no meio
    ['sk-ant-api03-' + 'a'.repeat(20) + '\n' + 'b'.repeat(20), 'not-a-key'], // duas linhas
    ['sk-ant-api03-' + 'á'.repeat(20), 'not-a-key'],
    ['', 'not-a-key'],
  ] as const)('%s', (text, expected) => {
    expect(apiKeyProblem(text)).toBe(expected);
  });

  it('só o Claude Code tem conta por chave de API nesta entrega', () => {
    expect(isApiKeyProvider('claude')).toBe(true);
    expect(isApiKeyProvider('codex')).toBe(false);
    expect(API_KEY_VARIABLE).toEqual({ claude: 'ANTHROPIC_API_KEY' });
  });

  it('a frase da recusa não repete o texto lido', () => {
    const text = 'sk-ant-admin01-' + 'segredo'.repeat(6);
    expect(keyProblemText('admin-key')).toBe(
      'Esta é uma chave de administração. Use uma chave de API comum.',
    );
    expect(keyProblemText('not-a-key')).toBe(
      'A área de transferência não tem uma chave de API da Anthropic.',
    );
    expect(keyProblemText('admin-key')).not.toContain(text.slice(-8));
  });
});
