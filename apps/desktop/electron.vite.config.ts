import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// Processo principal e preload: os pacotes do workspace (@project-hub/*) estão em devDependencies e
// por isso entram no bundle. O electron-vite só deixa de fora o que estiver em dependencies, e o
// better-sqlite3 (módulo nativo) está lá, como manda o ADR 0007.

/**
 * O código do banco lê as migrações em `../migrations`, relativo ao próprio arquivo. No bundle, esse
 * arquivo é `out/main/index.js`, então as migrações são copiadas para `out/migrations` ao fim de cada
 * build (seção 18.2). O empacotamento final (Tarefa 12) decide onde elas ficam.
 */
function copyMigrations(): Plugin {
  return {
    name: 'project-hub:copy-migrations',
    closeBundle() {
      cpSync(
        join(import.meta.dirname, '../../packages/database/migrations'),
        join(import.meta.dirname, 'out/migrations'),
        { recursive: true },
      );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [copyMigrations()],
  },
  preload: {
    build: {
      rolldownOptions: {
        // Preload com sandbox não carrega ES modules: a saída precisa ser CommonJS.
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {},
});
