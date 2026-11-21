// CLI falso do `claude` aberto pelo menu "Abrir terminal", para o teste de ponta a ponta das contas em uso.
// Roda no Node do PATH (`APP_PANEL_CLAUDE_SCRIPT`, só com `PROJECT_HUB_ENV=test`). Diz em que pasta de conta abriu
// (`CLAUDE_CONFIG_DIR`; sem ela, é a conta Principal) e fica vivo até o teste digitar "sair".

import { createInterface } from 'node:readline';

console.log(`conta-falsa: pasta=${process.env.CLAUDE_CONFIG_DIR ?? '(principal)'}`);

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === 'sair') process.exit(0);
});
