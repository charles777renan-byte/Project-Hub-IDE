// CLI falso do `claude` e do `codex` para os comandos de conta (entrar, estado, sair) nos testes de ponta a ponta.
// Toma o lugar dos dois programas só nesses comandos (`APP_ACCOUNT_CLI_SCRIPT`, com `PROJECT_HUB_ENV=test`), como
// `node fake-account-cli.mjs <programa> <argumentos reais>`.
//
// O login fica em `login.json`, na pasta da conta: a de `CLAUDE_CONFIG_DIR` ou `CODEX_HOME`. Sem a variável (a
// conta Principal), numa pasta ao lado da pasta de trabalho, que é a pasta de dados do teste: a pasta real do
// programa na máquina nunca é tocada.
//
// Entrar: imprime o endereço de login, espera uma linha na entrada e grava o login. A linha com "@" vira o e-mail
// da conta; a linha "falhar" encerra sem login; qualquer outra usa o e-mail padrão.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const [provider, ...args] = process.argv.slice(2);
const command = args.join(' ');

const variable = provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
const folder =
  process.env[variable] !== undefined && process.env[variable] !== ''
    ? process.env[variable]
    : join(process.cwd(), `fake-principal-${provider}`);
const file = join(folder, 'login.json');

function readLogin() {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function login() {
  const url =
    provider === 'claude'
      ? 'https://claude.ai/oauth/exemplo?code=true'
      : 'https://auth.openai.com/exemplo';
  process.stdout.write(`Abra o navegador para entrar:\r\n\r\n${url}\r\n\r\nCole o código aqui: `);
  const lines = createInterface({ input: process.stdin });
  lines.once('line', (line) => {
    lines.close();
    const typed = line.trim();
    if (typed === 'falhar') {
      process.stdout.write('\r\nLogin recusado.\r\n');
      process.exit(1);
    }
    mkdirSync(folder, { recursive: true });
    const email = typed.includes('@') ? typed : 'conta@exemplo.test';
    writeFileSync(file, JSON.stringify({ email, orgName: 'Organização de teste' }));
    process.stdout.write('\r\nLogin concluído.\r\n');
    process.exit(0);
  });
}

function status() {
  const saved = readLogin();
  if (provider === 'claude') {
    process.stdout.write(
      JSON.stringify(
        saved === undefined
          ? { loggedIn: false, authMethod: 'none' }
          : { loggedIn: true, authMethod: 'claude.ai', email: saved.email, orgName: saved.orgName },
      ),
    );
    process.exit(saved === undefined ? 1 : 0);
  }
  // O Codex de verdade escreve a frase na saída de erro.
  process.stderr.write(saved === undefined ? 'Not logged in\n' : 'Logged in using ChatGPT\n');
  process.exit(saved === undefined ? 1 : 0);
}

function logout() {
  rmSync(file, { force: true });
  process.exit(0);
}

if (command === 'auth login --claudeai' || command === 'login') login();
else if (command === 'auth status --json' || command === 'login status') status();
else if (command === 'auth logout' || command === 'logout') logout();
else {
  process.stderr.write(`fake-account-cli: comando desconhecido: ${provider} ${command}\n`);
  process.exit(2);
}
