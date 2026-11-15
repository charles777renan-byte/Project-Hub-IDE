import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PACKAGE_JSON_MAX, readProjectFacts } from '../src/main/preview/project-facts';

let dir: string | undefined;

function project(): string {
  dir = mkdtempSync(join(tmpdir(), 'ph-fatos-'));
  return dir;
}

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('readProjectFacts', () => {
  it('lê o package.json e os nomes dos arquivos da raiz', async () => {
    const root = project();
    writeFileSync(join(root, 'package.json'), '{"scripts":{"dev":"vite"}}');
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    writeFileSync(join(root, 'index.html'), '<h1>oi</h1>');
    mkdirSync(join(root, 'src'));

    const facts = await readProjectFacts(root);

    expect(facts.packageJson).toBe('{"scripts":{"dev":"vite"}}');
    expect([...facts.rootFiles].sort()).toEqual(['index.html', 'package.json', 'pnpm-lock.yaml']);
  });

  it('sem package.json, o texto é nulo', async () => {
    const root = project();
    writeFileSync(join(root, 'index.html'), '<h1>oi</h1>');
    const facts = await readProjectFacts(root);
    expect(facts.packageJson).toBeNull();
    expect(facts.rootFiles.has('index.html')).toBe(true);
  });

  it('uma pasta chamada index.html ou package.json não conta como arquivo', async () => {
    const root = project();
    mkdirSync(join(root, 'index.html'));
    mkdirSync(join(root, 'package.json'));
    const facts = await readProjectFacts(root);
    expect(facts.packageJson).toBeNull();
    expect(facts.rootFiles.size).toBe(0);
  });

  it('package.json acima de 1 MiB não é lido', async () => {
    const root = project();
    expect(PACKAGE_JSON_MAX).toBe(1024 * 1024);
    writeFileSync(join(root, 'package.json'), `{"x":"${'a'.repeat(PACKAGE_JSON_MAX)}"}`);
    const facts = await readProjectFacts(root);
    expect(facts.packageJson).toBeNull();
    expect(facts.rootFiles.has('package.json')).toBe(true);
  });

  it('pasta que não existe: nada achado, sem erro', async () => {
    const root = project();
    const facts = await readProjectFacts(join(root, 'sumiu'));
    expect(facts).toEqual({ packageJson: null, rootFiles: new Set() });
  });
});
