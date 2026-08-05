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
//   POST   /room/:code/bets              propose a hole bet
//   POST   /room/:code/bets/:id/respond  accept or decline a pending bet
//   POST   /room/:code/bets/:id/cancel   withdraw a still-pending bet

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L — avoids ambiguity when read aloud
const ROOM_TTL_SECONDS = 24 * 60 * 60; // rooms auto-expire; no cleanup job needed

function randomCode(len = 4) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

// Only the app's real deployed origin (plus localhost for local dev) may call this
// worker cross-origin — anything else gets no Access-Control-Allow-Origin, so
// browsers block the response from reaching the calling page's script. Applied
// once at the end of fetch(), regardless of which handler produced the response.
const ALLOWED_ORIGINS = new Set([
  'https://hbrosenius.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
  if (!(holes === 9 || holes === 18)) return badRequest('holes must be 9 or 18');
  if (!(Number.isInteger(seatCount) && seatCount >= 1 && seatCount <= 12)) {
    return badRequest('seatCount must be an integer between 1 and 12');
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
    bets: [],
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

  const { seat, scores, markers, note, weather, deviceId } = body;

  // Per-seat write: caller always sends its full local scores array (idempotent,
  // no partial-hole diffing needed — each seat is only ever written by one device).
  // A seat can only be written by the device that claimed it, or — while the seat
  // is still unclaimed — by the host (seat 0), so the host-fills-unclaimed-seats
  // feature keeps working without letting anyone overwrite an already-claimed seat.
  if (seat != null) {
    if (!room.seats[seat]) return badRequest(`Unknown seat ${seat}`);
    const claimedBy = room.seats[seat].claimedBy;
    const isOwner = claimedBy && claimedBy === deviceId;
    const isHostFillingUnclaimed = !claimedBy && deviceId && room.seats[0] && room.seats[0].claimedBy === deviceId;
    if (!isOwner && !isHostFillingUnclaimed) {
      return jsonResponse({ error: 'Not authorized to write this seat' }, 403);
    }
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

// Hole bets: any seat can propose winning a specific hole for an SEK amount;
// every other seat must accept before it locks in, any decline kills it.
// Same read-modify-write-on-KV pattern as claimSeat — no CAS, so mutations are
// kept idempotent (re-applying a response/cancel to an already-resolved bet is a no-op).

async function proposeBet(code, request, env) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body');
  const { proposerSeat, hole, amount, deviceId } = body;

  if (proposerSeat == null || hole == null || !(amount > 0)) {
    return badRequest('proposerSeat, hole and a positive amount are required');
  }

  const raw = await env.GOLF_ROOMS.get(`room:${code}`);
  if (!raw) return notFound();
  const room = JSON.parse(raw);
  if (!room.seats[proposerSeat]) return badRequest(`Unknown seat ${proposerSeat}`);
  if (!deviceId || room.seats[proposerSeat].claimedBy !== deviceId) {
    return jsonResponse({ error: 'Not authorized to propose a bet for this seat' }, 403);
  }
  if (!(hole >= 0 && hole < room.holes)) return badRequest(`Unknown hole ${hole}`);
  if (!Array.isArray(room.bets)) room.bets = [];

  const clash = room.bets.some(b => b.hole === hole && (b.status === 'pending' || b.status === 'locked'));
  if (clash) return jsonResponse({ error: 'A bet is already active on this hole', room }, 409);

  const responses = {};
  Object.keys(room.seats).forEach(seatKey => {
    const seat = Number(seatKey);
    if (seat !== proposerSeat) responses[seat] = 'pending';
  });

  const bet = {
    id: `${Date.now()}_${randomCode(4)}`,
    hole, amount, proposerSeat,
    createdAt: Date.now(), resolvedAt: null,
    status: 'pending', cancelReason: null,
    responses,
  };
  room.bets.push(bet);

  await env.GOLF_ROOMS.put(`room:${code}`, JSON.stringify(room), { expirationTtl: ROOM_TTL_SECONDS });
  return jsonResponse(room);
}

async function respondBet(code, betId, request, env) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body');
  const { seat, response, deviceId } = body;
  if (seat == null || (response !== 'accept' && response !== 'decline')) {
    return badRequest('seat and response ("accept"|"decline") are required');
  }

  const raw = await env.GOLF_ROOMS.get(`room:${code}`);
  if (!raw) return notFound();
  const room = JSON.parse(raw);
  if (!room.seats[seat] || !deviceId || room.seats[seat].claimedBy !== deviceId) {
    return jsonResponse({ error: 'Not authorized to respond for this seat' }, 403);
  }
  const bet = (room.bets || []).find(b => b.id === betId);
  if (!bet) return badRequest('Unknown bet');

  // Already resolved — no-op, just return the current room (idempotent).
  if (bet.status === 'pending') {
    if (response === 'decline') {
      bet.status = 'cancelled';
      bet.cancelReason = 'declined';
      bet.resolvedAt = Date.now();
    } else {
      bet.responses[seat] = 'accepted';
      const allAccepted = Object.values(bet.responses).every(r => r === 'accepted');
      if (allAccepted) { bet.status = 'locked'; bet.resolvedAt = Date.now(); }
    }
    await env.GOLF_ROOMS.put(`room:${code}`, JSON.stringify(room), { expirationTtl: ROOM_TTL_SECONDS });
  }
  return jsonResponse(room);
}

async function cancelBet(code, betId, request, env) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body');
  const { seat, deviceId } = body;
  if (seat == null) return badRequest('seat is required');

  const raw = await env.GOLF_ROOMS.get(`room:${code}`);
  if (!raw) return notFound();
  const room = JSON.parse(raw);
  if (!room.seats[seat] || !deviceId || room.seats[seat].claimedBy !== deviceId) {
    return jsonResponse({ error: 'Not authorized to cancel for this seat' }, 403);
  }
  const bet = (room.bets || []).find(b => b.id === betId);
  if (!bet) return badRequest('Unknown bet');

  if (bet.status === 'pending' && (seat === bet.proposerSeat || seat === 0)) {
    bet.status = 'cancelled';
    bet.cancelReason = 'withdrawn';
    bet.resolvedAt = Date.now();
    await env.GOLF_ROOMS.put(`room:${code}`, JSON.stringify(room), { expirationTtl: ROOM_TTL_SECONDS });
  }
  return jsonResponse(room);
}

async function route(request, env) {
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

  if (parts.length === 3 && parts[2] === 'bets' && request.method === 'POST') {
    const code = parts[1].toUpperCase();
    return proposeBet(code, request, env);
  }

  if (parts.length === 5 && parts[2] === 'bets' && request.method === 'POST') {
    const code = parts[1].toUpperCase();
    const betId = parts[3];
    if (parts[4] === 'respond') return respondBet(code, betId, request, env);
    if (parts[4] === 'cancel')  return cancelBet(code, betId, request, env);
  }

  return notFound();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const response = await route(request, env);
    const headers = new Headers(response.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, headers });
  },
};
