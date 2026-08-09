import { bearerToken, generateToken, hashToken } from './auth.js';
import { GolfRoom, CreateRateLimiter } from './room.js';
import { Tour } from './tour.js';
import { PROTOCOL_VERSION, readJson, validateCreate } from './validation.js';
import { TOUR_SCHEMA_VERSION, validateTourCreate } from './tour-validation.js';
import { deletePushSubscription, getPushKey, getPushSettings, notifyUsers, savePushSubscription } from './push.js';
import { clientErrorPayload, reportOperationalError, structuredLog } from './observability.js';
import {
  accountIdentity, deleteAccount, deleteSession, exchangeMagicLink, exportAccount, forgetAccountTour, getAccount, getProfile,
  getCareerStats, getSnapshot, listAccountSessions, listAccountTours, listSecurityEvents, putProfile, putSnapshot, rememberAccountTour,
  requestMagicLink, revokeAccountSession, revokeOtherAccountSessions, userForSession,
} from './account.js';

export { GolfRoom, CreateRateLimiter, Tour };

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_ACCOUNT_SNAPSHOT_REQUEST_BYTES = 1_550_000;
const ALLOWED_ORIGINS = new Set([
  'https://hbrosenius.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);

function randomCode(length = 4) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => CODE_CHARS[byte % CODE_CHARS.length]).join('');
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Golf-Protocol',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function fromRoomResult(roomResult) {
  const { status, ...data } = roomResult;
  return json(data.room && Object.keys(data).length === 1 ? data.room : data, status);
}

function fromTourResult(tourResult) {
  const { status, ...data } = tourResult;
  return json(data.tour && Object.keys(data).length === 1 ? data.tour : data, status);
}

async function bodyOrResponse(request, maxBytes) {
  const parsed = await readJson(request, maxBytes);
  return parsed.error ? { response: json({ error: parsed.error }, parsed.status) } : { body: parsed.value };
}

function protocolHeaderValid(request) {
  return request.headers.get('X-Golf-Protocol') === String(PROTOCOL_VERSION);
}

async function createRoom(request, env) {
  const parsed = await bodyOrResponse(request);
  if (parsed.response) return parsed.response;
  const invalid = validateCreate(parsed.body);
  if (invalid) return json({ error: invalid }, invalid.startsWith('Unsupported') ? 426 : 400);
  if (parsed.body.tourRef) {
    const account = env.ACCOUNTS_DB ? await userForSession(request, env) : null;
    const access = await env.GOLF_TOURS.getByName(parsed.body.tourRef.code).access(bearerToken(request), account?.id);
    if (access.status !== 200) return json({ error: 'Not authorized for tour' }, 403);
  }

  const clientKey = request.headers.get('CF-Connecting-IP') || 'local';
  if (!await env.CREATE_LIMITER.getByName(clientKey).check()) return json({ error: 'Too many attempts' }, 429);

  const hostToken = generateToken();
  const seatToken = generateToken();
  const hostTokenHash = await hashToken(hostToken);
  const seatTokenHash = await hashToken(seatToken);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const created = await env.GOLF_ROOMS.getByName(code).create(parsed.body, hostTokenHash, seatTokenHash);
    if (created.status === 201) {
      return json({ code, room: created.room, hostToken, seatToken, protocolVersion: PROTOCOL_VERSION }, 201);
    }
  }
  return json({ error: 'Room unavailable' }, 503);
}

async function createTour(request, env) {
  const parsed = await bodyOrResponse(request);
  if (parsed.response) return parsed.response;
  const invalid = validateTourCreate(parsed.body);
  if (invalid) return json({ error: invalid }, invalid.startsWith('Unsupported') ? 426 : 400);
  const clientKey = `tour:${request.headers.get('CF-Connecting-IP') || 'local'}`;
  if (!await env.CREATE_LIMITER.getByName(clientKey).check()) return json({ error: 'Too many attempts' }, 429);

  const organizerToken = generateToken();
  const invitationToken = generateToken();
  const organizerTokenHash = await hashToken(organizerToken);
  const invitationTokenHash = await hashToken(invitationToken);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode(8);
    const created = await env.GOLF_TOURS.getByName(code).create({ ...parsed.body, code }, organizerTokenHash, invitationTokenHash);
    if (created.status === 201) {
      const account = env.ACCOUNTS_DB ? await userForSession(request, env) : null;
      if (account) {
        const identity = await accountIdentity(env, account.id);
        const bound = await env.GOLF_TOURS.getByName(code).bindOrganizerAccount(identity);
        if (bound.tour) created.tour = bound.tour;
        await rememberAccountTour(env, account.id, code, 'organizer');
      }
      return json({
        code, tour: created.tour, organizerToken, invitationToken,
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
      }, 201);
    }
  }
  return json({ error: 'Tour unavailable' }, 503);
}

async function route(request, env, ctx = null) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, protocolVersion: PROTOCOL_VERSION, service: 'golfcalc-sync', release: env.RELEASE_VERSION || null });
  }
  if (url.pathname === '/monitor/client-error' && request.method === 'POST') {
    const clientKey = `client-error:${request.headers.get('CF-Connecting-IP') || 'local'}`;
    if (!await env.CREATE_LIMITER.getByName(clientKey).check()) return new Response(null, { status: 204 });
    const parsed = await bodyOrResponse(request);
    if (parsed.response) return parsed.response;
    const payload = clientErrorPayload(parsed.body);
    if (payload) reportOperationalError(env, 'browser_error', { component: 'browser', ...payload }, ctx);
    return new Response(null, { status: 204 });
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'account') {
    if (parts.length === 2 && parts[1] === 'push-key' && request.method === 'GET') return getPushKey(env);
    if (!env.ACCOUNTS_DB) return json({ error: 'Accounts are not configured' }, 503);
    if (parts.length === 2 && parts[1] === 'login' && request.method === 'POST') {
      const parsed = await bodyOrResponse(request);
      return parsed.response || requestMagicLink(parsed.body, request, env);
    }
    if (parts.length === 2 && parts[1] === 'exchange' && request.method === 'POST') {
      const parsed = await bodyOrResponse(request);
      return parsed.response || exchangeMagicLink(parsed.body, env, ctx);
    }
    if (parts.length === 2 && parts[1] === 'session' && request.method === 'DELETE') return deleteSession(request, env);
    if (parts.length === 2 && parts[1] === 'me' && request.method === 'GET') return getAccount(request, env);
    if (parts.length === 2 && parts[1] === 'me' && request.method === 'DELETE') return deleteAccount(request, env);
    if (parts.length === 2 && parts[1] === 'export' && request.method === 'GET') return exportAccount(request, env);
    if (parts.length === 2 && parts[1] === 'profile' && request.method === 'GET') return getProfile(request, env);
    if (parts.length === 2 && parts[1] === 'profile' && request.method === 'PUT') {
      const parsed = await bodyOrResponse(request);
      return parsed.response || putProfile(parsed.body, request, env);
    }
    if (parts.length === 2 && parts[1] === 'tours' && request.method === 'GET') return listAccountTours(request, env);
    if (parts.length === 2 && parts[1] === 'sessions' && request.method === 'GET') return listAccountSessions(request, env);
    if (parts.length === 2 && parts[1] === 'sessions' && request.method === 'DELETE') return revokeOtherAccountSessions(request, env);
    if (parts.length === 3 && parts[1] === 'sessions' && request.method === 'DELETE') return revokeAccountSession(request, env, parts[2]);
    if (parts.length === 2 && parts[1] === 'security-events' && request.method === 'GET') return listSecurityEvents(request, env);
    if (parts.length === 2 && parts[1] === 'stats' && request.method === 'GET') return getCareerStats(request, env);
    if (parts.length === 2 && parts[1] === 'push' && request.method === 'GET') return getPushSettings(request, env);
    if (parts.length === 2 && parts[1] === 'push' && request.method === 'PUT') {
      const parsed = await bodyOrResponse(request);
      return parsed.response || savePushSubscription(parsed.body, request, env);
    }
    if (parts.length === 2 && parts[1] === 'push' && request.method === 'DELETE') return deletePushSubscription(request, env);
    if (parts.length === 2 && parts[1] === 'snapshot' && request.method === 'GET') return getSnapshot(request, env);
    if (parts.length === 2 && parts[1] === 'snapshot' && request.method === 'PUT') {
      const parsed = await bodyOrResponse(request, MAX_ACCOUNT_SNAPSHOT_REQUEST_BYTES);
      return parsed.response || putSnapshot(parsed.body, request, env);
    }
    return json({ error: 'Not found' }, 404);
  }
  if (parts[0] === 'tour') {
    if (parts.length === 1 && request.method === 'POST') return createTour(request, env);
    if (parts.length < 2 || !/^[A-HJ-KM-NP-Z2-9]{8}$/.test(parts[1].toUpperCase())) return json({ error: 'Tour not found' }, 404);
    const code = parts[1].toUpperCase();
    const tour = env.GOLF_TOURS.getByName(code);
    await tour.bindCode(code);
    if (parts.length === 3 && parts[2] === 'live' && request.method === 'GET') {
      const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(value => value.trim());
      const token = protocols[1] || '';
      const authenticated = token ? await userForSession(new Request(request.url, { headers: { Authorization: `Bearer ${token}` } }), env) : null;
      const headers = new Headers(request.headers);
      headers.delete('X-Account-User');
      if (authenticated) headers.set('X-Account-User', authenticated.id);
      return tour.fetch(new Request(request, { headers }));
    }
    if (parts.length === 2 && request.method === 'GET') return fromTourResult(await tour.getPublicState());
    if (!protocolHeaderValid(request)) return json({ error: 'Unsupported protocol version' }, 426);
    const token = bearerToken(request);
    const account = env.ACCOUNTS_DB ? await userForSession(request, env) : null;
    const accountUserId = account?.id;
    const identity = accountUserId ? await accountIdentity(env, accountUserId) : null;
    if (parts.length === 3 && parts[2] === 'access' && request.method === 'GET') return fromTourResult(await tour.access(token, accountUserId));
    if (parts.length === 3 && parts[2] === 'manage' && request.method === 'GET') return fromTourResult(await tour.manage(token, accountUserId));
    if (parts.length === 3 && parts[2] === 'activity' && request.method === 'GET') return fromTourResult(await tour.getActivity(token, accountUserId));
    const parsed = await bodyOrResponse(request);
    if (parsed.response) return parsed.response;
    if (parts.length === 3 && parts[2] === 'join' && request.method === 'POST') {
      const joined = await tour.join(parsed.body, identity);
      if (joined.status === 200 && accountUserId) await rememberAccountTour(env, accountUserId, code, 'contributor', joined.memberId);
      return fromTourResult(joined);
    }
    if (parts.length === 3 && parts[2] === 'membership' && request.method === 'PATCH') {
      const updated = await tour.updateMyMembership(parsed.body, accountUserId);
      if (updated.status === 200 && accountUserId) await rememberAccountTour(env, accountUserId, code, 'contributor', updated.memberId);
      return fromTourResult(updated);
    }
    if (parts.length === 3 && parts[2] === 'leave' && request.method === 'POST') {
      const left = await tour.leave(token, accountUserId, parsed.body);
      if (left.status === 200 && accountUserId) await forgetAccountTour(env, accountUserId, code);
      return fromTourResult(left);
    }
    if (parts.length === 5 && parts[2] === 'contributors' && parts[4] === 'membership' && request.method === 'PATCH') {
      const updated = await tour.updateContributor(parts[3], token, accountUserId, parsed.body);
      if (updated.status === 200 && updated.accountUserId) {
        await rememberAccountTour(env, updated.accountUserId, code, 'contributor', updated.memberId);
        delete updated.accountUserId;
      }
      return fromTourResult(updated);
    }
    if (parts.length === 5 && parts[2] === 'contributors' && parts[4] === 'restore' && request.method === 'POST') {
      const restored = await tour.restoreContributor(parts[3], token, accountUserId, parsed.body);
      if (restored.status === 200 && restored.accountUserId) {
        await rememberAccountTour(env, restored.accountUserId, code, 'contributor', restored.memberId);
        delete restored.accountUserId;
      }
      return fromTourResult(restored);
    }
    if (parts.length === 3 && parts[2] === 'transfer-ownership' && request.method === 'POST') {
      const transferred = await tour.transferOwnership(token, accountUserId, parsed.body);
      if (transferred.status === 200 && transferred.newOrganizerAccountUserId) {
        await rememberAccountTour(env, transferred.newOrganizerAccountUserId, code, 'organizer', transferred.memberId);
        if (accountUserId) await rememberAccountTour(env, accountUserId, code, 'contributor');
        delete transferred.newOrganizerAccountUserId;
      }
      return fromTourResult(transferred);
    }
    if (parts.length === 3 && parts[2] === 'rounds' && request.method === 'POST') return fromTourResult(await tour.submitRound(parsed.body, token, accountUserId));
    if (parts.length === 3 && parts[2] === 'round-starts' && request.method === 'POST') return fromTourResult(await tour.startRound(token, accountUserId, parsed.body));
    if (parts.length === 4 && parts[2] === 'rounds' && request.method === 'PATCH') return fromTourResult(await tour.editRound(parts[3], token, accountUserId, parsed.body));
    if (parts.length === 3 && parts[2] === 'announcements' && request.method === 'POST') return fromTourResult(await tour.announce(token, accountUserId, parsed.body));
    if (parts.length === 5 && parts[2] === 'contributors' && parts[4] === 'administrator' && request.method === 'PATCH') return fromTourResult(await tour.setAdministrator(parts[3], token, accountUserId, parsed.body));
    if (parts.length === 3 && parts[2] === 'conditions' && request.method === 'PATCH') return fromTourResult(await tour.update(token, parsed.body, accountUserId));
    if (parts.length === 3 && parts[2] === 'rotate-invitation' && request.method === 'POST') return fromTourResult(await tour.rotateInvitation(token, parsed.body, accountUserId));
    if (parts.length === 3 && parts[2] === 'complete' && request.method === 'POST') return fromTourResult(await tour.complete(token, parsed.body, accountUserId));
    if (parts.length === 3 && parts[2] === 'cancel' && request.method === 'POST') return fromTourResult(await tour.cancel(token, parsed.body, accountUserId));
    if (parts.length === 2 && request.method === 'DELETE') {
      const deleted = await tour.delete(token, parsed.body, accountUserId);
      if (deleted.status === 200) await env.ACCOUNTS_DB.prepare('DELETE FROM account_tours WHERE tour_code = ?').bind(code).run();
      return fromTourResult(deleted);
    }
    if (parts.length === 5 && parts[2] === 'contributors' && parts[4] === 'revoke' && request.method === 'POST') {
      const revoked = await tour.revokeContributor(parts[3], token, parsed.body, accountUserId);
      if (revoked.status === 200 && revoked.accountUserId) {
        await forgetAccountTour(env, revoked.accountUserId, code);
        delete revoked.accountUserId;
      }
      return fromTourResult(revoked);
    }
    return json({ error: 'Not found' }, 404);
  }
  if (parts[0] !== 'room') return json({ error: 'Not found' }, 404);

  if (parts.length === 1 && request.method === 'POST') return createRoom(request, env);
  if (parts.length < 2 || !/^[A-HJ-KM-NP-Z2-9]{4}$/.test(parts[1].toUpperCase())) return json({ error: 'Room not found' }, 404);

  const code = parts[1].toUpperCase();
  const room = env.GOLF_ROOMS.getByName(code);
  if (parts.length === 2 && request.method === 'GET') return fromRoomResult(await room.getPublicState());
  if (!protocolHeaderValid(request)) return json({ error: 'Unsupported protocol version' }, 426);

  const parsed = await bodyOrResponse(request);
  if (parsed.response) return parsed.response;
  const token = bearerToken(request);

  if (parts.length === 2 && request.method === 'PATCH') return fromRoomResult(await room.patch(parsed.body, token));
  if (parts.length === 3 && parts[2] === 'claim' && request.method === 'POST') return fromRoomResult(await room.claimSeat(parsed.body));
  if (parts.length === 3 && parts[2] === 'bets' && request.method === 'POST') return fromRoomResult(await room.proposeBet(parsed.body, token));
  if (parts.length === 5 && parts[2] === 'bets' && request.method === 'POST') {
    if (parts[4] === 'respond') return fromRoomResult(await room.respondBet(parts[3], parsed.body, token));
    if (parts[4] === 'cancel') return fromRoomResult(await room.cancelBet(parts[3], parsed.body, token));
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    let response;
    try { response = await route(request, env, ctx); }
    catch (error) {
      reportOperationalError(env, 'request_failed', {
        method: request.method, path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }, ctx, { alert: true });
      response = json({ error: 'Service unavailable' }, 503);
    }
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const startedAt = Date.now();
      try {
        const databaseCheck = await env.ACCOUNTS_DB.prepare('SELECT 1 AS ok').first();
        if (databaseCheck?.ok !== 1) throw new Error('D1 health check failed');
        const rows = await env.ACCOUNTS_DB.prepare('SELECT DISTINCT tour_code AS code FROM account_tours').all();
        for (const row of rows.results || []) {
          const tour = env.GOLF_TOURS.getByName(row.code);
          await tour.bindCode(row.code);
          const due = await tour.endReminderDue(Date.now());
          if (due?.userIds?.length) await notifyUsers(env, due.userIds, 'reminders', due.payload);
        }
        structuredLog('info', 'scheduled_health_check_ok', { component: 'cron', toursChecked: rows.results?.length || 0, durationMs: Date.now() - startedAt });
      } catch (error) {
        await reportOperationalError(env, 'scheduled_health_check_failed', { component: 'cron', error: error?.message || String(error) }, null, { alert: true });
        throw error;
      }
    })());
  },
};
