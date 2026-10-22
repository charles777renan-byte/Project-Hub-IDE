import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClaudeAgent } from '../../src/main/claude-agent';

// O agente do app inteiro: sobe o processo de terminais empacotado, registra a execução e lê os hooks
// pelo pipe. Só o CLI é falso, e entra pela variável de ambiente do teste.
const appRoot = resolve(import.meta.dirname, '../..');
let dir = '';
let hostEntry = '';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ph-agent-'));
  hostEntry = join(dir, 'bundle', 'host.cjs');
  await build({
    root: appRoot,
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: join(appRoot, 'src/terminal-host/main.ts'),
      outDir: join(dir, 'bundle'),
      emptyOutDir: true,
      minify: false,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: 'host.cjs' } },
    },
  });
}, 60_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')(
  'agente do app com o processo de terminais real',
  () => {
    it('sonda o CLI: sem o claude no caminho, devolve indisponível com a mensagem', async () => {
      const agent = createClaudeAgent({
        dataDir: dir,
        hostEntry,
        execPath: process.execPath,
        env: process.env,
      });
      const result = await agent.probe({ configuration: {} });
      expect(typeof result.available).toBe('boolean');
    });

    it('declara as capacidades do Claude Code interativo', async () => {
      const agent = createClaudeAgent({
        dataDir: dir,
        hostEntry,
        execPath: process.execPath,
        env: process.env,
      });
      expect(await agent.getCapabilities({ configuration: {} })).toMatchObject({
        interactiveInput: true,
        approvals: false,
        pauseResume: false,
      });
    });
  },
);
