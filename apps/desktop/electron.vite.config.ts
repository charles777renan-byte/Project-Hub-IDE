import { defineConfig } from 'electron-vite';

// Processo principal e preload: os pacotes do workspace (@project-hub/*) estão em devDependencies e
// por isso entram no bundle. O electron-vite só deixa de fora o que estiver em dependencies.
export default defineConfig({
  main: {},
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
