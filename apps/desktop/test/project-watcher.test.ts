import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectWatcher,
  isIgnoredChange,
  type WatchFn,
} from '../src/main/files/project-watcher';

// O explorador se atualiza sozinho (§4 do documento de UI/UX): um observador por pasta de projeto, no processo
// principal, com espera curta para agrupar as mudanças e sem as pastas de dependências e de saída.

function fakeWatch() {
  const watchers: { root: string; emit: (name: string | null) => void; closed: boolean }[] = [];
  const watch: WatchFn = (root, onChange) => {
    const entry = { root, emit: onChange, closed: false };
    watchers.push(entry);
    return {
      close: () => {
        entry.closed = true;
      },
    };
  };
  return { watch, watchers };
}

describe('isIgnoredChange', () => {
  it.each([
    'node_modules/react/index.js',
    'packages/app/node_modules/x.js',
    'dist/main.js',
    'apps/desktop/out/index.js',
    '.git/index',
    '.git',
  ])('ignora %s', (name) => {
    expect(isIgnoredChange(name)).toBe(true);
  });

  it.each(['src/app.ts', 'README.md', 'distribuicao/notas.md', 'src\\windows\\caminho.ts'])(
    'não ignora %s',
    (name) => {
      expect(isIgnoredChange(name)).toBe(false);
    },
  );

  it('separador do Windows também conta', () => {
    expect(isIgnoredChange('apps\\desktop\\node_modules\\x.js')).toBe(true);
  });
});

describe('createProjectWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('agrupa várias mudanças seguidas num aviso só, depois da espera', () => {
    const fake = fakeWatch();
    const watcher = createProjectWatcher({
      rootOf: () => 'C:/p',
      watch: fake.watch,
      debounceMs: 300,
    });
    const onChange = vi.fn();
    watcher.watch('p1', onChange);
    fake.watchers[0]?.emit('src/a.ts');
    fake.watchers[0]?.emit('src/b.ts');
    vi.advanceTimersByTime(299);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('mudança só em pasta ignorada não avisa; sem nome de arquivo, avisa', () => {
    const fake = fakeWatch();
    const watcher = createProjectWatcher({
      rootOf: () => 'C:/p',
      watch: fake.watch,
      debounceMs: 300,
    });
    const onChange = vi.fn();
    watcher.watch('p1', onChange);
    fake.watchers[0]?.emit('node_modules/x.js');
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    fake.watchers[0]?.emit(null);
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('dois ouvintes do mesmo projeto dividem um observador, que fecha quando o último sai', () => {
    const fake = fakeWatch();
    const watcher = createProjectWatcher({
      rootOf: () => 'C:/p',
      watch: fake.watch,
      debounceMs: 300,
    });
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = watcher.watch('p1', first);
    const stopSecond = watcher.watch('p1', second);
    expect(fake.watchers).toHaveLength(1);
    fake.watchers[0]?.emit('a.ts');
    vi.advanceTimersByTime(300);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    expect(fake.watchers[0]?.closed).toBe(false);
    stopSecond();
    expect(fake.watchers[0]?.closed).toBe(true);
  });

  it('parar duas vezes não tira outro ouvinte; parar antes da espera cancela o aviso', () => {
    const fake = fakeWatch();
    const watcher = createProjectWatcher({
      rootOf: () => 'C:/p',
      watch: fake.watch,
      debounceMs: 300,
    });
    const first = vi.fn();
    const stopFirst = watcher.watch('p1', first);
    const stopAgain = watcher.watch('p1', vi.fn());
    stopFirst();
    stopFirst();
    expect(fake.watchers[0]?.closed).toBe(false);
    fake.watchers[0]?.emit('a.ts');
    stopAgain();
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
  });

  it('projeto sem pasta conhecida, ou pasta que não dá para observar, não quebra: só não avisa', () => {
    const unknown = createProjectWatcher({ rootOf: () => undefined, watch: fakeWatch().watch });
    expect(() => unknown.watch('p1', vi.fn())()).not.toThrow();
    const failing = createProjectWatcher({
      rootOf: () => 'C:/sumiu',
      watch: () => {
        throw new Error('ENOENT');
      },
    });
    expect(() => failing.watch('p1', vi.fn())()).not.toThrow();
  });

  it('closeAll fecha todos os observadores', () => {
    const fake = fakeWatch();
    const watcher = createProjectWatcher({ rootOf: (id) => `C:/${id}`, watch: fake.watch });
    watcher.watch('a', vi.fn());
    watcher.watch('b', vi.fn());
    watcher.closeAll();
    expect(fake.watchers.map((item) => item.closed)).toEqual([true, true]);
  });
});
