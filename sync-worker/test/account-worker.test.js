import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth.js';

beforeAll(async () => {
  await env.ACCOUNTS_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,last_login_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_tokens (token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_snapshots (user_id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
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
});
