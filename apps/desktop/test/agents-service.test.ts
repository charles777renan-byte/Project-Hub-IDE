import { describe, expect, it, vi } from 'vitest';
import type { ProviderId } from '@project-hub/contracts';
import type { ExecutionProfileRepository } from '@project-hub/database';
import type { ExecutionProfile } from '@project-hub/domain';
import {
  BUILT_IN_PROFILE_NAME,
  createAgentsService,
  DEFAULT_PROFILE_KEY,
  type AgentsServiceDeps,
} from '../src/main/agents/agents-service';
import type { ProviderLaunch } from '../src/main/providers';

const T0 = '2026-11-22T10:00:00.000Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function fakeProfiles(): ExecutionProfileRepository & { removed: string[] } {
  const rows = new Map<string, ExecutionProfile>();
  const removed: string[] = [];
  return {
    removed,
    insert: (profile) => void rows.set(profile.id, profile),
    get: (id) => rows.get(id),
    list: () => [...rows.values()],
    update(id, changes, at) {
      const current = rows.get(id);
      if (current === undefined) return;
      rows.set(id, { id, createdAt: current.createdAt, updatedAt: at, ...changes });
    },
    remove(id) {
      rows.delete(id);
      removed.push(id);
    },
  };
}

function harness(options: { installed?: ProviderId[]; version?: () => Promise<string> } = {}) {
  const profiles = fakeProfiles();
  const store = new Map<string, string>();
  const ids = [A, B];
  const launches: ProviderLaunch[] = [];
  const installed = options.installed ?? ['claude', 'codex'];
  const deps: AgentsServiceDeps = {
    profiles,
    settings: {
      get: (key) => store.get(key),
      set: (key, value) => void store.set(key, value),
      remove: (key) => void store.delete(key),
    },
    providers: {
      list: () => [],
      resolve: (id) =>
        installed.includes(id)
          ? { ok: true, launch: { command: `C:\\bin\\${id}.exe`, args: [] } }
          : { ok: false, reason: 'não encontrado' },
    },
    runVersion: (launch) => {
      launches.push(launch);
      return (options.version ?? (() => Promise.resolve('2.1.330 (Claude Code)\n')))();
    },
    newId: () => ids.shift() ?? 'sem-id',
    now: () => T0,
  };
  return { service: createAgentsService(deps), profiles, store, launches };
}

function data<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`falhou: ${JSON.stringify(result.error)}`);
  return result.data;
}

describe('serviço dos agentes: programas', () => {
  it('lista os cinco programas, com o papel de cada um e se está instalado', async () => {
    const h = harness({ installed: ['claude'] });

    const { programs } = data(await h.service.get());

    expect(programs).toEqual([
      { provider: 'claude', label: 'Claude Code', installed: true, role: 'missions' },
      { provider: 'codex', label: 'Codex', installed: false, role: 'panels' },
      { provider: 'antigravity', label: 'Antigravity CLI', installed: false, role: 'panels' },
      { provider: 'opencode', label: 'OpenCode', installed: false, role: 'panels' },
      { provider: 'freebuff', label: 'Freebuff', installed: false, role: 'panels' },
    ]);
  });

  it('o teste devolve a primeira linha da versão, aparada e sem cores do terminal', async () => {
    const h = harness({
      version: () => Promise.resolve('\u001b[32m 2.1.330 (Claude Code) \u001b[0m\r\nmais\n'),
    });

    expect(data(await h.service.testProgram({ provider: 'claude' }))).toEqual({
      version: '2.1.330 (Claude Code)',
    });
    expect(h.launches).toEqual([{ command: 'C:\\bin\\claude.exe', args: [] }]);
  });

  it('a versão longa é cortada em 80 caracteres', async () => {
    const h = harness({ version: () => Promise.resolve('v'.repeat(200)) });

    expect(data(await h.service.testProgram({ provider: 'claude' })).version).toHaveLength(80);
  });

  it('programa não instalado falha sem rodar nada', async () => {
    const h = harness({ installed: [] });

    const result = await h.service.testProgram({ provider: 'codex' });

    expect(result).toMatchObject({ ok: false, error: { code: 'AGENT_UNAVAILABLE' } });
    expect(h.launches).toEqual([]);
  });

  it('a falha do programa vira uma frase fixa: o erro bruto não vai para a tela', async () => {
    const h = harness({ version: () => Promise.reject(new Error('C:\\Users\\alguem\\segredo')) });

    const result = await h.service.testProgram({ provider: 'claude' });

    expect(result).toMatchObject({ ok: false, error: { code: 'AGENT_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('segredo');
  });

  it('saída vazia também é falha', async () => {
    const h = harness({ version: () => Promise.resolve('  \n') });

    expect((await h.service.testProgram({ provider: 'claude' })).ok).toBe(false);
  });

  it('dois testes do mesmo programa ao mesmo tempo rodam o programa uma vez só', async () => {
    let release: (value: string) => void = () => undefined;
    const version = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const h = harness({ version });

    const first = h.service.testProgram({ provider: 'claude' });
    const second = h.service.testProgram({ provider: 'claude' });
    release('1.0.0');

    expect(data(await first)).toEqual({ version: '1.0.0' });
    expect(data(await second)).toEqual({ version: '1.0.0' });
    expect(version).toHaveBeenCalledTimes(1);
  });
});

describe('serviço dos agentes: perfis', () => {
  it('sem perfis, só o embutido aparece, e ele é o padrão', async () => {
    const h = harness();

    expect(data(await h.service.get()).profiles).toEqual([
      { id: 'padrao', name: BUILT_IN_PROFILE_NAME, builtIn: true, isDefault: true },
    ]);
  });

  it('cria um perfil com as opções, e ele aparece depois do embutido', async () => {
    const h = harness();

    const created = data(await h.service.addProfile({ name: 'Rápido', model: 'haiku' }));

    expect(created).toEqual({
      id: A,
      name: 'Rápido',
      builtIn: false,
      isDefault: false,
      model: 'haiku',
    });
    expect(data(await h.service.get()).profiles.map((profile) => profile.name)).toEqual([
      BUILT_IN_PROFILE_NAME,
      'Rápido',
    ]);
  });

  it('recusa nome repetido, sem diferenciar maiúsculas, e o nome do perfil embutido', async () => {
    const h = harness();
    data(await h.service.addProfile({ name: 'Rápido' }));

    expect(await h.service.addProfile({ name: 'rápido' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Já existe um perfil com esse nome.' },
    });
    expect((await h.service.addProfile({ name: BUILT_IN_PROFILE_NAME.toUpperCase() })).ok).toBe(
      false,
    );
  });

  it('editar troca o nome e as opções; o próprio nome não conta como repetido', async () => {
    const h = harness();
    data(await h.service.addProfile({ name: 'Rápido', model: 'haiku', effort: 'low' }));

    data(await h.service.updateProfile({ id: A, name: 'Rápido', permissionMode: 'auto' }));

    expect(h.profiles.get(A)).toMatchObject({ name: 'Rápido', permissionMode: 'auto' });
    expect(h.profiles.get(A)).not.toHaveProperty('model');
  });

  it('editar um perfil que não existe mais falha', async () => {
    const h = harness();

    expect(await h.service.updateProfile({ id: A, name: 'x' })).toMatchObject({
      ok: false,
      error: { message: 'O perfil não existe mais.' },
    });
  });

  it('marcar como padrão vale para as missões novas, e voltar ao embutido limpa a marca', async () => {
    const h = harness();
    data(await h.service.addProfile({ name: 'Rápido' }));

    data(await h.service.setDefaultProfile({ id: A }));
    expect(h.service.directory.defaultId()).toBe(A);
    expect(data(await h.service.get()).profiles.map((profile) => profile.isDefault)).toEqual([
      false,
      true,
    ]);

    data(await h.service.setDefaultProfile({ id: 'padrao' }));
    expect(h.service.directory.defaultId()).toBe('padrao');
    expect(h.store.has(DEFAULT_PROFILE_KEY)).toBe(false);
  });

  it('não marca como padrão um perfil que não existe', async () => {
    const h = harness();

    expect((await h.service.setDefaultProfile({ id: A })).ok).toBe(false);
    expect(h.service.directory.defaultId()).toBe('padrao');
  });

  it('remover o perfil padrão devolve o padrão ao embutido', async () => {
    const h = harness();
    data(await h.service.addProfile({ name: 'Rápido' }));
    data(await h.service.setDefaultProfile({ id: A }));

    data(await h.service.removeProfile({ id: A }));

    expect(h.profiles.removed).toEqual([A]);
    expect(h.service.directory.defaultId()).toBe('padrao');
  });

  it('o padrão gravado de um perfil que sumiu vale como o embutido', () => {
    const h = harness();
    h.store.set(DEFAULT_PROFILE_KEY, B);

    expect(h.service.directory.defaultId()).toBe('padrao');
  });

  it('o diretório devolve o nome e as opções do perfil, e nada para o embutido', async () => {
    const h = harness();
    data(await h.service.addProfile({ name: 'Rápido', model: 'haiku', effort: 'low' }));

    expect(h.service.directory.get(A)).toEqual({
      name: 'Rápido',
      options: { model: 'haiku', effort: 'low' },
    });
    expect(h.service.directory.get('padrao')).toBeUndefined();
    expect(h.service.directory.get(B)).toBeUndefined();
  });
});
