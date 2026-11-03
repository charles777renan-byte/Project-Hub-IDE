import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../src/main/providers';

const MISSING = (label: string) =>
  `${label} não foi encontrado no PATH. Instale o programa e reabra o Project Hub.`;

function windowsRegistry(files: string[], env: NodeJS.ProcessEnv = { PATH: 'C:\\bin' }) {
  return createProviderRegistry({
    env,
    platform: 'win32',
    exists: (path) => files.includes(path),
  });
}

describe('registro de provedores', () => {
  it('acha um .exe no PATH e roda direto', () => {
    const registry = windowsRegistry(['C:\\bin\\claude.exe']);

    expect(registry.resolve('claude')).toEqual({
      ok: true,
      launch: { command: 'C:\\bin\\claude.exe', args: [] },
    });
  });

  it('acha o agy na pasta padrão do instalador quando o PATH deste processo não tem a pasta', () => {
    const agy = 'C:\\Users\\ana\\AppData\\Local\\agy\\bin\\agy.exe';
    const registry = createProviderRegistry({
      env: { PATH: 'C:\\bin', LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' },
      platform: 'win32',
      exists: (path) => path === agy,
    });

    expect(registry.resolve('antigravity')).toEqual({
      ok: true,
      launch: { command: agy, args: [] },
    });
  });

  it('o PATH vem antes da pasta padrão do agy', () => {
    const fromPath = 'C:\\bin\\agy.exe';
    const registry = createProviderRegistry({
      env: { PATH: 'C:\\bin', LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' },
      platform: 'win32',
      exists: (path) => path === fromPath || path.endsWith('agy.exe'),
    });

    expect(registry.resolve('antigravity')).toEqual({
      ok: true,
      launch: { command: fromPath, args: [] },
    });
  });

  it('roda um .cmd por cmd.exe /d /c', () => {
    const registry = windowsRegistry(['C:\\bin\\codex.cmd']);

    expect(registry.resolve('codex')).toEqual({
      ok: true,
      launch: { command: 'cmd.exe', args: ['/d', '/c', 'C:\\bin\\codex.cmd'] },
    });
  });

  it('roda um .bat por cmd.exe /d /c e prefere .exe, depois .cmd, depois .bat', () => {
    expect(windowsRegistry(['C:\\bin\\agy.bat']).resolve('antigravity')).toEqual({
      ok: true,
      launch: { command: 'cmd.exe', args: ['/d', '/c', 'C:\\bin\\agy.bat'] },
    });
    expect(
      windowsRegistry(['C:\\bin\\codex.bat', 'C:\\bin\\codex.cmd', 'C:\\bin\\codex.exe']).resolve(
        'codex',
      ),
    ).toMatchObject({ launch: { command: 'C:\\bin\\codex.exe' } });
    expect(
      windowsRegistry(['C:\\bin\\codex.bat', 'C:\\bin\\codex.cmd']).resolve('codex'),
    ).toMatchObject({ launch: { args: ['/d', '/c', 'C:\\bin\\codex.cmd'] } });
  });

  it('procura em cada pasta do PATH, na ordem', () => {
    const registry = windowsRegistry(['D:\\tools\\claude.exe'], { PATH: 'C:\\bin;D:\\tools;' });

    expect(registry.resolve('claude')).toMatchObject({
      ok: true,
      launch: { command: 'D:\\tools\\claude.exe' },
    });
  });

  it('ignora entradas relativas do PATH', () => {
    const registry = windowsRegistry(['bin\\claude.exe', '.\\claude.exe'], {
      PATH: 'bin;.;C:\\bin',
    });

    expect(registry.resolve('claude').ok).toBe(false);
  });

  it('lê o PATH também como Path', () => {
    const registry = windowsRegistry(['C:\\bin\\claude.exe'], { Path: 'C:\\bin' });

    expect(registry.resolve('claude').ok).toBe(true);
  });

  it('programa ausente fica indisponível, com o motivo, na lista e no resolve', () => {
    const registry = windowsRegistry(['C:\\bin\\claude.exe']);

    expect(registry.list().find((info) => info.id === 'antigravity')).toEqual({
      id: 'antigravity',
      label: 'Antigravity CLI',
      available: false,
      reason: MISSING('Antigravity CLI'),
    });
    expect(registry.resolve('antigravity')).toEqual({
      ok: false,
      reason: MISSING('Antigravity CLI'),
    });
  });

  it('lista os seis provedores com rótulo e disponibilidade', () => {
    const registry = windowsRegistry(['C:\\bin\\claude.exe']);

    expect(registry.list()).toEqual([
      { id: 'claude', label: 'Claude Code', available: true },
      { id: 'codex', label: 'Codex', available: false, reason: MISSING('Codex') },
      {
        id: 'antigravity',
        label: 'Antigravity CLI',
        available: false,
        reason: MISSING('Antigravity CLI'),
      },
      { id: 'opencode', label: 'OpenCode', available: false, reason: MISSING('OpenCode') },
      { id: 'freebuff', label: 'Freebuff', available: false, reason: MISSING('Freebuff') },
      { id: 'shell', label: 'PowerShell', available: true },
    ]);
  });

  it('acha o OpenCode e o Freebuff pelo .cmd que o npm instala', () => {
    const registry = windowsRegistry(['C:\\bin\\opencode.cmd', 'C:\\bin\\freebuff.cmd']);

    expect(registry.resolve('opencode')).toEqual({
      ok: true,
      launch: { command: 'cmd.exe', args: ['/d', '/c', 'C:\\bin\\opencode.cmd'] },
    });
    expect(registry.resolve('freebuff')).toEqual({
      ok: true,
      launch: { command: 'cmd.exe', args: ['/d', '/c', 'C:\\bin\\freebuff.cmd'] },
    });
  });

  it('o shell do Windows é o PowerShell e está sempre disponível', () => {
    const registry = windowsRegistry([], {});

    expect(registry.resolve('shell')).toEqual({
      ok: true,
      launch: { command: 'powershell.exe', args: ['-NoLogo'] },
    });
    expect(registry.list().find((info) => info.id === 'shell')).toEqual({
      id: 'shell',
      label: 'PowerShell',
      available: true,
    });
  });

  it('no Linux, o shell usa SHELL do ambiente e, sem ela, /bin/bash', () => {
    const exists = () => false;

    expect(
      createProviderRegistry({ env: { SHELL: '/bin/zsh' }, platform: 'linux', exists }).resolve(
        'shell',
      ),
    ).toEqual({ ok: true, launch: { command: '/bin/zsh', args: [] } });
    const bare = createProviderRegistry({ env: {}, platform: 'linux', exists });
    expect(bare.resolve('shell')).toEqual({
      ok: true,
      launch: { command: '/bin/bash', args: [] },
    });
    expect(bare.list().find((info) => info.id === 'shell')?.label).toBe('Shell');
  });

  it('no Linux, procura o executável sem extensão nas pastas do PATH', () => {
    const registry = createProviderRegistry({
      env: { PATH: '/usr/bin:/opt/bin' },
      platform: 'linux',
      exists: (path) => path === '/opt/bin/codex',
    });

    expect(registry.resolve('codex')).toEqual({
      ok: true,
      launch: { command: '/opt/bin/codex', args: [] },
    });
    expect(registry.resolve('claude').ok).toBe(false);
  });
});
