import { createHash } from 'node:crypto';
import { hookCommand } from '../claude-code/settings';

/** Limites do próprio Codex: o hook de fim de sessão é cortado em 3 segundos. */
const START_TIMEOUT_SEC = 10;
const END_TIMEOUT_SEC = 3;

/**
 * A impressão digital que o Codex calcula para um hook de comando: SHA-256 do JSON da identidade (evento e
 * manipulador, com o tempo limite já ajustado), com as chaves em ordem e sem espaços. Conferida contra os
 * hashes que o Codex 0.167 gravou.
 */
function trustHash(event: string, command: string, timeoutSec: number): string {
  const identity = `{"event_name":"${event}","hooks":[{"async":false,"command":${JSON.stringify(command)},"timeout":${String(timeoutSec)},"type":"command"}]}`;
  return `sha256:${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

/**
 * Argumentos que ligam, só neste lançamento do Codex, os hooks de início e de fim de sessão ao script do app.
 * São opções `-c` (valor em TOML): nada é gravado em `~/.codex`, e os hooks da pessoa continuam valendo.
 *
 * O Codex só roda um hook em que a pessoa confiou. A confiança é uma impressão digital por hook, e o Codex a
 * aceita também pelas opções do lançamento: o terceiro `-c` declara a dos dois hooks daqui, e só deles. A
 * conferência dos outros hooks (da pessoa, do repositório, de plugins) segue como estava. Se uma versão nova
 * do Codex mudar a fórmula, os hooks deixam de rodar e o painel fica sem número, como antes.
 *
 * Os valores levam aspas, colchetes e `<`: servem para um executável chamado direto, e não para um `.cmd`,
 * em que o `cmd.exe` leria esses caracteres. Caminho com aspas ou apóstrofo é recusado.
 */
export function codexHookArgs(scriptPath: string, platform: NodeJS.Platform): string[] {
  if (scriptPath.includes("'")) throw new Error('caminho do hook com apóstrofo não é aceito');
  const command = hookCommand(scriptPath);
  // O Codex dá este caminho de mentira à camada das opções de lançamento; a chave de confiança parte dele.
  const source =
    platform === 'win32' ? 'C:\\<session-flags>\\config.toml' : '/<session-flags>/config.toml';
  const hook = (timeoutSec: number): string =>
    `[{hooks=[{type="command",command='${command}',timeout=${String(timeoutSec)}}]}]`;
  const trusted = (event: string, timeoutSec: number): string =>
    `'${source}:${event}:0:0'={trusted_hash="${trustHash(event, command, timeoutSec)}"}`;
  return [
    '-c',
    `hooks.SessionStart=${hook(START_TIMEOUT_SEC)}`,
    '-c',
    `hooks.SessionEnd=${hook(END_TIMEOUT_SEC)}`,
    '-c',
    `hooks.state={${trusted('session_start', START_TIMEOUT_SEC)},${trusted('session_end', END_TIMEOUT_SEC)}}`,
  ];
}
