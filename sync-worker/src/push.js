import webpush from 'web-push';
import { bearerToken, hashToken } from './auth.js';
import { userForSession } from './account.js';

const CATEGORIES = ['rounds', 'membership', 'ownership', 'reminders', 'announcements'];
const defaults = () => ({ rounds: true, membership: true, ownership: true, reminders: true, announcements: true });
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function preferences(value) {
  const result = defaults();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of CATEGORIES) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}

function validSubscription(value) {
  let endpoint;
  try { endpoint = new URL(value?.endpoint); } catch (_) { return false; }
  const allowedHost = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com']
    .some(host => endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`)) || endpoint.hostname.endsWith('.notify.windows.com');
  return allowedHost && value.endpoint.length <= 2048 && endpoint.protocol === 'https:' &&
    typeof value.keys?.p256dh === 'string' && /^[A-Za-z0-9_-]{40,200}$/.test(value.keys.p256dh) &&
    typeof value.keys?.auth === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(value.keys.auth);
}

export function getPushKey(env) {
  return env.VAPID_PUBLIC_KEY ? json({ publicKey: env.VAPID_PUBLIC_KEY }) : json({ error: 'Push notifications are not configured' }, 503);
}

export async function getPushSettings(request, env) {
  const user = await userForSession(request, env);
  if (!user) return json({ error: 'Inte inloggad' }, 401);
  const tokenHash = await hashToken(bearerToken(request) || '');
  const session = await env.ACCOUNTS_DB.prepare('SELECT session_id AS sessionId FROM sessions WHERE token_hash = ? AND user_id = ?').bind(tokenHash, user.id).first();
  const row = session?.sessionId ? await env.ACCOUNTS_DB.prepare(
    'SELECT preferences FROM push_subscriptions WHERE user_id = ? AND session_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(user.id, session.sessionId).first() : null;
  return json({ enabled: !!row, preferences: row ? preferences(JSON.parse(row.preferences)) : defaults() });
}

export async function savePushSubscription(body, request, env) {
  const user = await userForSession(request, env);
  if (!user) return json({ error: 'Inte inloggad' }, 401);
  if (!validSubscription(body?.subscription)) return json({ error: 'Ogiltig push-prenumeration' }, 400);
  const tokenHash = await hashToken(bearerToken(request) || '');
  const session = await env.ACCOUNTS_DB.prepare('SELECT session_id AS sessionId FROM sessions WHERE token_hash = ? AND user_id = ?').bind(tokenHash, user.id).first();
  if (!session?.sessionId) return json({ error: 'Sessionen behöver förnyas' }, 409);
  const pref = preferences(body.preferences);
  const now = Date.now();
  await env.ACCOUNTS_DB.prepare(`
    INSERT INTO push_subscriptions (id,user_id,session_id,endpoint,p256dh,auth,preferences,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,session_id=excluded.session_id,p256dh=excluded.p256dh,auth=excluded.auth,preferences=excluded.preferences,updated_at=excluded.updated_at
  `).bind(crypto.randomUUID(), user.id, session.sessionId, body.subscription.endpoint, body.subscription.keys.p256dh,
    body.subscription.keys.auth, JSON.stringify(pref), now, now).run();
  return json({ enabled: true, preferences: pref });
}

export async function deletePushSubscription(request, env) {
  const user = await userForSession(request, env);
  if (!user) return json({ error: 'Inte inloggad' }, 401);
  const tokenHash = await hashToken(bearerToken(request) || '');
  const session = await env.ACCOUNTS_DB.prepare('SELECT session_id AS sessionId FROM sessions WHERE token_hash = ? AND user_id = ?').bind(tokenHash, user.id).first();
  if (session?.sessionId) await env.ACCOUNTS_DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND session_id = ?').bind(user.id, session.sessionId).run();
  return json({ enabled: false });
}

export async function notifyUsers(env, userIds, category, payload) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length || !CATEGORIES.includes(category) || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.ACCOUNTS_DB.prepare(`SELECT id,endpoint,p256dh,auth,preferences FROM push_subscriptions WHERE user_id IN (${placeholders})`).bind(...ids).all();
  await Promise.all((rows.results || []).map(async row => {
    if (!preferences(JSON.parse(row.preferences))[category]) return;
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
        TTL: category === 'reminders' ? 86400 : 3600,
      });
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) await env.ACCOUNTS_DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
      else console.error(JSON.stringify({ level: 'error', message: 'push_delivery_failed', status: error?.statusCode || 0 }));
    }
  }));
}
