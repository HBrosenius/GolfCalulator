import { DurableObject } from 'cloudflare:workers';
import { generateToken, hashToken, tokenMatches } from './auth.js';
import {
  PROTOCOL_VERSION, validateBetCancel, validateBetProposal, validateBetResponse,
  validateClaim, validatePatch,
} from './validation.js';

const ROOM_KEY = 'room';
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const CLAIM_WINDOW_MS = 60 * 1000;
const CLAIM_FAILURE_LIMIT = 10;

const result = (status, data = {}) => ({ status, ...data });

function publicRoom(room) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    courseName: room.courseName,
    teeColor: room.teeColor,
    holes: room.holes,
    slope: room.slope,
    cr: room.cr,
    par: room.par,
    hpar: room.hpar,
    si: room.si,
    gameMode: room.gameMode,
    teams: room.teams,
    players: room.players,
    seats: room.seats.map(seat => ({ scores: seat.scores, claimed: !!seat.tokenHash })),
    markers: room.markers,
    note: room.note,
    weather: room.weather,
    bets: room.bets,
  };
}

export class GolfRoom extends DurableObject {
  async create(config, hostTokenHash, seatTokenHash) {
    if (await this.ctx.storage.get(ROOM_KEY)) return result(409, { error: 'Room unavailable' });
    const now = Date.now();
    const seats = Array.from({ length: config.seatCount }, (_, seat) => ({
      scores: new Array(config.holes).fill(''),
      tokenHash: seat === 0 ? seatTokenHash : null,
    }));
    const room = {
      protocolVersion: PROTOCOL_VERSION,
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
      courseName: config.courseName,
      teeColor: config.teeColor,
      holes: config.holes,
      slope: config.slope,
      cr: config.cr,
      par: config.par,
      hpar: config.hpar,
      si: config.si,
      gameMode: config.gameMode,
      teams: config.teams ? config.teams.map(team => ({
        name: team.name,
        playingHandicap: team.playingHandicap,
        members: team.members.map(member => ({ name: member.name })),
      })) : null,
      players: config.players.map(player => ({ name: player.name, hi: player.hi, ph: player.ph, tee: player.tee || null })),
      seats,
      hostTokenHash,
      markers: config.markers || { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } },
      note: '',
      weather: null,
      bets: [],
      failedClaims: [],
    };
    await this.ctx.storage.put(ROOM_KEY, room);
    await this.ctx.storage.setAlarm(room.expiresAt);
    return result(201, { room: publicRoom(room) });
  }

  async getPublicState() {
    const room = await this.ctx.storage.get(ROOM_KEY);
    return room ? result(200, { room: publicRoom(room) }) : result(404, { error: 'Room not found' });
  }

  async claimSeat(body) {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return result(404, { error: 'Room not found' });
    const now = Date.now();
    room.failedClaims = (room.failedClaims || []).filter(time => time > now - CLAIM_WINDOW_MS);
    if (room.failedClaims.length >= CLAIM_FAILURE_LIMIT) return result(429, { error: 'Too many attempts' });
    if (validateClaim(body, room.seats.length)) return this.failedClaim(room);
    if (room.seats[body.seat].tokenHash) return this.failedClaim(room, 409, 'Seat unavailable');

    const seatToken = generateToken();
    room.seats[body.seat].tokenHash = await hashToken(seatToken);
    await this.ctx.storage.put(ROOM_KEY, room);
    return result(200, { room: publicRoom(room), seatToken });
  }

  async failedClaim(room, status = 400, error = 'Invalid request') {
    room.failedClaims.push(Date.now());
    await this.ctx.storage.put(ROOM_KEY, room);
    return result(status, { error, room: publicRoom(room) });
  }

  async patch(body, token) {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return result(404, { error: 'Room not found' });
    const invalid = validatePatch(body, room);
    if (invalid) return result(invalid.startsWith('Unsupported') ? 426 : 400, { error: invalid });

    const isHost = await tokenMatches(token, room.hostTokenHash);
    if (body.seat !== undefined) {
      const seat = room.seats[body.seat];
      const ownsSeat = await tokenMatches(token, seat.tokenHash);
      const hostMayFill = isHost && !seat.tokenHash;
      if (!ownsSeat && !hostMayFill) return result(403, { error: 'Not authorized' });
      seat.scores = body.scores;
    }
    if (body.markers !== undefined || body.note !== undefined || body.weather !== undefined) {
      if (!isHost) return result(403, { error: 'Not authorized' });
      if (body.markers !== undefined) room.markers = body.markers;
      if (body.note !== undefined) room.note = body.note;
      if (body.weather !== undefined) room.weather = body.weather;
    }
    await this.ctx.storage.put(ROOM_KEY, room);
    return result(200, { room: publicRoom(room) });
  }

  async proposeBet(body, token) {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return result(404, { error: 'Room not found' });
    if (validateBetProposal(body, room)) return result(400, { error: 'Invalid request' });
    if (!await tokenMatches(token, room.seats[body.proposerSeat].tokenHash)) return result(403, { error: 'Not authorized' });
    if (room.bets.some(bet => bet.hole === body.hole && (bet.status === 'pending' || bet.status === 'locked'))) {
      return result(409, { error: 'Bet unavailable', room: publicRoom(room) });
    }
    const responses = {};
    room.seats.forEach((_, seat) => { if (seat !== body.proposerSeat) responses[seat] = 'pending'; });
    room.bets.push({
      id: crypto.randomUUID(), hole: body.hole, amount: body.amount, proposerSeat: body.proposerSeat,
      createdAt: Date.now(), resolvedAt: null, status: 'pending', cancelReason: null, responses,
    });
    await this.ctx.storage.put(ROOM_KEY, room);
    return result(200, { room: publicRoom(room) });
  }

  async respondBet(betId, body, token) {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return result(404, { error: 'Room not found' });
    if (validateBetResponse(body, room)) return result(400, { error: 'Invalid request' });
    if (!await tokenMatches(token, room.seats[body.seat].tokenHash)) return result(403, { error: 'Not authorized' });
    const bet = room.bets.find(item => item.id === betId);
    if (!bet) return result(400, { error: 'Invalid request' });
    if (bet.status === 'pending') {
      if (body.response === 'decline') {
        bet.status = 'cancelled'; bet.cancelReason = 'declined'; bet.resolvedAt = Date.now();
      } else if (Object.hasOwn(bet.responses, body.seat)) {
        bet.responses[body.seat] = 'accepted';
        if (Object.values(bet.responses).every(response => response === 'accepted')) {
          bet.status = 'locked'; bet.resolvedAt = Date.now();
        }
      }
      await this.ctx.storage.put(ROOM_KEY, room);
    }
    return result(200, { room: publicRoom(room) });
  }

  async cancelBet(betId, body, token) {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return result(404, { error: 'Room not found' });
    if (validateBetCancel(body, room)) return result(400, { error: 'Invalid request' });
    const bet = room.bets.find(item => item.id === betId);
    if (!bet) return result(400, { error: 'Invalid request' });
    const isHost = await tokenMatches(token, room.hostTokenHash);
    const isProposer = body.seat === bet.proposerSeat && await tokenMatches(token, room.seats[body.seat].tokenHash);
    if (!isHost && !isProposer) return result(403, { error: 'Not authorized' });
    if (bet.status === 'pending') {
      bet.status = 'cancelled'; bet.cancelReason = 'withdrawn'; bet.resolvedAt = Date.now();
      await this.ctx.storage.put(ROOM_KEY, room);
    }
    return result(200, { room: publicRoom(room) });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export class CreateRateLimiter extends DurableObject {
  async check() {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const attempts = ((await this.ctx.storage.get('attempts')) || []).filter(time => time > now - windowMs);
    if (attempts.length >= 10) return false;
    attempts.push(now);
    await this.ctx.storage.put('attempts', attempts);
    await this.ctx.storage.setAlarm(now + windowMs);
    return true;
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}
