// GolfCalculator live-sync relay
// Minimal Cloudflare Worker + KV backend for live multi-device scoring.
// No framework or dependencies — plain Request/Response handling only,
// matching the no-build-step philosophy of the app itself.
//
// Endpoints:
//   POST   /room             create a room, returns { code, room }
//   GET    /room/:code       fetch current room state
//   PATCH  /room/:code       merge a seat's scores and/or shared fields
//   POST   /room/:code/claim claim a seat for a device (best-effort lock)

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L — avoids ambiguity when read aloud
const ROOM_TTL_SECONDS = 24 * 60 * 60; // rooms auto-expire; no cleanup job needed

function randomCode(len = 4) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function badRequest(msg) { return jsonResponse({ error: msg }, 400); }
function notFound() { return jsonResponse({ error: 'Room not found' }, 404); }

async function readJson(request) {
  try { return await request.json(); }
  catch (e) { return null; }
}

async function createRoom(request, env) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body');

  const { courseName, teeColor, holes, slope, cr, par, hpar, si,
          gameMode, teams, players, seatCount, markers } = body;

  if (!courseName || !teeColor || !holes || !Array.isArray(players) || !seatCount) {
    return badRequest('Missing required round fields (courseName, teeColor, holes, players, seatCount)');
  }

  const seats = {};
  for (let i = 0; i < seatCount; i++) {
    seats[i] = { scores: new Array(holes).fill(''), claimedBy: null };
  }

  const room = {
    createdAt: Date.now(),
    courseName, teeColor, holes, slope, cr, par,
    hpar: hpar || [], si: si || [],
    gameMode: gameMode || 'individual',
    teams: teams || null,
    // Photos are never sent — each device resolves avatars from its own local player register.
    players: players.map(p => ({ name: p.name, hi: p.hi, ph: p.ph, tee: p.tee || null })),
    seats,
    // Host assigns which holes are CTP/longest-drive at creation time; only the
    // host can ever change the winner (enforced client-side, this is a relay).
    markers: markers || { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } },
    note: '',
    weather: null,
  };

  // 32^4 ≈ 1M possible codes — a handful of retries is plenty to dodge a collision.
  let code = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = randomCode();
    const existing = await env.GOLF_ROOMS.get(`room:${candidate}`);
    if (!existing) { code = candidate; break; }
  }
  if (!code) return jsonResponse({ error: 'Could not allocate a room code, try again' }, 500);

  await env.GOLF_ROOMS.put(`room:${code}`, JSON.stringify(room), { expirationTtl: ROOM_TTL_SECONDS });
  return jsonResponse({ code, room });
}

async function getRoom(code, env) {
  const raw = await env.GOLF_ROOMS.get(`room:${code}`);
  if (!raw) return notFound();
  return jsonResponse(JSON.parse(raw));
}

async function patchRoom(code, request, env) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body');

  const raw = await env.GOLF_ROOMS.get(`room:${code}`);
  if (!raw) return notFound();
  const room = JSON.parse(raw);

  const { seat, scores, markers, note, weather } = body;

  // Per-seat write: caller always sends its full local scores array (idempotent,
  // no partial-hole diffing needed — each seat is only ever written by one device).
  if (seat != null) {
    if (!room.seats[seat]) return badRequest(`Unknown seat ${seat}`);
    if (Array.isArray(scores)) room.seats[seat].scores = scores;
  }

  // Shared, low-frequency fields — last write wins, no seat ownership needed.
  if (markers && typeof markers === 'object') {
    room.markers = {
      ctp: { ...room.markers.ctp, ...(markers.ctp || {}) },
      ld:  { ...room.markers.ld,  ...(markers.ld  || {}) },
    };
  }
  if (typeof note === 'string') room.note = note;
  if (weather !== undefined) room.weather = weather;

  await env.GOLF_ROOMS.put(`room:${code}`, JSON.stringify(room), { expirationTtl: ROOM_TTL_SECONDS });
  return jsonResponse(room);
}

async function claimSeat(code, request, env) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body');
  const { seat, deviceId } = body;
  if (seat == null || !deviceId) return badRequest('seat and deviceId are required');

  const raw = await env.GOLF_ROOMS.get(`room:${code}`);
  if (!raw) return notFound();
  const room = JSON.parse(raw);
  if (!room.seats[seat]) return badRequest(`Unknown seat ${seat}`);

  if (room.seats[seat].claimedBy && room.seats[seat].claimedBy !== deviceId) {
    return jsonResponse({ error: 'Seat already claimed', room }, 409);
  }

  room.seats[seat].claimedBy = deviceId;
  await env.GOLF_ROOMS.put(`room:${code}`, JSON.stringify(room), { expirationTtl: ROOM_TTL_SECONDS });
  return jsonResponse(room);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // e.g. ['room', 'GK4X', 'claim']

    if (parts[0] !== 'room') return notFound();

    if (parts.length === 1 && request.method === 'POST') {
      return createRoom(request, env);
    }

    if (parts.length === 2) {
      const code = parts[1].toUpperCase();
      if (request.method === 'GET')   return getRoom(code, env);
      if (request.method === 'PATCH') return patchRoom(code, request, env);
    }

    if (parts.length === 3 && parts[2] === 'claim' && request.method === 'POST') {
      const code = parts[1].toUpperCase();
      return claimSeat(code, request, env);
    }

    return notFound();
  },
};
