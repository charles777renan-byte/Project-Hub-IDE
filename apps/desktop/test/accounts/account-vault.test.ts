import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AppResult } from '@project-hub/contracts';
import type { AccountSecretRepository, VaultMetaRepository } from '@project-hub/database';
import {
  KEY_MISSING,
  KEY_UNREADABLE,
  VAULT_BROKEN,
  VAULT_LOCKED,
  VAULT_WAIT,
  WRONG_PASSWORD,
  createAccountVault,
  type AccountVaultDeps,
} from '../../src/main/accounts/account-vault';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'senha-do-cofre-longa';
const OTHER_PASSWORD = 'outra-senha-bem-longa';
const KEY_A = 'sk-ant-api03-chave-falsa-da-conta-a-0123456789abcdefWXYZ';
const KEY_B = 'sk-ant-api03-chave-falsa-da-conta-b-9876543210zyxwvuQRST';
const KDF = { N: 2 ** 10, r: 8, p: 1 };

type Row = { ciphertext: Buffer; last4: string; updatedAt: string };

/** Repositórios em memória. A transação desfaz as linhas do cofre e o verificador se o trabalho lançar. */
function memory(options: { failPutAt?: number } = {}) {
  const rows = new Map<string, Row>();
  let meta: { salt: Buffer; verifier: Buffer } | undefined;
  let puts = 0;
  const secrets: AccountSecretRepository = {
    get: (id) => rows.get(id),
    list: () => [...rows].map(([accountId, row]) => ({ accountId, ...row })),
    put: (id, ciphertext, last4, at) => {
      puts += 1;
      if (options.failPutAt !== undefined && puts === options.failPutAt) {
        throw new Error('disco cheio');
      }
      rows.set(id, { ciphertext: Buffer.from(ciphertext), last4, updatedAt: at });
    },
    delete: (id) => void rows.delete(id),
    deleteAll: () => rows.clear(),
    transaction: <T>(run: () => T): T => {
      const savedRows = new Map(rows);
      const savedMeta = meta;
      try {
        return run();
      } catch (error) {
        rows.clear();
        for (const [id, row] of savedRows) rows.set(id, row);
        meta = savedMeta;
        throw error;
      }
    },
  };
  const vaultMeta: VaultMetaRepository = {
    get: () => meta,
    set: (salt, verifier) => {
      meta = { salt: Buffer.from(salt), verifier: Buffer.from(verifier) };
    },
    clear: () => {
      meta = undefined;
    },
  };
  return {
    rows,
    secrets,
    meta: vaultMeta,
    resetPuts: () => {
      puts = 0;
    },
    /** Tudo o que está gravado, em bytes. */
    stored: (): Buffer[] => [
      ...[...rows.values()].flatMap((row) => [row.ciphertext, Buffer.from(row.last4)]),
      ...(meta === undefined ? [] : [meta.salt, meta.verifier]),
    ],
  };
}

/** O `safeStorage` falso: um XOR de um byte, reversível, e que pode deixar de abrir. */
function fakeWrap() {
  const state = { available: true, broken: false };
  const xor = (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0x5a));
  return {
    state,
    wrap: {
      isAvailable: () => state.available,
      encrypt: (data: Buffer) => {
        if (!state.available) throw new Error('safeStorage indisponível');
        return xor(data);
      },
      decrypt: (data: Buffer) => {
        if (state.broken || !state.available)
          throw new Error('Error while decrypting the ciphertext');
        return xor(data);
      },
    },
  };
}

function setup(options: { failPutAt?: number } = {}) {
  const store = memory(options);
  const wrap = fakeWrap();
  const clock = { now: new Date('2026-11-21T10:00:00.000Z') };
  let changes = 0;
  const deps: AccountVaultDeps = {
    secrets: store.secrets,
    meta: store.meta,
    wrap: wrap.wrap,
    now: () => clock.now,
    kdf: KDF,
    onChange: () => {
      changes += 1;
    },
  };
  const vault = createAccountVault(deps);
  return {
    vault,
    store,
    wrap,
    clock,
    changes: () => changes,
    advance: (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
}

function ok<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso: ${result.error.message}`);
  return result.data;
}

function messageOf(result: AppResult<unknown>): string {
  if (result.ok) throw new Error('esperava falha');
  // O cofre trancado tem código próprio; as outras recusas são de validação.
  expect(result.error.code).toBe(
    result.error.message === VAULT_LOCKED ? 'VAULT_LOCKED' : 'VALIDATION_FAILED',
  );
  return result.error.message;
}

async function unlocked(options: { failPutAt?: number } = {}) {
  const h = setup(options);
  ok(await h.vault.create(PASSWORD));
  return h;
}

describe('cofre das chaves de API', () => {
  it('nasce vazio; criar a senha deixa o cofre destrancado', async () => {
    const h = setup();
    expect(h.vault.status()).toEqual({ state: 'empty', available: true });

    ok(await h.vault.create(PASSWORD));

    expect(h.vault.status()).toEqual({ state: 'unlocked', available: true });
    expect(h.changes()).toBeGreaterThan(0);
    expect((await h.vault.create(OTHER_PASSWORD)).ok).toBe(false);
  });

  it('cifra e decifra: reveal devolve a chave guardada', async () => {
    const h = await unlocked();

    expect(ok(h.vault.put(A, KEY_A))).toEqual({ last4: 'WXYZ' });

    expect(ok(h.vault.reveal(A))).toBe(KEY_A);
    expect(h.vault.check(A)).toBe('stored');
    expect(h.vault.last4Of(A)).toBe('WXYZ');
  });

  it('o texto cifrado gravado não contém a chave nem os 4 últimos em sequência com ela', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));

    const ciphertext = h.store.rows.get(A)?.ciphertext ?? Buffer.alloc(0);
    for (const piece of [KEY_A, KEY_A.slice(-20), KEY_A.slice(-8)]) {
      expect(ciphertext.includes(Buffer.from(piece))).toBe(false);
    }
    // Duas gravações da mesma chave não dão o mesmo texto cifrado (nonce novo a cada vez).
    ok(h.vault.put(A, KEY_A));
    expect(h.store.rows.get(A)?.ciphertext.equals(ciphertext)).toBe(false);
  });

  it('sem safeStorage disponível, create e put recusam', async () => {
    const h = setup();
    h.wrap.state.available = false;

    expect(h.vault.status().available).toBe(false);
    expect((await h.vault.create(PASSWORD)).ok).toBe(false);
    expect(h.store.stored()).toEqual([]);

    const u = await unlocked();
    u.wrap.state.available = false;
    expect(u.vault.put(A, KEY_A).ok).toBe(false);
    expect(u.store.rows.size).toBe(0);
  });

  it('trancado: reveal, put e check não decifram nada (VAULT_LOCKED / "locked")', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));
    h.vault.lock();

    expect(h.vault.status().state).toBe('locked');
    expect(messageOf(h.vault.reveal(A))).toBe(VAULT_LOCKED);
    expect(messageOf(h.vault.put(B, KEY_B))).toBe(VAULT_LOCKED);
    // Código próprio: quem lança distingue o cofre trancado de uma chave que falta.
    const revealed = h.vault.reveal(A);
    expect(revealed.ok ? undefined : revealed.error.code).toBe('VAULT_LOCKED');
    expect(h.vault.check(A)).toBe('locked');
    // Os 4 últimos não precisam do cofre aberto.
    expect(h.vault.last4Of(A)).toBe('WXYZ');
  });

  it('senha errada não destranca e devolve "Senha incorreta."', async () => {
    const h = await unlocked();
    h.vault.lock();

    expect(messageOf(await h.vault.unlock(OTHER_PASSWORD))).toBe(WRONG_PASSWORD);
    expect(h.vault.status().state).toBe('locked');

    ok(await h.vault.unlock(PASSWORD));
    expect(h.vault.status().state).toBe('unlocked');
  });

  it('depois de 5 erros seguidos a espera cresce: 2 s, 4 s, 8 s, até 60 s', async () => {
    const h = await unlocked();
    h.vault.lock();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(messageOf(await h.vault.unlock(OTHER_PASSWORD))).toBe(WRONG_PASSWORD);
      expect(h.vault.status().retryAt).toBeUndefined();
    }
    const waits: number[] = [];
    for (let attempt = 5; attempt <= 11; attempt += 1) {
      expect(messageOf(await h.vault.unlock(OTHER_PASSWORD))).toBe(WRONG_PASSWORD);
      const retryAt = h.vault.status().retryAt;
      expect(retryAt).toBeDefined();
      const wait = new Date(retryAt ?? '').getTime() - h.clock.now.getTime();
      waits.push(wait);
      // Durante a espera, nem a senha certa é tentada.
      expect(messageOf(await h.vault.unlock(PASSWORD))).toBe(VAULT_WAIT);
      h.advance(wait);
    }

    expect(waits).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
  });

  it('senha certa zera a contagem de erros', async () => {
    const h = await unlocked();
    h.vault.lock();
    for (let attempt = 1; attempt <= 4; attempt += 1) await h.vault.unlock(OTHER_PASSWORD);

    ok(await h.vault.unlock(PASSWORD));
    h.vault.lock();
    for (let attempt = 1; attempt <= 4; attempt += 1) await h.vault.unlock(OTHER_PASSWORD);

    expect(h.vault.status().retryAt).toBeUndefined();
  });

  it('senha com menos de 12 caracteres é recusada na criação e na troca', async () => {
    const h = setup();
    expect((await h.vault.create('curta-11chr')).ok).toBe(false);
    expect(h.vault.status().state).toBe('empty');

    ok(await h.vault.create('exatamente12'));
    expect((await h.vault.changePassword('exatamente12', 'curta-11chr')).ok).toBe(false);
    h.vault.lock();
    ok(await h.vault.unlock('exatamente12'));
  });

  it('lock apaga a chave derivada: reveal volta a falhar com VAULT_LOCKED', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));

    h.vault.lock();

    expect(messageOf(h.vault.reveal(A))).toBe(VAULT_LOCKED);
    ok(await h.vault.unlock(PASSWORD));
    expect(ok(h.vault.reveal(A))).toBe(KEY_A);
  });

  it('conta sem linha no cofre: check "missing" e reveal com KEY_MISSING', async () => {
    const h = await unlocked();

    expect(h.vault.check(A)).toBe('missing');
    expect(messageOf(h.vault.reveal(A))).toBe(KEY_MISSING);
    expect(h.vault.last4Of(A)).toBeUndefined();
    h.vault.lock();
    expect(h.vault.check(A)).toBe('missing');
  });

  it('linha corrompida: check "unreadable" e reveal com KEY_UNREADABLE, sem exceção', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));
    const row = h.store.rows.get(A);
    if (row === undefined) throw new Error('sem linha');
    row.ciphertext[row.ciphertext.length - 1] = (row.ciphertext.at(-1) ?? 0) ^ 0xff;
    h.store.rows.set(B, { ciphertext: Buffer.from([1, 2, 3]), last4: 'abcd', updatedAt: 'x' });

    expect(h.vault.check(A)).toBe('unreadable');
    expect(messageOf(h.vault.reveal(A))).toBe(KEY_UNREADABLE);
    expect(h.vault.check(B)).toBe('unreadable');
    expect(messageOf(h.vault.reveal(B))).toBe(KEY_UNREADABLE);
  });

  it('wrap.decrypt que lança: unlock não lança, e as contas ficam "unreadable"', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));
    h.vault.lock();
    h.wrap.state.broken = true;

    const result = await h.vault.unlock(PASSWORD);

    expect(messageOf(result)).toBe(VAULT_BROKEN);
    expect(h.vault.check(A)).toBe('unreadable');
    expect(messageOf(h.vault.reveal(A))).toBe(KEY_UNREADABLE);
    // Redefinir continua funcionando, e o cofre volta a nascer.
    h.vault.reset();
    h.wrap.state.broken = false;
    expect(h.vault.status().state).toBe('empty');
    ok(await h.vault.create(PASSWORD));
    expect(h.vault.check(A)).toBe('missing');
  });

  it('changePassword regrava todas as chaves e a senha antiga deixa de abrir', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));
    ok(h.vault.put(B, KEY_B));
    const before = h.store.rows.get(A)?.ciphertext;

    expect(ok(await h.vault.changePassword(PASSWORD, OTHER_PASSWORD))).toEqual({ lost: [] });

    expect(h.store.rows.get(A)?.ciphertext.equals(before ?? Buffer.alloc(0))).toBe(false);
    expect(h.store.rows.get(A)?.last4).toBe('WXYZ');
    h.vault.lock();
    expect(messageOf(await h.vault.unlock(PASSWORD))).toBe(WRONG_PASSWORD);
    ok(await h.vault.unlock(OTHER_PASSWORD));
    expect(ok(h.vault.reveal(A))).toBe(KEY_A);
    expect(ok(h.vault.reveal(B))).toBe(KEY_B);
  });

  it('changePassword com a senha atual errada não muda nada', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));

    expect(messageOf(await h.vault.changePassword(OTHER_PASSWORD, 'nova-senha-bem-longa'))).toBe(
      WRONG_PASSWORD,
    );

    h.vault.lock();
    ok(await h.vault.unlock(PASSWORD));
    expect(ok(h.vault.reveal(A))).toBe(KEY_A);
  });

  it('changePassword com uma linha ilegível: regrava as boas, apaga a ilegível e a lista em lost, numa transação', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));
    ok(h.vault.put(B, KEY_B));
    h.store.rows.set(C, { ciphertext: Buffer.from([9, 9, 9]), last4: 'zzzz', updatedAt: 'x' });

    expect(ok(await h.vault.changePassword(PASSWORD, OTHER_PASSWORD))).toEqual({ lost: [C] });

    expect(h.store.rows.has(C)).toBe(false);
    h.vault.lock();
    ok(await h.vault.unlock(OTHER_PASSWORD));
    expect(ok(h.vault.reveal(A))).toBe(KEY_A);
    expect(ok(h.vault.reveal(B))).toBe(KEY_B);
  });

  it('changePassword que falha no meio não deixa nada regravado', async () => {
    const h = await unlocked({ failPutAt: 4 });
    ok(h.vault.put(A, KEY_A));
    ok(h.vault.put(B, KEY_B));
    const before = new Map([...h.store.rows].map(([id, row]) => [id, Buffer.from(row.ciphertext)]));

    // As duas primeiras gravações são as chaves; a terceira regrava A e a quarta (regravar B) lança.
    const result = await h.vault.changePassword(PASSWORD, OTHER_PASSWORD);

    expect(result.ok).toBe(false);
    for (const [id, ciphertext] of before) {
      expect(h.store.rows.get(id)?.ciphertext.equals(ciphertext)).toBe(true);
    }
    h.vault.lock();
    ok(await h.vault.unlock(PASSWORD));
    expect(ok(h.vault.reveal(A))).toBe(KEY_A);
    expect(ok(h.vault.reveal(B))).toBe(KEY_B);
  });

  it('reset apaga as chaves e o verificador; o cofre volta a "empty"', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));

    h.vault.reset();

    expect(h.vault.status()).toEqual({ state: 'empty', available: true });
    expect(h.store.stored()).toEqual([]);
    // Depois de redefinir, falta a chave, e não a senha: pedir a senha não resolveria nada.
    expect(messageOf(h.vault.reveal(A))).toBe(KEY_MISSING);
  });

  it('trancado, a conta sem chave guardada diz que falta a chave, e não que o cofre está trancado', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));
    h.vault.lock();

    expect(messageOf(h.vault.reveal(B))).toBe(KEY_MISSING);
    expect(messageOf(h.vault.reveal(A))).toBe(VAULT_LOCKED);
  });

  it('remove apaga a chave da conta', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));

    h.vault.remove(A);

    expect(h.vault.check(A)).toBe('missing');
  });

  it('nenhuma mensagem de falha contém a chave ou a senha', async () => {
    const messages: string[] = [];
    const collect = (result: AppResult<unknown>) => {
      if (!result.ok) messages.push(result.error.message, JSON.stringify(result.error));
    };
    const h = setup();
    collect(await h.vault.create('curta'));
    collect(await h.vault.unlock(PASSWORD));
    ok(await h.vault.create(PASSWORD));
    ok(h.vault.put(A, KEY_A));
    collect(await h.vault.changePassword(OTHER_PASSWORD, 'nova-senha-bem-longa'));
    collect(await h.vault.changePassword(PASSWORD, 'curta'));
    h.vault.lock();
    collect(h.vault.reveal(A));
    collect(h.vault.put(A, KEY_A));
    for (let attempt = 0; attempt < 6; attempt += 1) collect(await h.vault.unlock(OTHER_PASSWORD));
    collect(await h.vault.unlock(PASSWORD));
    h.wrap.state.broken = true;
    h.advance(120_000);
    collect(await h.vault.unlock(PASSWORD));

    expect(messages.length).toBeGreaterThan(8);
    for (const message of messages) {
      for (const secret of [KEY_A, KEY_A.slice(-8), PASSWORD, OTHER_PASSWORD]) {
        expect(message).not.toContain(secret);
      }
      expect(message).not.toContain('decrypting');
    }
  });

  it('a senha e a chave derivada não aparecem em nada gravado', async () => {
    const h = await unlocked();
    ok(h.vault.put(A, KEY_A));
    ok(await h.vault.changePassword(PASSWORD, OTHER_PASSWORD));

    const salt = h.store.meta.get()?.salt ?? Buffer.alloc(0);
    const derived = scryptSync(OTHER_PASSWORD, salt, 32, KDF);
    for (const bytes of h.store.stored()) {
      for (const secret of [
        Buffer.from(PASSWORD),
        Buffer.from(OTHER_PASSWORD),
        derived,
        Buffer.from(KEY_A),
      ]) {
        expect(bytes.includes(secret)).toBe(false);
      }
    }
  });
});
