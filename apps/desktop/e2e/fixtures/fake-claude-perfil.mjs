// CLI falso do `claude` interativo para o teste de ponta a ponta do perfil de execução. Roda num terminal do app,
// no Electron como Node (`APP_AGENT_SCRIPT` + `ELECTRON_RUN_AS_NODE=1`, só com `PROJECT_HUB_ENV=test`). Grava os
// argumentos que recebeu em `<CLAUDE_CONFIG_DIR>/fake-agent/argumentos.json` e termina em seguida, para o app
// fechar sem terminal aberto. Não dispara hooks nem grava transcript.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const configDir = process.env.CLAUDE_CONFIG_DIR;
if (configDir === undefined || configDir === '') {
  console.error('fake-claude-perfil: CLAUDE_CONFIG_DIR não foi definido.');
  process.exit(2);
}

const folder = join(configDir, 'fake-agent');
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, 'argumentos.json'), JSON.stringify(process.argv.slice(2)));
console.log('perfil-falso: argumentos gravados');
