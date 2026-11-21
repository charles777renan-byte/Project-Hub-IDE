import { describe, expect, it } from 'vitest';
import { findLoginUrl, LOGIN_HOSTS, stripAnsi } from '../../src/main/accounts/login-scan';

describe('LOGIN_HOSTS', () => {
  it('são os servidores oficiais de login de cada programa', () => {
    expect(LOGIN_HOSTS).toEqual({
      claude: ['claude.ai', 'claude.com', 'console.anthropic.com', 'platform.claude.com'],
      codex: ['auth.openai.com'],
    });
  });
});

describe('stripAnsi', () => {
  it('tira cores, movimentos de cursor e links do terminal', () => {
    expect(stripAnsi('\u001b[1;32mok\u001b[0m\u001b[2K\u001b]8;;https://x.y\u0007link\u001b]8;;\u0007')).toBe(
      'oklink',
    );
  });
});

describe('findLoginUrl', () => {
  it('acha o endereço do Claude numa saída com códigos ANSI', () => {
    const output =
      'Abra no navegador:\r\n\u001b[36mhttps://claude.ai/oauth/authorize?code=true&client_id=abc\u001b[0m\r\nCole o código:';
    expect(findLoginUrl('claude', output)).toBe(
      'https://claude.ai/oauth/authorize?code=true&client_id=abc',
    );
  });

  it('acha o endereço do Codex', () => {
    expect(findLoginUrl('codex', 'Go to https://auth.openai.com/oauth/authorize?x=1 now')).toBe(
      'https://auth.openai.com/oauth/authorize?x=1',
    );
  });

  it('ignora http', () => {
    expect(findLoginUrl('claude', 'http://claude.ai/oauth')).toBeUndefined();
  });

  it('ignora servidor que só começa igual', () => {
    expect(findLoginUrl('claude', 'https://claude.ai.evil.com/x')).toBeUndefined();
  });

  it('ignora usuário no endereço', () => {
    expect(findLoginUrl('claude', 'https://claude.ai@evil.com/x')).toBeUndefined();
    expect(findLoginUrl('claude', 'https://user:pass@claude.ai/x')).toBeUndefined();
  });

  it('ignora porta', () => {
    expect(findLoginUrl('claude', 'https://claude.ai:8443/x')).toBeUndefined();
  });

  it('ignora o servidor de outro programa', () => {
    expect(findLoginUrl('codex', 'https://claude.ai/oauth')).toBeUndefined();
  });

  it('pula o endereço recusado e acha o permitido que vem depois', () => {
    expect(findLoginUrl('claude', 'docs: https://example.com/a\nhttps://claude.com/login?x=1')).toBe(
      'https://claude.com/login?x=1',
    );
  });

  it('sem endereço devolve undefined', () => {
    expect(findLoginUrl('claude', 'nada aqui')).toBeUndefined();
  });
});
