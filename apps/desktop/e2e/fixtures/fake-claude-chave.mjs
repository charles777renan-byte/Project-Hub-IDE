// CLI falso do `claude` aberto pelo menu "Abrir terminal", para o teste de ponta a ponta das contas por chave de API.
// Roda no Node do PATH (`APP_PANEL_CLAUDE_SCRIPT`, só com `PROJECT_HUB_ENV=test`). Diz se recebeu uma chave em
// `ANTHROPIC_API_KEY` e mostra só os 4 últimos caracteres dela, nunca a chave inteira. Fica vivo até o teste digitar
// "sair".

import { createInterface } from 'node:readline';

const key = process.env.ANTHROPIC_API_KEY ?? '';
console.log(key === '' ? 'chave: ausente' : `chave: presente, fim=${key.slice(-4)}`);

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === 'sair') process.exit(0);
});
