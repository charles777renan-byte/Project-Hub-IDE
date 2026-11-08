import { describe, expect, it } from 'vitest';
import {
  CONTEXT_HIGH_FROM,
  contextDetailText,
  contextLevel,
  contextPercent,
  modelLabel,
} from '../../src/renderer/terminal-context';

/** O contexto de um terminal de agente: porcentagem, nível, texto de detalhe e rótulo do modelo. */

describe('contextPercent', () => {
  it('é a fração usada da janela, em inteiro', () => {
    expect(contextPercent({ usedTokens: 76_000, windowTokens: 200_000 })).toBe(38);
  });

  it('trunca, nunca arredonda para cima', () => {
    expect(contextPercent({ usedTokens: 1_999, windowTokens: 200_000 })).toBe(0);
    expect(contextPercent({ usedTokens: 159_999, windowTokens: 200_000 })).toBe(79);
  });

  it('tem teto de 100 quando o uso passa da janela', () => {
    expect(contextPercent({ usedTokens: 250_000, windowTokens: 200_000 })).toBe(100);
  });

  it('devolve 0 com janela zero ou negativa', () => {
    expect(contextPercent({ usedTokens: 5_000, windowTokens: 0 })).toBe(0);
    expect(contextPercent({ usedTokens: 5_000, windowTokens: -1 })).toBe(0);
  });
});

describe('contextLevel', () => {
  it('é normal abaixo de 80% e alto de 80% em diante', () => {
    expect(CONTEXT_HIGH_FROM).toBe(80);
    expect(contextLevel(0)).toBe('normal');
    expect(contextLevel(79)).toBe('normal');
    expect(contextLevel(80)).toBe('high');
    expect(contextLevel(100)).toBe('high');
  });
});

describe('contextDetailText', () => {
  it('traz usado, janela e porcentagem, com separador de milhar do Brasil', () => {
    expect(contextDetailText({ usedTokens: 76_000, windowTokens: 200_000 })).toBe(
      'Contexto: 76.000 de 200.000 tokens (38%)',
    );
  });

  it('mostra a porcentagem limitada a 100 quando o uso passa da janela', () => {
    expect(contextDetailText({ usedTokens: 250_000, windowTokens: 200_000 })).toBe(
      'Contexto: 250.000 de 200.000 tokens (100%)',
    );
  });
});

describe('modelLabel', () => {
  it('devolve a família com inicial maiúscula', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus');
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet');
    expect(modelLabel('claude-haiku-4-5')).toBe('Haiku');
    expect(modelLabel('claude-fable-1')).toBe('Fable');
    expect(modelLabel('claude-mythos-1')).toBe('Mythos');
  });

  it('aceita o id sem versão', () => {
    expect(modelLabel('claude-opus')).toBe('Opus');
  });

  it('devolve undefined para um id que não reconhece', () => {
    expect(modelLabel('modelo-x')).toBeUndefined();
    expect(modelLabel('')).toBeUndefined();
    expect(modelLabel('claude-opusx-1')).toBeUndefined();
    expect(modelLabel('gpt-5')).toBeUndefined();
  });
});
