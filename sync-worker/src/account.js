import { bearerToken, generateToken, hashToken } from './auth.js';

const LOGIN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 1_500_000;
const encoder = new TextEncoder();

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function accountJson(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.some(key => !['courses', 'rounds', 'players', 'tours'].includes(key))) return false;
  return ['courses', 'rounds', 'players', 'tours'].every(key => value[key] === undefined || Array.isArray(value[key]));
}

async function sendMagicLink(env, email, token, idempotencyKey) {
  if (!env.RESEND_API_KEY || !env.ACCOUNT_FROM_EMAIL || !env.APP_BASE_URL) throw new Error('Account email is not configured');
  const base = String(env.APP_BASE_URL).replace(/#.*$/, '');
  const link = `${base}#account_token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: env.ACCOUNT_FROM_EMAIL,
      to: [email],
      subject: 'Logga in i Poängbogey',
      html: `<p>Tryck på länken för att logga in i Poängbogey.</p><p><a href="${link}">Logga in</a></p><p>Länken gäller i 15 minuter och kan bara användas en gång.</p>`,
      text: `Logga in i Poängbogey: ${link}\n\nLänken gäller i 15 minuter och kan bara användas en gång.`,
    }),
  });
  if (!response.ok) throw new Error(`Email delivery failed (${response.status})`);
}

async function userForSession(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const row = await env.ACCOUNTS_DB.prepare(`
    SELECT users.id, users.email, users.created_at AS createdAt
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).bind(tokenHash, now).first();
  if (!row) return null;
  await env.ACCOUNTS_DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run();
  return { ...row, tokenHash };
}

export async function requestMagicLink(body, request, env) {
  const email = normalizeEmail(body?.email);
  // Always return the same response so this endpoint cannot enumerate accounts.
  const accepted = () => accountJson({ ok: true, message: 'Om adressen är giltig skickas en inloggningslänk.' }, 202);
  if (!email) return accepted();

  const clientKey = `account:${request.headers.get('CF-Connecting-IP') || 'local'}`;
  if (!await env.CREATE_LIMITER.getByName(clientKey).check()) return accepted();
  const emailKey = `email:${await hashToken(email)}`;
  if (!await env.CREATE_LIMITER.getByName(emailKey).check()) return accepted();

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  await env.ACCOUNTS_DB.batch([
    env.ACCOUNTS_DB.prepare('DELETE FROM login_tokens WHERE email = ? OR expires_at <= ?').bind(email, now),
    env.ACCOUNTS_DB.prepare('INSERT INTO login_tokens (token_hash,email,expires_at,created_at) VALUES (?,?,?,?)')
      .bind(tokenHash, email, now + LOGIN_TTL_MS, now),
  ]);
  try {
    await sendMagicLink(env, email, token, tokenHash);
  } catch (error) {
    await env.ACCOUNTS_DB.prepare('DELETE FROM login_tokens WHERE token_hash = ?').bind(tokenHash).run();
    console.error(JSON.stringify({ level: 'error', message: 'magic_link_delivery_failed' }));
  }
  return accepted();
}

export async function exchangeMagicLink(body, env) {
  const rawToken = typeof body?.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) return accountJson({ error: 'Ogiltig eller utgången länk' }, 400);
  const tokenHash = await hashToken(rawToken);
  const now = Date.now();
  const login = await env.ACCOUNTS_DB.prepare(
    'DELETE FROM login_tokens WHERE token_hash = ? AND expires_at > ? RETURNING email'
  ).bind(tokenHash, now).first();
  if (!login) return accountJson({ error: 'Ogiltig eller utgången länk' }, 400);

  let user = await env.ACCOUNTS_DB.prepare('SELECT id,email,created_at AS createdAt FROM users WHERE email = ?').bind(login.email).first();
  if (!user) {
    user = { id: crypto.randomUUID(), email: login.email, createdAt: now };
    await env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)')
      .bind(user.id, user.email, now, now).run();
  } else {
    await env.ACCOUNTS_DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
  }

  const sessionToken = generateToken();
  await env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)')
    .bind(await hashToken(sessionToken), user.id, now + SESSION_TTL_MS, now, now).run();
  return accountJson({ sessionToken, expiresAt: now + SESSION_TTL_MS, user });
}

export async function getAccount(request, env) {
  const user = await userForSession(request, env);
  return user ? accountJson({ user: { id: user.id, email: user.email, createdAt: user.createdAt } }) : accountJson({ error: 'Inte inloggad' }, 401);
}

export async function deleteSession(request, env) {
  const token = bearerToken(request);
  if (token) await env.ACCOUNTS_DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function getSnapshot(request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  const row = await env.ACCOUNTS_DB.prepare('SELECT version,payload,updated_at AS updatedAt FROM account_snapshots WHERE user_id = ?')
    .bind(user.id).first();
  return row ? accountJson({ version: row.version, updatedAt: row.updatedAt, data: JSON.parse(row.payload) })
    : accountJson({ version: 0, updatedAt: null, data: { courses: [], rounds: [], players: [], tours: [] } });
}

export async function putSnapshot(body, request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  if (!Number.isInteger(body?.baseVersion) || body.baseVersion < 0 || !validSnapshot(body.data)) {
    return accountJson({ error: 'Ogiltig synkdata' }, 400);
  }
  const payload = JSON.stringify(body.data);
  if (encoder.encode(payload).byteLength > MAX_SNAPSHOT_BYTES) return accountJson({ error: 'Synkdata är för stor' }, 413);
  const now = Date.now();
  const existing = await env.ACCOUNTS_DB.prepare('SELECT version FROM account_snapshots WHERE user_id = ?').bind(user.id).first();
  const currentVersion = existing?.version || 0;
  if (body.baseVersion !== currentVersion) return accountJson({ error: 'Synkkonflikt', currentVersion }, 409);
  const version = currentVersion + 1;
  await env.ACCOUNTS_DB.prepare(`
    INSERT INTO account_snapshots (user_id,version,payload,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at
  `).bind(user.id, version, payload, now).run();
  return accountJson({ version, updatedAt: now });
}
