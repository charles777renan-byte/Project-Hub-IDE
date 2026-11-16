import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codexHookArgs } from '../../src/codex/hooks';

const SCRIPT =
  'C:\\Users\\Maria\\AppData\\Roaming\\Project Hub\\configuração\\project-hub-hook.cjs';
const COMMAND =
  'node "C:/Users/Maria/AppData/Roaming/Project Hub/configuração/project-hub-hook.cjs"';

/** Os valores de `-c`, na ordem, sem os próprios `-c`. */
function overrides(args: readonly string[]): string[] {
  expect(args.filter((_arg, index) => index % 2 === 0).every((arg) => arg === '-c')).toBe(true);
  return args.filter((_arg, index) => index % 2 === 1);
}

describe('codexHookArgs', () => {
  it('liga só SessionStart e SessionEnd', () => {
    const values = overrides(codexHookArgs(SCRIPT, 'win32'));
    expect(values.map((value) => value.slice(0, value.indexOf('=')))).toEqual([
      'hooks.SessionStart',
      'hooks.SessionEnd',
      'hooks.state',
    ]);
  });

  it('o comando aguenta espaço e acento no caminho', () => {
    const [start, end] = overrides(codexHookArgs(SCRIPT, 'win32'));
    expect(start).toBe(
      `hooks.SessionStart=[{hooks=[{type="command",command='${COMMAND}',timeout=10}]}]`,
    );
    expect(end).toBe(
      `hooks.SessionEnd=[{hooks=[{type="command",command='${COMMAND}',timeout=3}]}]`,
    );
  });

  it('confia só nos dois hooks do app, pela impressão digital que o Codex calcula', () => {
    // A fórmula foi conferida contra hashes que o Codex 0.167 gravou: SHA-256 do JSON da identidade do hook,
    // com as chaves em ordem e sem espaços.
    const hash = (event: string, timeout: number): string =>
      `sha256:${createHash('sha256')
        .update(
          `{"event_name":"${event}","hooks":[{"async":false,"command":${JSON.stringify(COMMAND)},"timeout":${String(timeout)},"type":"command"}]}`,
          'utf8',
        )
        .digest('hex')}`;
    const state = overrides(codexHookArgs(SCRIPT, 'win32'))[2];
    expect(state).toBe(
      'hooks.state={' +
        `'C:\\<session-flags>\\config.toml:session_start:0:0'={trusted_hash="${hash('session_start', 10)}"},` +
        `'C:\\<session-flags>\\config.toml:session_end:0:0'={trusted_hash="${hash('session_end', 3)}"}}`,
    );
  });

  it('fora do Windows, a origem dos hooks é /<session-flags>/config.toml', () => {
    const state = overrides(codexHookArgs('/home/maria/.config/hook.cjs', 'linux'))[2];
    expect(state).toContain("'/<session-flags>/config.toml:session_start:0:0'=");
    expect(state).toContain("'/<session-flags>/config.toml:session_end:0:0'=");
  });

  it('recusa caminho com aspas ou apóstrofo', () => {
    expect(() => codexHookArgs('C:\\pasta"x\\hook.cjs', 'win32')).toThrow();
    expect(() => codexHookArgs("C:\\pasta'x\\hook.cjs", 'win32')).toThrow();
  });

  it('nunca leva o endereço nem o token do receptor', () => {
    const text = codexHookArgs(SCRIPT, 'win32').join(' ');
    expect(text).not.toContain('PROJECT_HUB_HOOK');
    expect(text).not.toContain('http://');
  });
});
