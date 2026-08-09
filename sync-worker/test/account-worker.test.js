import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth.js';

beforeAll(async () => {
  await env.ACCOUNTS_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,last_login_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_tokens (token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,session_id TEXT,device_name TEXT,device_type TEXT);
    CREATE TABLE IF NOT EXISTS account_snapshots (user_id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_profiles (user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,handicap REAL NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_tours (user_id TEXT NOT NULL,tour_code TEXT NOT NULL,role TEXT NOT NULL,member_id TEXT,joined_at INTEGER NOT NULL,PRIMARY KEY(user_id,tour_code));
    CREATE TABLE IF NOT EXISTS account_security_events (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,event_type TEXT NOT NULL,created_at INTEGER NOT NULL,device_name TEXT,details TEXT);
    CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,preferences TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
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

    const concurrent = await Promise.all([1, 2].map(value => SELF.fetch('https://worker.test/account/snapshot', {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion: 1, data: { courses: [], rounds: [], players: [{ id: `p${value}` }], tours: [] } }),
    })));
    expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);

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
      env.ACCOUNTS_DB.prepare('INSERT INTO account_security_events (id,user_id,event_type,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), userId, 'session_created', now),
      env.ACCOUNTS_DB.prepare('INSERT INTO push_subscriptions (id,user_id,session_id,endpoint,p256dh,auth,preferences,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), userId, null, `https://fcm.googleapis.com/fcm/send/${userId}`, 'A'.repeat(65), 'B'.repeat(22), '{}', now, now),
    ]);
    expect((await SELF.fetch('https://worker.test/account/me', { method: 'DELETE' })).status).toBe(401);
    expect((await SELF.fetch('https://worker.test/account/me', {
      method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` },
    })).status).toBe(204);
    expect(await env.ACCOUNTS_DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()).toBeNull();
    expect(await env.ACCOUNTS_DB.prepare('SELECT user_id FROM account_snapshots WHERE user_id = ?').bind(userId).first()).toBeNull();
    expect(await env.ACCOUNTS_DB.prepare('SELECT user_id FROM push_subscriptions WHERE user_id = ?').bind(userId).first()).toBeNull();
    expect(await env.ACCOUNTS_DB.prepare('SELECT user_id FROM account_security_events WHERE user_id = ?').bind(userId).first()).toBeNull();
  });

  it('exports a portable archive without session credentials or push endpoints', async () => {
    const userId = crypto.randomUUID();
    const token = 'x'.repeat(43);
    const now = Date.now();
    await env.ACCOUNTS_DB.batch([
      env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)').bind(userId, `${userId}@example.com`, now, now),
      env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at,session_id,device_name,device_type) VALUES (?,?,?,?,?,?,?,?)')
        .bind(await hashToken(token), userId, now + 60_000, now, now, crypto.randomUUID(), 'Chrome', 'desktop'),
      env.ACCOUNTS_DB.prepare('INSERT INTO account_snapshots (user_id,version,payload,updated_at) VALUES (?,?,?,?)')
        .bind(userId, 2, JSON.stringify({ courses: [], rounds: [{ id: 1 }], players: [], tours: [] }), now),
    ]);
    const response = await SELF.fetch('https://worker.test/account/export', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const archive = await response.json();
    expect(archive).toMatchObject({ format: 'poangbogey-account-export', version: 1, account: { id: userId }, snapshot: { version: 2 } });
    expect(archive.snapshot.data.rounds).toEqual([{ id: 1 }]);
    expect(JSON.stringify(archive)).not.toContain(token);
    expect(JSON.stringify(archive)).not.toContain('tokenHash');
  });

  it('names and remotely revokes sessions while keeping a security log', async () => {
    const userId = crypto.randomUUID();
    const currentToken = 'c'.repeat(43);
    const otherToken = 'e'.repeat(43);
    const currentId = crypto.randomUUID();
    const otherId = crypto.randomUUID();
    const now = Date.now();
    await env.ACCOUNTS_DB.batch([
      env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)').bind(userId, `${userId}@example.com`, now, now),
      env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at,session_id,device_name,device_type) VALUES (?,?,?,?,?,?,?,?)')
        .bind(await hashToken(currentToken), userId, now + 60_000, now, now, currentId, 'Chrome på Windows', 'desktop'),
      env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at,session_id,device_name,device_type) VALUES (?,?,?,?,?,?,?,?)')
        .bind(await hashToken(otherToken), userId, now + 60_000, now, now, otherId, 'Safari på iOS', 'mobile'),
    ]);
    const headers = { Authorization: `Bearer ${currentToken}` };
    const sessions = await (await SELF.fetch('https://worker.test/account/sessions', { headers })).json();
    expect(sessions.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: currentId, current: true, deviceName: 'Chrome på Windows', deviceType: 'desktop' }),
      expect.objectContaining({ id: otherId, current: false, deviceName: 'Safari på iOS', deviceType: 'mobile' }),
    ]));
    expect((await SELF.fetch(`https://worker.test/account/sessions/${currentId}`, { method: 'DELETE', headers })).status).toBe(409);
    expect((await SELF.fetch(`https://worker.test/account/sessions/${otherId}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await SELF.fetch('https://worker.test/account/me', { headers: { Authorization: `Bearer ${otherToken}` } })).status).toBe(401);
    const events = await (await SELF.fetch('https://worker.test/account/security-events', { headers })).json();
    expect(events.events[0]).toMatchObject({ type: 'session_revoked', deviceName: 'Safari på iOS' });
  });

  it('stores per-session push subscriptions and notification preferences', async () => {
    const userId = crypto.randomUUID();
    const token = 'w'.repeat(43);
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    await env.ACCOUNTS_DB.batch([
      env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)').bind(userId, `${userId}@example.com`, now, now),
      env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at,session_id,device_name,device_type) VALUES (?,?,?,?,?,?,?,?)')
        .bind(await hashToken(token), userId, now + 60_000, now, now, sessionId, 'Chrome', 'desktop'),
    ]);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const saved = await SELF.fetch('https://worker.test/account/push', { method: 'PUT', headers, body: JSON.stringify({
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/subscription', keys: { p256dh: 'A'.repeat(65), auth: 'B'.repeat(22) } },
      preferences: { rounds: false, reminders: true },
    }) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ enabled: true, preferences: { rounds: false, reminders: true } });
    expect(await (await SELF.fetch('https://worker.test/account/push', { headers })).json()).toMatchObject({ enabled: true, preferences: { rounds: false } });
    expect((await SELF.fetch('https://worker.test/account/push', { method: 'DELETE', headers })).status).toBe(200);
  });
});
