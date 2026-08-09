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
  if (!env.RESEND_API_KEY || !env.ACCOUNT_FROM_EMAIL || !env.APP_BASE_URL || !env.ACCOUNT_API_BASE) throw new Error('Account email is not configured');
  const base = String(env.APP_BASE_URL).replace(/#.*$/, '');
  const link = `${base}#account_token=${encodeURIComponent(token)}&account_api=${encodeURIComponent(env.ACCOUNT_API_BASE)}`;
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

export async function userForSession(request, env) {
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

async function sendNewDeviceAlert(env, email, deviceName, occurredAt) {
  if (!env.RESEND_API_KEY || !env.ACCOUNT_FROM_EMAIL) return;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.ACCOUNT_FROM_EMAIL, to: [email], subject: 'Ny inloggning i Poängbogey',
      text: `En ny enhet loggade in på ditt Poängbogey-konto.\n\nEnhet: ${deviceName}\nTid: ${new Date(occurredAt).toISOString()}\n\nOm det inte var du, öppna Konto i appen och logga ut enheten.`,
      html: `<p>En ny enhet loggade in på ditt Poängbogey-konto.</p><p><strong>Enhet:</strong> ${escapeEmailHtml(deviceName)}<br><strong>Tid:</strong> ${new Date(occurredAt).toISOString()}</p><p>Om det inte var du, öppna <strong>Konto</strong> i appen och logga ut enheten.</p>`,
    }),
  });
  if (!response.ok) throw new Error('New-device email failed');
}

function escapeEmailHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function deviceMetadata(body) {
  const name = typeof body?.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : '';
  const type = typeof body?.deviceType === 'string' && ['mobile', 'tablet', 'desktop', 'unknown'].includes(body.deviceType)
    ? body.deviceType : 'unknown';
  return { deviceName: name || 'Okänd enhet', deviceType: type };
}

async function addSecurityEvent(env, userId, eventType, deviceName = null, details = null) {
  await env.ACCOUNTS_DB.batch([
    env.ACCOUNTS_DB.prepare('INSERT INTO account_security_events (id,user_id,event_type,created_at,device_name,details) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), userId, eventType, Date.now(), deviceName, details ? JSON.stringify(details) : null),
    env.ACCOUNTS_DB.prepare(`DELETE FROM account_security_events WHERE user_id = ? AND id NOT IN (
      SELECT id FROM account_security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
    )`).bind(userId, userId),
  ]);
}

export async function getProfile(request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  const profile = await env.ACCOUNTS_DB.prepare(
    'SELECT display_name AS displayName,handicap,updated_at AS updatedAt FROM account_profiles WHERE user_id = ?'
  ).bind(user.id).first();
  return accountJson({ profile: profile || null });
}

export async function putProfile(body, request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName || displayName.length > 50 || typeof body?.handicap !== 'number' ||
    !Number.isFinite(body.handicap) || body.handicap < 0 || body.handicap > 54 ||
    Object.keys(body || {}).some(key => !['displayName', 'handicap'].includes(key))) {
    return accountJson({ error: 'Ogiltig spelarprofil' }, 400);
  }
  const updatedAt = Date.now();
  await env.ACCOUNTS_DB.prepare(`
    INSERT INTO account_profiles (user_id,display_name,handicap,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,handicap=excluded.handicap,updated_at=excluded.updated_at
  `).bind(user.id, displayName, body.handicap, updatedAt).run();
  return accountJson({ profile: { displayName, handicap: body.handicap, updatedAt } });
}

export async function listAccountTours(request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  const rows = await env.ACCOUNTS_DB.prepare(
    'SELECT tour_code AS code,role,member_id AS memberId,joined_at AS joinedAt FROM account_tours WHERE user_id = ? ORDER BY joined_at DESC'
  ).bind(user.id).all();
  return accountJson({ tours: rows.results || [] });
}

export async function listAccountSessions(request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  const currentHash = await hashToken(bearerToken(request) || '');
  const rows = await env.ACCOUNTS_DB.prepare(
    'SELECT token_hash AS tokenHash,session_id AS sessionId,device_name AS deviceName,device_type AS deviceType,created_at AS createdAt,last_seen_at AS lastSeenAt,expires_at AS expiresAt FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 20'
  ).bind(user.id, Date.now()).all();
  const values = rows.results || [];
  const missing = values.filter(row => !row.sessionId).map(row => {
    row.sessionId = crypto.randomUUID();
    return env.ACCOUNTS_DB.prepare('UPDATE sessions SET session_id = ?,device_name = COALESCE(device_name,?),device_type = COALESCE(device_type,?) WHERE token_hash = ?')
      .bind(row.sessionId, 'Äldre session', 'unknown', row.tokenHash);
  });
  if (missing.length) await env.ACCOUNTS_DB.batch(missing);
  return accountJson({ sessions: values.map(row => ({
    id: row.sessionId, current: row.tokenHash === currentHash, deviceName: row.deviceName || 'Äldre session',
    deviceType: row.deviceType || 'unknown', createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt,
  })) });
}

export async function revokeAccountSession(request, env, sessionId) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId || '')) return accountJson({ error: 'Ogiltig session' }, 400);
  const currentHash = await hashToken(bearerToken(request) || '');
  const target = await env.ACCOUNTS_DB.prepare('SELECT token_hash AS tokenHash,device_name AS deviceName FROM sessions WHERE user_id = ? AND session_id = ?')
    .bind(user.id, sessionId).first();
  if (!target) return accountJson({ error: 'Sessionen finns inte' }, 404);
  if (target.tokenHash === currentHash) return accountJson({ error: 'Använd Logga ut för den här sessionen' }, 409);
  await env.ACCOUNTS_DB.batch([
    env.ACCOUNTS_DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND session_id = ?').bind(user.id, sessionId),
    env.ACCOUNTS_DB.prepare('DELETE FROM sessions WHERE user_id = ? AND session_id = ?').bind(user.id, sessionId),
  ]);
  await addSecurityEvent(env, user.id, 'session_revoked', target.deviceName || 'Äldre session');
  return accountJson({ revoked: true });
}

export async function revokeOtherAccountSessions(request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  const currentHash = await hashToken(bearerToken(request) || '');
  const current = await env.ACCOUNTS_DB.prepare('SELECT session_id AS sessionId FROM sessions WHERE user_id = ? AND token_hash = ?').bind(user.id, currentHash).first();
  await env.ACCOUNTS_DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND (session_id IS NULL OR session_id <> ?)').bind(user.id, current?.sessionId || '').run();
  const result = await env.ACCOUNTS_DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(user.id, currentHash).run();
  await addSecurityEvent(env, user.id, 'other_sessions_revoked', null, { count: result.meta?.changes || 0 });
  return accountJson({ revoked: result.meta?.changes || 0 });
}

export async function listSecurityEvents(request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  const rows = await env.ACCOUNTS_DB.prepare(
    'SELECT id,event_type AS type,created_at AS at,device_name AS deviceName,details FROM account_security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(user.id).all();
  return accountJson({ events: (rows.results || []).map(row => ({
    ...row, details: row.details ? JSON.parse(row.details) : null,
  })) });
}

export async function rememberAccountTour(env, userId, code, role, memberId = null) {
  await env.ACCOUNTS_DB.prepare(`
    INSERT INTO account_tours (user_id,tour_code,role,member_id,joined_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id,tour_code) DO UPDATE SET role=excluded.role,member_id=excluded.member_id
  `).bind(userId, code, role, memberId, Date.now()).run();
}

export async function accountIdentity(env, userId) {
  if (!userId) return null;
  const profile = await env.ACCOUNTS_DB.prepare(
    'SELECT display_name AS displayName FROM account_profiles WHERE user_id = ?'
  ).bind(userId).first();
  return { userId, displayName: profile?.displayName || null };
}

export async function forgetAccountTour(env, userId, code) {
  if (!userId) return;
  await env.ACCOUNTS_DB.prepare('DELETE FROM account_tours WHERE user_id = ? AND tour_code = ?').bind(userId, code).run();
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

export async function exchangeMagicLink(body, env, ctx = null) {
  const rawToken = typeof body?.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) return accountJson({ error: 'Ogiltig eller utgången länk' }, 400);
  const tokenHash = await hashToken(rawToken);
  const now = Date.now();
  const login = await env.ACCOUNTS_DB.prepare(
    'DELETE FROM login_tokens WHERE token_hash = ? AND expires_at > ? RETURNING email'
  ).bind(tokenHash, now).first();
  if (!login) return accountJson({ error: 'Ogiltig eller utgången länk' }, 400);

  let user = await env.ACCOUNTS_DB.prepare('SELECT id,email,created_at AS createdAt FROM users WHERE email = ?').bind(login.email).first();
  const existingUser = !!user;
  if (!user) {
    user = { id: crypto.randomUUID(), email: login.email, createdAt: now };
    await env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)')
      .bind(user.id, user.email, now, now).run();
  } else {
    await env.ACCOUNTS_DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
  }

  const sessionToken = generateToken();
  const sessionId = crypto.randomUUID();
  const device = deviceMetadata(body);
  await env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at,session_id,device_name,device_type) VALUES (?,?,?,?,?,?,?,?)')
    .bind(await hashToken(sessionToken), user.id, now + SESSION_TTL_MS, now, now, sessionId, device.deviceName, device.deviceType).run();
  await addSecurityEvent(env, user.id, 'session_created', device.deviceName, { deviceType: device.deviceType });
  if (existingUser) {
    const alert = sendNewDeviceAlert(env, user.email, device.deviceName, now)
      .catch(() => console.error(JSON.stringify({ level: 'error', message: 'new_device_alert_failed' })));
    if (ctx) ctx.waitUntil(alert); else await alert;
  }
  return accountJson({ sessionToken, sessionId, expiresAt: now + SESSION_TTL_MS, user });
}

export async function getAccount(request, env) {
  const user = await userForSession(request, env);
  return user ? accountJson({ user: { id: user.id, email: user.email, createdAt: user.createdAt } }) : accountJson({ error: 'Inte inloggad' }, 401);
}

export async function deleteSession(request, env) {
  const token = bearerToken(request);
  if (token) {
    const tokenHash = await hashToken(token);
    const session = await env.ACCOUNTS_DB.prepare('SELECT session_id AS sessionId FROM sessions WHERE token_hash = ?').bind(tokenHash).first();
    if (session?.sessionId) await env.ACCOUNTS_DB.prepare('DELETE FROM push_subscriptions WHERE session_id = ?').bind(session.sessionId).run();
    await env.ACCOUNTS_DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function deleteAccount(request, env) {
  const user = await userForSession(request, env);
  if (!user) return accountJson({ error: 'Inte inloggad' }, 401);
  await env.ACCOUNTS_DB.batch([
    env.ACCOUNTS_DB.prepare('DELETE FROM login_tokens WHERE email = ?').bind(user.email),
    env.ACCOUNTS_DB.prepare('DELETE FROM account_tours WHERE user_id = ?').bind(user.id),
    env.ACCOUNTS_DB.prepare('DELETE FROM account_profiles WHERE user_id = ?').bind(user.id),
    env.ACCOUNTS_DB.prepare('DELETE FROM account_snapshots WHERE user_id = ?').bind(user.id),
    env.ACCOUNTS_DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.ACCOUNTS_DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
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
