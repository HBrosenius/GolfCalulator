import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

class FakeKv {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
}

function request(path, { method = 'GET', body, origin = 'http://localhost:5500' } = {}) {
  const headers = { Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(env, path, options) {
  const response = await worker.fetch(request(path, options), env);
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

const round = {
  courseName: 'Testbanan',
  teeColor: 'Gul',
  holes: 9,
  slope: 113,
  cr: 72,
  par: 72,
  hpar: Array(9).fill(4),
  si: [1, 3, 5, 7, 9, 11, 13, 15, 17],
  gameMode: 'individual',
  players: [
    { name: 'Ada', hi: 12, ph: 6 },
    { name: 'Bo', hi: 18, ph: 9 },
  ],
  seatCount: 2,
};

test('room, claims, scoring, shared fields and bets work end to end', async () => {
  const env = { GOLF_ROOMS: new FakeKv() };

  const created = await call(env, '/room', { method: 'POST', body: round });
  assert.equal(created.response.status, 200);
  assert.match(created.data.code, /^[A-HJ-KM-NP-Z2-9]{4}$/);
  assert.equal(created.data.room.seats[0].scores.length, 9);
  assert.equal(created.response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5500');
  const code = created.data.code;

  const fetched = await call(env, `/room/${code.toLowerCase()}`);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.data.courseName, round.courseName);

  const hostClaim = await call(env, `/room/${code}/claim`, {
    method: 'POST', body: { seat: 0, deviceId: 'host-device' },
  });
  assert.equal(hostClaim.response.status, 200);
  const guestClaim = await call(env, `/room/${code}/claim`, {
    method: 'POST', body: { seat: 1, deviceId: 'guest-device' },
  });
  assert.equal(guestClaim.response.status, 200);

  const conflict = await call(env, `/room/${code}/claim`, {
    method: 'POST', body: { seat: 1, deviceId: 'intruder' },
  });
  assert.equal(conflict.response.status, 409);

  const unauthorizedScore = await call(env, `/room/${code}`, {
    method: 'PATCH', body: { seat: 1, scores: [4], deviceId: 'intruder' },
  });
  assert.equal(unauthorizedScore.response.status, 403);

  const scores = [4, 5, '', '', '', '', '', '', ''];
  const scoreUpdate = await call(env, `/room/${code}`, {
    method: 'PATCH', body: { seat: 1, scores, deviceId: 'guest-device' },
  });
  assert.equal(scoreUpdate.response.status, 200);
  assert.deepEqual(scoreUpdate.data.seats[1].scores, scores);

  const sharedUpdate = await call(env, `/room/${code}`, {
    method: 'PATCH',
    body: {
      markers: { ctp: { hole: 2, player: 'Ada' } },
      note: 'Fin runda', weather: 'sunny', deviceId: 'host-device',
    },
  });
  assert.equal(sharedUpdate.data.markers.ctp.player, 'Ada');
  assert.equal(sharedUpdate.data.note, 'Fin runda');

  const proposed = await call(env, `/room/${code}/bets`, {
    method: 'POST',
    body: { proposerSeat: 0, hole: 2, amount: 20, deviceId: 'host-device' },
  });
  assert.equal(proposed.response.status, 200);
  assert.equal(proposed.data.bets[0].status, 'pending');
  const betId = proposed.data.bets[0].id;

  const accepted = await call(env, `/room/${code}/bets/${betId}/respond`, {
    method: 'POST',
    body: { seat: 1, response: 'accept', deviceId: 'guest-device' },
  });
  assert.equal(accepted.data.bets[0].status, 'locked');
});

test('invalid requests, missing rooms and CORS are handled', async () => {
  const env = { GOLF_ROOMS: new FakeKv() };
  const invalid = await worker.fetch(new Request('https://worker.test/room', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  }), env);
  assert.equal(invalid.status, 400);

  const missing = await call(env, '/room/NOPE');
  assert.equal(missing.response.status, 404);

  const wrongHoles = await call(env, '/room', {
    method: 'POST', body: { ...round, holes: 12 }, origin: 'https://attacker.example',
  });
  assert.equal(wrongHoles.response.status, 400);
  assert.equal(wrongHoles.response.headers.get('Access-Control-Allow-Origin'), null);

  const options = await worker.fetch(request('/room', { method: 'OPTIONS' }), env);
  assert.equal(options.status, 200);
  assert.match(options.headers.get('Access-Control-Allow-Methods'), /PATCH/);
});
