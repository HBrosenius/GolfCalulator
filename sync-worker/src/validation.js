export const PROTOCOL_VERSION = 2;
export const MAX_BODY_BYTES = 16 * 1024;
const GAME_MODES = new Set(['individual', 'scramble', 'fourball', 'foursome', 'match']);
const WEATHER = new Set([null, 'sun', 'cloud', 'rain', 'wind']);

function isText(value, max, allowEmpty = false) {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);
}

function isNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function hasOnlyKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.has(key));
}

export async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) return { error: 'Request body is too large', status: 413 };
  if (!request.body) return { error: 'Invalid request', status: 400 };

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return { error: 'Request body is too large', status: 413 };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach(chunk => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { error: 'Invalid request', status: 400 }; }
}

export function hasProtocol(value) {
  return value && value.protocolVersion === PROTOCOL_VERSION;
}

export function validateCreate(body) {
  if (!hasProtocol(body)) return 'Unsupported protocol version';
  const allowed = new Set([
    'protocolVersion', 'courseName', 'teeColor', 'holes', 'slope', 'cr', 'par',
    'hpar', 'si', 'gameMode', 'teams', 'players', 'seatCount', 'markers', 'tourRef',
  ]);
  if (!hasOnlyKeys(body, allowed)) return 'Invalid round configuration';
  if (!isText(body.courseName, 80) || !isText(body.teeColor, 20)) return 'Invalid round configuration';
  if (body.holes !== 9 && body.holes !== 18) return 'Invalid round configuration';
  if (!isNumber(body.slope, 55, 155) || !isNumber(body.cr, 25, 85) || !isInteger(body.par, 27, 90)) return 'Invalid round configuration';
  if (!GAME_MODES.has(body.gameMode)) return 'Invalid round configuration';
  if (!isInteger(body.seatCount, 1, 12)) return 'Invalid round configuration';
  if (!Array.isArray(body.players) || body.players.length < 1 || body.players.length > 12) return 'Invalid round configuration';
  const sharedScores = body.gameMode === 'scramble' || body.gameMode === 'foursome';
  if (body.seatCount !== (sharedScores ? 2 : body.players.length)) return 'Invalid round configuration';
  if (!Array.isArray(body.hpar) || body.hpar.length !== body.holes || !body.hpar.every(value => isInteger(value, 3, 6))) return 'Invalid round configuration';
  if (!Array.isArray(body.si) || body.si.length !== body.holes || !body.si.every(value => isInteger(value, 1, 18))) return 'Invalid round configuration';
  if (new Set(body.si).size !== body.si.length) return 'Invalid round configuration';
  const playerKeys = new Set(['name', 'hi', 'ph', 'tee', 'slope', 'cr', 'par', 'playingHandicap']);
  if (!body.players.every(player => hasOnlyKeys(player, playerKeys) && isText(player.name, 50) && isNumber(player.hi, 0, 54) &&
    (player.tee == null || isText(player.tee, 20)) &&
    (player.ph == null || isInteger(player.ph, -20, 72)) &&
    (player.playingHandicap == null || isInteger(player.playingHandicap, -20, 72)))) return 'Invalid round configuration';
  if (!validateTeams(body.teams, body.players, body.gameMode)) return 'Invalid round configuration';
  if (body.markers !== undefined && !validateMarkers(body.markers, body)) return 'Invalid round configuration';
  if (body.tourRef !== undefined && (!hasOnlyKeys(body.tourRef, new Set(['code'])) ||
    !/^[A-HJ-KM-NP-Z2-9]{8}$/.test(body.tourRef.code))) return 'Invalid round configuration';
  return null;
}

export function validateClaim(body, seatCount) {
  const allowed = new Set(['protocolVersion', 'seat']);
  return hasProtocol(body) && hasOnlyKeys(body, allowed) && isInteger(body.seat, 0, seatCount - 1) ? null : 'Invalid request';
}

export function validateScores(scores, holes) {
  return Array.isArray(scores) && scores.length === holes && scores.every(score =>
    score === '' || score === null || isInteger(score, 1, 20));
}

export function validatePatch(body, room) {
  if (!hasProtocol(body)) return 'Unsupported protocol version';
  const allowed = new Set(['protocolVersion', 'seat', 'scores', 'markers', 'note', 'weather']);
  if (Object.keys(body).some(key => !allowed.has(key))) return 'Invalid request';
  if (body.seat !== undefined && (!isInteger(body.seat, 0, room.seats.length - 1) || !validateScores(body.scores, room.holes))) return 'Invalid request';
  if (body.seat === undefined && body.scores !== undefined) return 'Invalid request';
  if (body.note !== undefined && !isText(body.note, 120, true)) return 'Invalid request';
  if (body.weather !== undefined && !WEATHER.has(body.weather)) return 'Invalid request';
  if (body.markers !== undefined && !validateMarkers(body.markers, room)) return 'Invalid request';
  if (body.seat === undefined && body.markers === undefined && body.note === undefined && body.weather === undefined) return 'Invalid request';
  return null;
}

function validateMarkers(markers, room) {
  const markerKeys = new Set(['hole', 'player']);
  if (!hasOnlyKeys(markers, new Set(['ctp', 'ld', 'assigned']))) return false;
  if (markers.assigned !== undefined && typeof markers.assigned !== 'boolean') return false;
  const names = new Set(room.players.map(player => player.name));
  const validMarker = marker => hasOnlyKeys(marker, markerKeys) &&
    (marker.hole === null || isInteger(marker.hole, 0, room.holes - 1)) &&
    isText(marker.player ?? '', 50, true) && (!marker.player || names.has(marker.player));
  return validMarker(markers.ctp) && validMarker(markers.ld);
}

function validateTeams(teams, players, gameMode) {
  if (teams == null) return gameMode !== 'scramble' && gameMode !== 'foursome';
  if (!Array.isArray(teams) || teams.length !== 2) return false;
  const names = new Set(players.map(player => player.name));
  const teamKeys = new Set(['name', 'members', 'playingHandicap']);
  return teams.every(team => hasOnlyKeys(team, teamKeys) && isText(team.name, 30) &&
    isInteger(team.playingHandicap, -20, 72) && Array.isArray(team.members) &&
    team.members.length >= 1 && team.members.length <= 6 &&
    team.members.every(member => member && isText(member.name, 50) && names.has(member.name)));
}

export function validateBetProposal(body, room) {
  const allowed = new Set(['protocolVersion', 'proposerSeat', 'hole', 'amount']);
  return hasProtocol(body) && hasOnlyKeys(body, allowed) && isInteger(body.proposerSeat, 0, room.seats.length - 1) &&
    isInteger(body.hole, 0, room.holes - 1) && isInteger(body.amount, 1, 10000) ? null : 'Invalid request';
}

export function validateBetResponse(body, room) {
  const allowed = new Set(['protocolVersion', 'seat', 'response']);
  return hasProtocol(body) && hasOnlyKeys(body, allowed) && isInteger(body.seat, 0, room.seats.length - 1) &&
    (body.response === 'accept' || body.response === 'decline') ? null : 'Invalid request';
}

export function validateBetCancel(body, room) {
  const allowed = new Set(['protocolVersion', 'seat']);
  return hasProtocol(body) && hasOnlyKeys(body, allowed) &&
    (body.seat === undefined || isInteger(body.seat, 0, room.seats.length - 1)) ? null : 'Invalid request';
}
