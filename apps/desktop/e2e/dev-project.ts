import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Projetos descartáveis dos testes do preview automático: um site estático e um projeto com servidor de
// desenvolvimento. Nada é instalado: o servidor é um `server.js` de `node:http`, e o comando é `node server.js`.

/** O `<h1>` do site estático recém-criado. */
export const STATIC_HEADING = 'Site estático de teste';
/** O `<h1>` da página que o `server.js` devolve. */
export const DEV_HEADING = 'Servidor de teste';
/** O texto do script `dev` de `createDevProject`. */
export const DEV_SCRIPT = 'node server.js';

const page = (title: string, heading: string): string =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body><h1 id="texto">${heading}</h1></body></html>\n`;

/** Grava o `index.html` da raiz com o `<h1>` dado (o elemento tem o id `texto`). */
export function writeStaticIndex(dir: string, heading: string): void {
  writeFileSync(join(dir, 'index.html'), page('Site estático', heading));
}

/** Site estático: um `index.html` com um `<h1>`, sem `package.json`. */
export function createStaticProject(dir: string): void {
  writeStaticIndex(dir, STATIC_HEADING);
}

/** Grava o `package.json` da raiz com o script `dev` dado. */
export function writeDevScript(dir: string, script: string): void {
  const manifest = { name: 'projeto-de-teste', private: true, scripts: { dev: script } };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * O servidor de desenvolvimento do teste. Escuta em 127.0.0.1 numa porta livre e anuncia o endereço como os
 * servidores de verdade fazem. Encerra sozinho depois de cinco minutos: se um teste falhar antes de fechar o
 * painel, o processo não fica para trás com a pasta do projeto aberta.
 */
const SERVER = `const http = require('node:http');

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(${JSON.stringify(page('Servidor de teste', DEV_HEADING))});
});

server.listen(0, '127.0.0.1', () => {
  console.log('Local: http://localhost:' + server.address().port + '/');
});

setTimeout(() => process.exit(0), 5 * 60 * 1000);
`;

/**
 * Projeto com servidor de desenvolvimento: `package.json` com `"dev": "node server.js"` e o `server.js`. Sem
 * arquivo de lock, o gerenciador que o app escolhe é o npm.
 */
export function createDevProject(dir: string): void {
  writeDevScript(dir, DEV_SCRIPT);
  writeFileSync(join(dir, 'server.js'), SERVER);
}
