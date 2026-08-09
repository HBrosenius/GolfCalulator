import { bearerToken, generateToken, hashToken } from './auth.js';
import { GolfRoom, CreateRateLimiter } from './room.js';
import { Tour } from './tour.js';
import { PROTOCOL_VERSION, readJson, validateCreate } from './validation.js';
import { TOUR_SCHEMA_VERSION, validateTourCreate } from './tour-validation.js';
import {
  deleteSession, exchangeMagicLink, getAccount, getSnapshot, putSnapshot, requestMagicLink,
} from './account.js';

export { GolfRoom, CreateRateLimiter, Tour };

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
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

async function bodyOrResponse(request) {
  const parsed = await readJson(request);
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
    const access = await env.GOLF_TOURS.getByName(parsed.body.tourRef.code).access(bearerToken(request));
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
    const created = await env.GOLF_TOURS.getByName(code).create(parsed.body, organizerTokenHash, invitationTokenHash);
    if (created.status === 201) {
      return json({
        code, tour: created.tour, organizerToken, invitationToken,
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
      }, 201);
    }
  }
  return json({ error: 'Tour unavailable' }, 503);
}

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, protocolVersion: PROTOCOL_VERSION });
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'account') {
    if (!env.ACCOUNTS_DB) return json({ error: 'Accounts are not configured' }, 503);
    if (parts.length === 2 && parts[1] === 'login' && request.method === 'POST') {
      const parsed = await bodyOrResponse(request);
      return parsed.response || requestMagicLink(parsed.body, request, env);
    }
    if (parts.length === 2 && parts[1] === 'exchange' && request.method === 'POST') {
      const parsed = await bodyOrResponse(request);
      return parsed.response || exchangeMagicLink(parsed.body, env);
    }
    if (parts.length === 2 && parts[1] === 'session' && request.method === 'DELETE') return deleteSession(request, env);
    if (parts.length === 2 && parts[1] === 'me' && request.method === 'GET') return getAccount(request, env);
    if (parts.length === 2 && parts[1] === 'snapshot' && request.method === 'GET') return getSnapshot(request, env);
    if (parts.length === 2 && parts[1] === 'snapshot' && request.method === 'PUT') {
      const parsed = await bodyOrResponse(request);
      return parsed.response || putSnapshot(parsed.body, request, env);
    }
    return json({ error: 'Not found' }, 404);
  }
  if (parts[0] === 'tour') {
    if (parts.length === 1 && request.method === 'POST') return createTour(request, env);
    if (parts.length < 2 || !/^[A-HJ-KM-NP-Z2-9]{8}$/.test(parts[1].toUpperCase())) return json({ error: 'Tour not found' }, 404);
    const code = parts[1].toUpperCase();
    const tour = env.GOLF_TOURS.getByName(code);
    if (parts.length === 2 && request.method === 'GET') return fromTourResult(await tour.getPublicState());
    if (!protocolHeaderValid(request)) return json({ error: 'Unsupported protocol version' }, 426);
    const token = bearerToken(request);
    if (parts.length === 3 && parts[2] === 'access' && request.method === 'GET') return fromTourResult(await tour.access(token));
    if (parts.length === 3 && parts[2] === 'manage' && request.method === 'GET') return fromTourResult(await tour.manage(token));
    const parsed = await bodyOrResponse(request);
    if (parsed.response) return parsed.response;
    if (parts.length === 3 && parts[2] === 'join' && request.method === 'POST') return fromTourResult(await tour.join(parsed.body));
    if (parts.length === 3 && parts[2] === 'rounds' && request.method === 'POST') return fromTourResult(await tour.submitRound(parsed.body, token));
    if (parts.length === 3 && parts[2] === 'conditions' && request.method === 'PATCH') return fromTourResult(await tour.update(token, parsed.body));
    if (parts.length === 3 && parts[2] === 'rotate-invitation' && request.method === 'POST') return fromTourResult(await tour.rotateInvitation(token, parsed.body));
    if (parts.length === 3 && parts[2] === 'complete' && request.method === 'POST') return fromTourResult(await tour.complete(token, parsed.body));
    if (parts.length === 3 && parts[2] === 'cancel' && request.method === 'POST') return fromTourResult(await tour.cancel(token, parsed.body));
    if (parts.length === 2 && request.method === 'DELETE') return fromTourResult(await tour.delete(token, parsed.body));
    if (parts.length === 5 && parts[2] === 'contributors' && parts[4] === 'revoke' && request.method === 'POST') {
      return fromTourResult(await tour.revokeContributor(parts[3], token, parsed.body));
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

function logError(request, error) {
  console.error(JSON.stringify({
    level: 'error', message: 'request_failed', method: request.method,
    path: new URL(request.url).pathname, error: error instanceof Error ? error.message : String(error),
  }));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    let response;
    try { response = await route(request, env); }
    catch (error) { logError(request, error); response = json({ error: 'Service unavailable' }, 503); }
    const headers = new Headers(response.headers);
    Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  },
};
