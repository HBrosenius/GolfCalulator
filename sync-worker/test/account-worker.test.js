import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth.js';

beforeAll(async () => {
  await env.ACCOUNTS_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,last_login_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_tokens (token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_snapshots (user_id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_profiles (user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,handicap REAL NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_tours (user_id TEXT NOT NULL,tour_code TEXT NOT NULL,role TEXT NOT NULL,member_id TEXT,joined_at INTEGER NOT NULL,PRIMARY KEY(user_id,tour_code));
  `);
});

describe('passwordless accounts and cloud snapshots', () => {
  it('exchanges each magic link once and protects snapshot access', async () => {
    const loginToken = 'm'.repeat(43);
    const now = Date.now();
    await env.ACCOUNTS_DB.prepare('INSERT INTO login_tokens (token_hash,email,expires_at,created_at) VALUES (?,?,?,?)')
      .bind(await hashToken(loginToken), 'ada@example.com', now + 60_000, now).run();

    const exchange = await SELF.fetch('https://worker.test/account/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: loginToken }),
    });
    expect(exchange.status).toBe(200);
    const signedIn = await exchange.json();
    expect(signedIn.user.email).toBe('ada@example.com');
    expect(signedIn.sessionToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/);

    const replay = await SELF.fetch('https://worker.test/account/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: loginToken }),
    });
    expect(replay.status).toBe(400);
    expect((await SELF.fetch('https://worker.test/account/snapshot')).status).toBe(401);

    const headers = { Authorization: `Bearer ${signedIn.sessionToken}` };
    const empty = await (await SELF.fetch('https://worker.test/account/snapshot', { headers })).json();
    expect(empty).toMatchObject({ version: 0, data: { players: [], rounds: [] } });

    const saved = await SELF.fetch('https://worker.test/account/snapshot', {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: 0, data: { courses: [], rounds: [], players: [{ id: 'p1', name: 'Ada' }], tours: [] } }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).version).toBe(1);

    const stale = await SELF.fetch('https://worker.test/account/snapshot', {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: 0, data: { courses: [], rounds: [], players: [], tours: [] } }),
    });
    expect(stale.status).toBe(409);

    expect((await SELF.fetch('https://worker.test/account/session', { method: 'DELETE', headers })).status).toBe(204);
    expect((await SELF.fetch('https://worker.test/account/me', { headers })).status).toBe(401);
  });

  it('stores a validated player profile for the stable account identity', async () => {
    const userId = crypto.randomUUID();
    const sessionToken = 'p'.repeat(43);
    const now = Date.now();
    await env.ACCOUNTS_DB.batch([
      env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)')
        .bind(userId, `${userId}@example.com`, now, now),
      env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)')
        .bind(await hashToken(sessionToken), userId, now + 60_000, now, now),
    ]);
    const headers = { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' };
    const saved = await SELF.fetch('https://worker.test/account/profile', {
      method: 'PUT', headers, body: JSON.stringify({ displayName: 'Ada', handicap: 12.4 }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ profile: { displayName: 'Ada', handicap: 12.4 } });
    const loaded = await SELF.fetch('https://worker.test/account/profile', { headers });
    expect(await loaded.json()).toMatchObject({ profile: { displayName: 'Ada', handicap: 12.4 } });
  });

  it('accepts authenticated snapshots above the live-mutation 16 KB limit', async () => {
    const userId = crypto.randomUUID();
    const sessionToken = 'z'.repeat(43);
    const now = Date.now();
    await env.ACCOUNTS_DB.batch([
      env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)')
        .bind(userId, `${userId}@example.com`, now, now),
      env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)')
        .bind(await hashToken(sessionToken), userId, now + 60_000, now, now),
    ]);
    const largeName = 'A'.repeat(24_000);
    const response = await SELF.fetch('https://worker.test/account/snapshot', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseVersion: 0,
        data: { courses: [], rounds: [], players: [{ id: 'large', name: largeName }], tours: [] },
      }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).version).toBe(1);
  });

  it('deletes cloud account data while requiring an authenticated session', async () => {
    const userId = crypto.randomUUID();
    const sessionToken = 'd'.repeat(43);
    const now = Date.now();
    await env.ACCOUNTS_DB.batch([
      env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)')
        .bind(userId, `${userId}@example.com`, now, now),
      env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)')
        .bind(await hashToken(sessionToken), userId, now + 60_000, now, now),
      env.ACCOUNTS_DB.prepare('INSERT INTO account_snapshots (user_id,version,payload,updated_at) VALUES (?,?,?,?)')
        .bind(userId, 1, JSON.stringify({ courses: [], rounds: [], players: [], tours: [] }), now),
    ]);
    expect((await SELF.fetch('https://worker.test/account/me', { method: 'DELETE' })).status).toBe(401);
    expect((await SELF.fetch('https://worker.test/account/me', {
      method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` },
    })).status).toBe(204);
    expect(await env.ACCOUNTS_DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()).toBeNull();
    expect(await env.ACCOUNTS_DB.prepare('SELECT user_id FROM account_snapshots WHERE user_id = ?').bind(userId).first()).toBeNull();
  });
});
