import { describe, expect, it } from 'vitest';
import { buildWebPreferences } from '../src/main/window';

describe('buildWebPreferences', () => {
  it('preferências de segurança fixas', () => {
    expect(buildWebPreferences('/p/preload.js')).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('usa o preload recebido e não acrescenta outras opções', () => {
    expect(buildWebPreferences('/p/preload.js')).toEqual({
      preload: '/p/preload.js',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });
});
