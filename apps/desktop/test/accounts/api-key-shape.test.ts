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
  ] as const)('Claude Code: %s', (text, expected) => {
    expect(apiKeyProblem('claude', text)).toBe(expected);
  });

  it.each([
    ['sk-proj-' + 'a'.repeat(40), undefined],
    ['sk-svcacct-' + 'A1_-'.repeat(10), undefined],
    ['sk-' + 'a'.repeat(40), undefined], // chave antiga
    ['sk-admin-' + 'a'.repeat(40), 'admin-key'],
    ['sk-ant-api03-' + 'a'.repeat(40), 'not-a-key'], // chave da Anthropic na conta do Codex
    ['sk-' + 'a'.repeat(10), 'not-a-key'], // menos de 20
    ['sk-proj-' + 'a'.repeat(520), 'not-a-key'], // mais de 512
    ['sk-proj-abc def' + 'a'.repeat(20), 'not-a-key'], // espaço no meio
    ['proj-' + 'a'.repeat(40), 'not-a-key'],
    ['', 'not-a-key'],
  ] as const)('Codex: %s', (text, expected) => {
    expect(apiKeyProblem('codex', text)).toBe(expected);
  });

  it('o Claude Code e o Codex têm conta por chave de API, cada um com a sua variável', () => {
    expect(isApiKeyProvider('claude')).toBe(true);
    expect(isApiKeyProvider('codex')).toBe(true);
    expect(API_KEY_VARIABLE).toEqual({ claude: 'ANTHROPIC_API_KEY', codex: 'OPENAI_API_KEY' });
  });

  it('a frase da recusa não repete o texto lido', () => {
    const text = 'sk-ant-admin01-' + 'segredo'.repeat(6);
    expect(keyProblemText('claude', 'admin-key')).toBe(
      'Esta é uma chave de administração. Use uma chave de API comum.',
    );
    expect(keyProblemText('codex', 'admin-key')).toBe(
      'Esta é uma chave de administração. Use uma chave de API comum.',
    );
    expect(keyProblemText('claude', 'not-a-key')).toBe(
      'A área de transferência não tem uma chave de API da Anthropic.',
    );
    expect(keyProblemText('codex', 'not-a-key')).toBe(
      'A área de transferência não tem uma chave de API da OpenAI.',
    );
    expect(keyProblemText('claude', 'admin-key')).not.toContain(text.slice(-8));
  });
});
