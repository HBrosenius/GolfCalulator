import { DurableObject } from 'cloudflare:workers';
import { generateToken, hashToken, tokenMatches } from './auth.js';
import {
  PROTOCOL_VERSION, validateBetCancel, validateBetProposal, validateBetResponse,
  validateClaim, validatePatch,
} from './validation.js';

const ROOM_KEY = 'room';
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const result = (status, data = {}) => ({ status, ...data });

function publicRoom(room) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    courseName: room.courseName,
    teeColor: room.teeColor,
    holes: room.holes,
    ...(room.layout ? {layout:room.layout} : {}), ...(room.ratingHoles ? {ratingHoles:room.ratingHoles} : {}),
    slope: room.slope,
    cr: room.cr,
    par: room.par,
    hpar: room.hpar,
    si: room.si,
    gameMode: room.gameMode, playedDate: room.playedDate || null, roundKind: room.roundKind || 'competitive',
    teams: room.teams,
    players: room.players,
    seats: room.seats.map(seat => ({ scores: seat.scores, ...(seat.holeStats ? { holeStats: seat.holeStats } : {}), claimed: !!seat.tokenHash })),
    markers: room.markers,
    note: room.note,
    weather: room.weather,
    bets: room.bets,
    tourRef: room.tourRef || null,
  };
}

export class GolfRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.mutationTail = Promise.resolve();
  }

  serializedMutation(operation) {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.catch(() => {});
    return result;
  }

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
      ...(config.layout ? {layout:structuredClone(config.layout)} : {}), ...(config.ratingHoles ? {ratingHoles:config.ratingHoles} : {}),
      slope: config.slope,
      cr: config.cr,
      par: config.par,
      hpar: config.hpar,
      si: config.si,
      gameMode: config.gameMode, playedDate: config.playedDate || null, roundKind: config.roundKind || 'competitive',
      teams: config.teams ? config.teams.map(team => ({
        name: team.name,
        playingHandicap: team.playingHandicap,
        members: team.members.map(member => ({ name: member.name })),
      })) : null,
      players: config.players.map(player => ({ name: player.name, hi: player.hi, ph: player.ph, tee: player.tee || null, ...(config.layout ? {slope:player.slope??config.slope,cr:player.cr??config.cr,par:player.par??config.par} : {}) })),
      seats,
      hostTokenHash,
      markers: config.markers || { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } },
      note: '',
      weather: null,
      bets: [],
      tourRef: config.tourRef || null,
      failedClaims: [],
    };
    await this.ctx.storage.put(ROOM_KEY, room);
    await this.ctx.storage.setAlarm(room.expiresAt);
    return result(201, { room: publicRoom(room) });
  }

  async checkLayoutSupport() {
    const room=await this.ctx.storage.get(ROOM_KEY);
    return room && (room.ratingHoles===9 || (room.layout && (room.layout.startHole!==1 || room.layout.holeNumbers.some((h,i)=>h!==i+1)))) ? result(426,{error:'Update the app to use this hole layout'}) : result(200);
  }

  async getPublicState(token = null) {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return result(404, { error: 'Room not found' });
    if (token) {
      let authorized = await tokenMatches(token, room.hostTokenHash);
      for (const seat of room.seats) if (await tokenMatches(token, seat.tokenHash)) authorized = true;
      return authorized ? result(200, { room: publicRoom(room) }) : result(403, { error: 'Not authorized' });
    }
    return result(200, { room: {
      protocolVersion: PROTOCOL_VERSION, courseName: room.courseName, holes: room.holes, gameMode: room.gameMode,
      players: room.players.map(player => ({ name: player.name })),
      teams: room.teams?.map(team => ({ name: team.name, members: team.members.map(member => ({ name: member.name })) })) || null,
      seats: room.seats.map(seat => ({ claimed: !!seat.tokenHash })),
    } });
  }

  async claimSeat(body) {
    return this.serializedMutation(async () => {
    const room = await this.ctx.storage.get(ROOM_KEY);
    if (!room) return result(404, { error: 'Room not found' });
    if (validateClaim(body, room.seats.length)) return this.failedClaim(room);
    if (room.seats[body.seat].tokenHash) return this.failedClaim(room, 409, 'Seat unavailable');

    const seatToken = generateToken();
    room.seats[body.seat].tokenHash = await hashToken(seatToken);
    await this.ctx.storage.put(ROOM_KEY, room);
    return result(200, { room: publicRoom(room), seatToken });
    });
  }

  async failedClaim(room, status = 400, error = 'Invalid request') {
    return result(status, { error });
  }

  async revokeSeat(body, token) {
    return this.serializedMutation(async () => {
      const room = await this.ctx.storage.get(ROOM_KEY);
      if (!room) return result(404, { error: 'Room not found' });
      if (!await tokenMatches(token, room.hostTokenHash)) return result(403, { error: 'Not authorized' });
      if (validateClaim(body, room.seats.length) || body.seat === 0) return result(400, { error: 'Invalid seat' });
      room.seats[body.seat].tokenHash = null;
      await this.ctx.storage.put(ROOM_KEY, room);
      return result(200, { room: publicRoom(room) });
    });
  }

  async patch(body, token) {
    return this.serializedMutation(async () => {
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
      if (body.holeStats !== undefined) seat.holeStats = body.holeStats;
    }
    if (body.markers !== undefined || body.note !== undefined || body.weather !== undefined) {
      if (!isHost) return result(403, { error: 'Not authorized' });
      if (body.markers !== undefined) room.markers = body.markers;
      if (body.note !== undefined) room.note = body.note;
      if (body.weather !== undefined) room.weather = body.weather;
    }
    await this.ctx.storage.put(ROOM_KEY, room);
    return result(200, { room: publicRoom(room) });
    });
  }

  async proposeBet(body, token) {
    return this.serializedMutation(async () => {
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
    });
  }

  async respondBet(betId, body, token) {
    return this.serializedMutation(async () => {
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
    });
  }

  async cancelBet(betId, body, token) {
    return this.serializedMutation(async () => {
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
    });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export class CreateRateLimiter extends DurableObject {
  async check(limit = 10) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const attempts = ((await this.ctx.storage.get('attempts')) || []).filter(time => time > now - windowMs);
    if (attempts.length >= limit) return false;
    attempts.push(now);
    await this.ctx.storage.put('attempts', attempts);
    await this.ctx.storage.setAlarm(now + windowMs);
    return true;
  }

  async alarm() { await this.ctx.storage.deleteAll(); }
}
