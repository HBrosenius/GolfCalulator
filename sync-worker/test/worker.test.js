import { SELF, env, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const PROTOCOL_VERSION = 2;

function round(seatCount = 3) {
  const players = [
    { name: 'Ada', hi: 10, ph: 5, tee: 'Gul' },
    { name: 'Bo', hi: 20, ph: 10, tee: 'Gul' },
    { name: 'Cleo', hi: 15, ph: 8, tee: 'Gul' },
  ].slice(0, seatCount);
  return {
    protocolVersion: PROTOCOL_VERSION,
    courseName: 'Testbanan', teeColor: 'Gul', holes: 9,
    slope: 113, cr: 72, par: 72,
    hpar: [4, 3, 4, 4, 5, 3, 4, 4, 5],
    si: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    gameMode: 'individual', players, seatCount,
    markers: { ctp: { hole: 1, player: '' }, ld: { hole: 4, player: '' }, assigned: true },
  };
}

function mutationHeaders(token) {
  const headers = { 'Content-Type': 'application/json', 'X-Golf-Protocol': String(PROTOCOL_VERSION) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function createRoom(seatCount = 3) {
  const response = await SELF.fetch('https://worker.test/room', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
    body: JSON.stringify(round(seatCount)),
  });
  expect(response.status).toBe(201);
  return response.json();
}

async function claim(code, seat) {
  const response = await SELF.fetch(`https://worker.test/room/${code}/claim`, {
    method: 'POST', headers: mutationHeaders(),
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, seat }),
  });
  return { response, body: await response.json() };
}

async function patch(code, token, body) {
  return SELF.fetch(`https://worker.test/room/${code}`, {
    method: 'PATCH', headers: mutationHeaders(token),
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...body }),
  });
}

describe('secure live-room protocol', () => {
  it('accepts a genuine 9-hole course rating', async () => {
    const payload = round(1);
    payload.cr = 36;
    payload.par = 36;
    const response = await SELF.fetch('https://worker.test/room', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(201);
  });

  it('reports the deployed protocol version for staging health checks', async () => {
    const response = await SELF.fetch('https://worker.test/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, protocolVersion: PROTOCOL_VERSION, service: 'golfcalc-sync' });
  });

  it('accepts bounded anonymous browser error reports without echoing details', async () => {
    const response = await SELF.fetch('https://worker.test/monitor/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify({ kind: 'error', message: 'render failed', source: 'index.html', line: 42 }),
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('creates public state without leaking stored credentials', async () => {
    const created = await createRoom(2);
    expect(created.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(created.hostToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
    expect(created.seatToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
    expect(created.room.seats[0].claimed).toBe(true);
    expect(created.room.seats[1].claimed).toBe(false);
    expect(JSON.stringify(created.room)).not.toMatch(/token|hash|owner|device/i);

    const read = await SELF.fetch(`https://worker.test/room/${created.code}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.stringify(await read.json())).not.toContain(created.hostToken);
  });

  it('requires the correct seat or host authority for every mutation', async () => {
    const created = await createRoom(3);
    const guest = await claim(created.code, 1);
    expect(guest.response.status).toBe(200);
    expect(guest.body.seatToken).toBeTruthy();

    const scores = [4, 4, '', '', '', '', '', '', ''];
    expect((await patch(created.code, null, { seat: 1, scores })).status).toBe(403);
    expect((await patch(created.code, created.seatToken, { seat: 1, scores })).status).toBe(403);
    expect((await patch(created.code, guest.body.seatToken, { seat: 1, scores })).status).toBe(200);

    // Host can fill an unclaimed seat but cannot overwrite a claimed guest.
    expect((await patch(created.code, created.hostToken, { seat: 2, scores })).status).toBe(200);
    expect((await patch(created.code, created.hostToken, { seat: 1, scores })).status).toBe(403);

    const markers = { ctp: { hole: 1, player: 'Ada' }, ld: { hole: 4, player: 'Bo' } };
    expect((await patch(created.code, guest.body.seatToken, { markers })).status).toBe(403);
    expect((await patch(created.code, created.hostToken, { markers, note: 'Fin runda', weather: 'sun' })).status).toBe(200);
  });

  it('rejects missing protocol versions, tampered scores, and oversized bodies', async () => {
    const created = await createRoom(2);
    const noProtocol = await SELF.fetch(`https://worker.test/room/${created.code}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.seatToken}` },
      body: JSON.stringify({ seat: 0, scores: new Array(9).fill(4) }),
    });
    expect(noProtocol.status).toBe(426);

    expect((await patch(created.code, created.seatToken, { seat: 0, scores: [99] })).status).toBe(400);
    const unknownClaimField = await SELF.fetch(`https://worker.test/room/${created.code}/claim`, {
      method: 'POST', headers: mutationHeaders(),
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, seat: 1, deviceId: 'legacy-owner' }),
    });
    expect(unknownClaimField.status).toBe(400);
    const oversized = await SELF.fetch(`https://worker.test/room/${created.code}`, {
      method: 'PATCH', headers: mutationHeaders(created.hostToken),
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, note: 'x'.repeat(17 * 1024) }),
    });
    expect(oversized.status).toBe(413);
  });

  it('serializes simultaneous claims so exactly one caller wins', async () => {
    const created = await createRoom(2);
    const attempts = await Promise.all([claim(created.code, 1), claim(created.code, 1)]);
    expect(attempts.map(item => item.response.status).sort()).toEqual([200, 409]);
    expect(attempts.filter(item => item.body.seatToken)).toHaveLength(1);
  });

  it('preserves concurrent updates to different claimed seats', async () => {
    const created = await createRoom(2);
    const guest = await claim(created.code, 1);
    const first = [4, 4, 4, '', '', '', '', '', ''];
    const second = [5, 5, 5, '', '', '', '', '', ''];
    const responses = await Promise.all([
      patch(created.code, created.seatToken, { seat: 0, scores: first }),
      patch(created.code, guest.body.seatToken, { seat: 1, scores: second }),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const state = await (await SELF.fetch(`https://worker.test/room/${created.code}`)).json();
    expect(state.seats[0].scores).toEqual(first);
    expect(state.seats[1].scores).toEqual(second);
  });

  it('allows a client to reconnect and continue from public room state', async () => {
    const created = await createRoom(2);
    const guest = await claim(created.code, 1);
    const beforeDisconnect = [5, 4, '', '', '', '', '', '', ''];
    expect((await patch(created.code, guest.body.seatToken, { seat: 1, scores: beforeDisconnect })).status).toBe(200);

    // A reconnect carries no credentials while reading. The locally persisted
    // seat token is only sent again when that seat resumes mutating its score.
    const reconnected = await SELF.fetch(`https://worker.test/room/${created.code}`);
    expect(reconnected.status).toBe(200);
    expect((await reconnected.json()).seats[1].scores).toEqual(beforeDisconnect);

    const afterReconnect = [5, 4, 3, '', '', '', '', '', ''];
    expect((await patch(created.code, guest.body.seatToken, { seat: 1, scores: afterReconnect })).status).toBe(200);
    const finalState = await (await SELF.fetch(`https://worker.test/room/${created.code}`)).json();
    expect(finalState.seats[1].scores).toEqual(afterReconnect);
  });

  it('preserves concurrent bet responses and enforces cancellation authority', async () => {
    const created = await createRoom(3);
    const seat1 = await claim(created.code, 1);
    const seat2 = await claim(created.code, 2);
    const proposed = await SELF.fetch(`https://worker.test/room/${created.code}/bets`, {
      method: 'POST', headers: mutationHeaders(created.seatToken),
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, proposerSeat: 0, hole: 2, amount: 20 }),
    });
    expect(proposed.status).toBe(200);
    const betId = (await proposed.json()).bets[0].id;

    const respond = (seat, token) => SELF.fetch(`https://worker.test/room/${created.code}/bets/${betId}/respond`, {
      method: 'POST', headers: mutationHeaders(token),
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, seat, response: 'accept' }),
    });
    const responses = await Promise.all([respond(1, seat1.body.seatToken), respond(2, seat2.body.seatToken)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const state = await (await SELF.fetch(`https://worker.test/room/${created.code}`)).json();
    expect(state.bets[0].status).toBe('locked');

    const secondBet = await SELF.fetch(`https://worker.test/room/${created.code}/bets`, {
      method: 'POST', headers: mutationHeaders(seat1.body.seatToken),
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, proposerSeat: 1, hole: 3, amount: 30 }),
    });
    const secondId = (await secondBet.json()).bets[1].id;
    const denied = await SELF.fetch(`https://worker.test/room/${created.code}/bets/${secondId}/cancel`, {
      method: 'POST', headers: mutationHeaders(seat2.body.seatToken),
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, seat: 2 }),
    });
    expect(denied.status).toBe(403);
    const hostCancel = await SELF.fetch(`https://worker.test/room/${created.code}/bets/${secondId}/cancel`, {
      method: 'POST', headers: mutationHeaders(created.hostToken),
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION }),
    });
    expect(hostCancel.status).toBe(200);
    expect((await hostCancel.json()).bets[1].status).toBe('cancelled');
  });

  it('deletes expired room storage when its alarm runs', async () => {
    const created = await createRoom(2);
    const stub = env.GOLF_ROOMS.getByName(created.code);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await SELF.fetch(`https://worker.test/room/${created.code}`)).status).toBe(404);
  });
});
