/**
 * Variáveis do ambiente do app que o terminal recebe. Qualquer outra fica de fora: tokens, chaves de API
 * e variáveis de controle do próprio app não chegam ao shell nem ao agente por herança.
 * Os nomes são comparados sem diferenciar maiúsculas, como o Windows faz.
 */
export const TERMINAL_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'COMPUTERNAME',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'USERNAME',
  'USERDOMAIN',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  // Pasta de dados do Claude Code (login e transcripts). É caminho, não segredo; sem ela, o terminal usaria
  // outra conta e o app leria o gasto de outra pasta.
  'CLAUDE_CONFIG_DIR',
  // O mesmo para a pasta de dados do Codex (login e sessões).
  'CODEX_HOME',
];

/**
 * Monta o ambiente de um terminal: só o que está na lista, mais as variáveis extras. As extras vêm de
 * quem abre o terminal, e substituem a variável de mesmo nome do ambiente.
 */
export function buildTerminalEnv(
  source: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const allowed = new Set(TERMINAL_ENV_ALLOWLIST);
  // No Windows o nome da variável não diferencia maiúsculas, e num bloco com duas vale a primeira: a do ambiente
  // sai quando há uma extra de mesmo nome em outra caixa, para a extra ser a única.
  const replaced = new Set(Object.keys(extra).map((key) => key.toUpperCase()));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const name = key.toUpperCase();
    if (value !== undefined && allowed.has(name) && !replaced.has(name)) env[key] = value;
  }
  return { ...env, ...extra };
}
