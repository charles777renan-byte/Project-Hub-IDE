import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// Processo principal e preload: os pacotes do workspace (@project-hub/*) estão em devDependencies e
// por isso entram no bundle. O electron-vite só deixa de fora o que estiver em dependencies, e o
// better-sqlite3 (módulo nativo) está lá, como manda o ADR 0007.

/**
 * O código do banco lê as migrações em `../migrations`, relativo ao próprio arquivo. No bundle, esse
 * arquivo é `out/main/index.js`, então as migrações são copiadas para `out/migrations` (seção 18.2).
 * A cópia roda no início de cada build, também nos rebuilds do modo watch que o `dev` usa, e antes
 * de o bundle sair: o app nunca inicia sem a pasta. O empacotamento final (Tarefa 12) decide o resto.
 */
function copyMigrations(): Plugin {
  return {
    name: 'project-hub:copy-migrations',
    buildStart() {
      cpSync(
        join(import.meta.dirname, '../../packages/database/migrations'),
        join(import.meta.dirname, 'out/migrations'),
        { recursive: true },
      );
    },
  };
}

/**
 * Arquivo do react-router em produção que traz `"use client"` no topo. Só este arquivo entra no filtro.
 */
const REACT_ROUTER_PROD_ENTRY = /[\\/]react-router[\\/]dist[\\/]production[\\/]index\.js/;

export default defineConfig({
  main: {
    plugins: [copyMigrations()],
    build: {
      rolldownOptions: {
        input: {
          index: join(import.meta.dirname, 'src/main/index.ts'),
          // Processo de terminais: roda separado do app e continua vivo quando o app fecha. Sai como
          // out/main/terminal-host.js, e o app o sobe com o executável do Electron em modo Node.
          'terminal-host': join(import.meta.dirname, 'src/terminal-host/main.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        // Preload com sandbox não carrega ES modules: a saída precisa ser CommonJS.
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    build: {
      // O preset do electron-vite força `minify: false` no renderer. Com `true`, o Vite 8 usa o oxc.
      minify: true,
      rolldownOptions: {
        onwarn(warning, defaultHandler) {
          // A diretiva "use client" é marca para bundlers de React Server Components. Este app é só
          // cliente e roda no Chromium do Electron, onde a diretiva é uma string sem efeito. Por isso o
          // aviso MODULE_LEVEL_DIRECTIVE não indica risco neste bundle. O filtro é estreito: só esse
          // código e só o arquivo do react-router. Os demais avisos seguem para o handler padrão.
          if (
            warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
            REACT_ROUTER_PROD_ENTRY.test(warning.id ?? warning.message ?? '')
          ) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
  },
});
