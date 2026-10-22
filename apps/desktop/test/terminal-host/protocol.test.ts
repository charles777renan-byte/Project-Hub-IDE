import { describe, expect, it } from 'vitest';
import {
  LineDecoder,
  MAX_LINE_BYTES,
  encodeMessage,
  parseRequest,
  terminalHostPipePath,
} from '../../src/terminal-host/protocol';

describe('encodeMessage', () => {
  it('termina a mensagem com uma quebra de linha', () => {
    expect(encodeMessage({ id: '1', type: 'ping' })).toBe('{"id":"1","type":"ping"}\n');
  });
});

describe('LineDecoder', () => {
  it('junta uma linha que chega em pedaços', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('{"id":"1",')).toEqual([]);
    expect(decoder.push('"type":"ping"}\n')).toEqual(['{"id":"1","type":"ping"}']);
  });

  it('devolve as linhas completas de uma vez e guarda o resto', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('a\nb\nc')).toEqual(['a', 'b']);
    expect(decoder.push('\n')).toEqual(['c']);
  });

  it('não quebra um caractere com acento que chega partido entre dois pedaços', () => {
    const decoder = new LineDecoder();
    const bytes = Buffer.from('ação\n', 'utf8');
    const cut = bytes.indexOf(0xc3) + 1;
    expect(decoder.push(bytes.subarray(0, cut))).toEqual([]);
    expect(decoder.push(bytes.subarray(cut))).toEqual(['ação']);
  });

  it('recusa uma linha acima do limite', () => {
    const decoder = new LineDecoder();
    expect(() => decoder.push('x'.repeat(MAX_LINE_BYTES + 1))).toThrow(/limite/);
  });
});

describe('parseRequest', () => {
  it('aceita hello com token e versão', () => {
    expect(parseRequest({ id: '1', type: 'hello', protocolVersion: 1, token: 'abc' })).toEqual({
      id: '1',
      type: 'hello',
      protocolVersion: 1,
      token: 'abc',
    });
  });

  it('aceita ping e shutdown', () => {
    expect(parseRequest({ id: '2', type: 'ping' })).toEqual({ id: '2', type: 'ping' });
    expect(parseRequest({ id: '3', type: 'shutdown' })).toEqual({ id: '3', type: 'shutdown' });
  });

  it('recusa um tipo que não existe', () => {
    expect(parseRequest({ id: '1', type: 'apagar-tudo' })).toBeNull();
  });

  it('recusa hello sem token', () => {
    expect(parseRequest({ id: '1', type: 'hello', protocolVersion: 1 })).toBeNull();
  });

  it('recusa um pedido sem id de texto', () => {
    expect(parseRequest({ id: 7, type: 'ping' })).toBeNull();
    expect(parseRequest('ping')).toBeNull();
  });
});

describe('parseRequest: pedidos de terminal', () => {
  it('aceita abrir um terminal com tamanho opcional', () => {
    expect(
      parseRequest({
        id: '1',
        type: 'terminal.open',
        terminalId: 't1',
        cwd: 'C:\\projeto',
        command: 'powershell.exe',
        args: ['-NoLogo'],
        env: { PATH: 'C:\\Windows' },
        cols: 120,
      }),
    ).toEqual({
      id: '1',
      type: 'terminal.open',
      terminalId: 't1',
      cwd: 'C:\\projeto',
      command: 'powershell.exe',
      args: ['-NoLogo'],
      env: { PATH: 'C:\\Windows' },
      cols: 120,
    });
  });

  it('aceita escrever, redimensionar, assinar e listar', () => {
    expect(
      parseRequest({ id: '2', type: 'terminal.write', terminalId: 't1', data: 'ls\r' }),
    ).toEqual({
      id: '2',
      type: 'terminal.write',
      terminalId: 't1',
      data: 'ls\r',
    });
    expect(
      parseRequest({ id: '3', type: 'terminal.resize', terminalId: 't1', cols: 80, rows: 24 }),
    ).toMatchObject({ type: 'terminal.resize', cols: 80, rows: 24 });
    expect(parseRequest({ id: '4', type: 'terminal.subscribe', terminalId: 't1' })).toMatchObject({
      type: 'terminal.subscribe',
    });
    expect(parseRequest({ id: '5', type: 'terminal.list' })).toEqual({
      id: '5',
      type: 'terminal.list',
    });
  });

  it('recusa abrir sem cwd, com argumentos que não são texto ou com tamanho inválido', () => {
    const base = {
      id: '1',
      type: 'terminal.open',
      terminalId: 't1',
      command: 'x',
      args: [],
      env: {},
    };
    expect(parseRequest(base)).toBeNull();
    expect(parseRequest({ ...base, cwd: 'C:\\', args: [1] })).toBeNull();
    expect(parseRequest({ ...base, cwd: 'C:\\', cols: 0 })).toBeNull();
    expect(parseRequest({ ...base, cwd: 'C:\\', rows: 1.5 })).toBeNull();
  });

  it('recusa um pedido de terminal sem terminalId', () => {
    expect(parseRequest({ id: '1', type: 'terminal.kill' })).toBeNull();
  });

  it('recusa redimensionar com tamanho que não é inteiro positivo', () => {
    expect(
      parseRequest({ id: '1', type: 'terminal.resize', terminalId: 't1', cols: -1, rows: 24 }),
    ).toBeNull();
  });
});

describe('terminalHostPipePath', () => {
  it('usa um pipe nomeado no Windows, com o nome do usuário', () => {
    expect(terminalHostPipePath('charl', 'win32')).toBe('\\\\.\\pipe\\project-hub-terminal-charl');
  });

  it('troca no nome do usuário o que não é letra, número, ponto, traço ou sublinhado', () => {
    expect(terminalHostPipePath('Ana Maria/x', 'win32')).toBe(
      '\\\\.\\pipe\\project-hub-terminal-Ana_Maria_x',
    );
  });

  it('fora do Windows, usa um arquivo de socket na pasta indicada', () => {
    expect(terminalHostPipePath('charl', 'linux', '/tmp')).toBe(
      '/tmp/project-hub-terminal-charl.sock',
    );
  });
});
