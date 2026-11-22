// CLI falso do `codex` aberto pelo menu "Abrir terminal", para o teste de ponta a ponta das contas do Codex por chave
// de API. Roda no Node do PATH (`APP_PANEL_CODEX_SCRIPT`, só com `PROJECT_HUB_ENV=test`). Diz se recebeu uma chave em
// `OPENAI_API_KEY`, mostrando só os 4 últimos caracteres, e se a linha do programa trouxe o provedor da conta API.
// Nunca imprime a chave inteira. Fica vivo até o teste digitar "sair".

import { createInterface } from 'node:readline';

const key = process.env.OPENAI_API_KEY ?? '';
console.log(key === '' ? 'chave: ausente' : `chave: presente, fim=${key.slice(-4)}`);

const args = process.argv.slice(2);
const withProvider =
  args.includes('model_provider=openai-chave-api') &&
  args.includes('model_providers.openai-chave-api.env_key=OPENAI_API_KEY');
console.log(withProvider ? 'provedor: openai-chave-api' : 'provedor: embutido');

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === 'sair') process.exit(0);
});
