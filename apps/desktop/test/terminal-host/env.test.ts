import { describe, expect, it } from 'vitest';
import { buildTerminalEnv } from '../../src/terminal-host/env';

describe('buildTerminalEnv', () => {
  it('passa as variáveis da lista: caminho, pastas do usuário e idioma', () => {
    const env = buildTerminalEnv({
      PATH: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\charl',
      LANG: 'pt_BR.UTF-8',
    });
    expect(env).toEqual({
      PATH: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\charl',
      LANG: 'pt_BR.UTF-8',
    });
  });

  it('deixa de fora segredos e variáveis que não estão na lista', () => {
    const env = buildTerminalEnv({
      PATH: 'C:\\Windows',
      ANTHROPIC_API_KEY: 'chave',
      GITHUB_TOKEN: 'token',
      NODE_OPTIONS: '--inspect',
      ELECTRON_RUN_AS_NODE: '1',
      npm_config_registry: 'https://exemplo',
      PROJECT_HUB_DATA_DIR: 'C:\\dados',
    });
    expect(Object.keys(env)).toEqual(['PATH']);
  });

  it('reconhece o nome da variável sem diferenciar maiúsculas, como o Windows', () => {
    const env = buildTerminalEnv({ Path: 'C:\\Windows', temp: 'C:\\Temp' });
    expect(env).toEqual({ Path: 'C:\\Windows', temp: 'C:\\Temp' });
  });

  it('acrescenta as variáveis extras, que substituem as do ambiente de mesmo nome', () => {
    const env = buildTerminalEnv({ PATH: 'C:\\Windows' }, { TERM: 'xterm-256color', PATH: 'X' });
    expect(env).toEqual({ PATH: 'X', TERM: 'xterm-256color' });
  });
});
