'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const liveSync = require('../src/live-sync.js');

test('live-sync client builds versioned authenticated mutations', async () => {
  let captured;
  const client = liveSync.createClient({
    baseUrl: 'https://example.test/',
    fetchImpl: async (url, options) => { captured = { url, options }; return { ok: true }; },
  });
  await client.mutation('/room/ABCD', 'PATCH', { seat: 1, scores: [4] }, 'secret');
  assert.equal(captured.url, 'https://example.test/room/ABCD');
  assert.equal(captured.options.headers.Authorization, 'Bearer secret');
  assert.equal(captured.options.headers['X-Golf-Protocol'], '2');
  assert.deepEqual(JSON.parse(captured.options.body), { protocolVersion: 2, seat: 1, scores: [4] });
});

test('live-sync read requests carry no credentials by default', async () => {
  let captured;
  const client = liveSync.createClient({ fetchImpl: async (url, options) => { captured = { url, options }; } });
  await client.request('/room/ABCD');
  assert.equal(captured.url, `${liveSync.DEFAULT_BASE_URL}/room/ABCD`);
  assert.equal(captured.options, undefined);
});

test('failed score pushes stay queued and succeed on online retry', async () => {
  let fail = true;
  const sent = [];
  const round = { code: 'ABCD', localSeat: 1, seatToken: 'seat', hostToken: null, scores: [[], ['4']] };
  const controller = liveSync.createScorePushController({
    debounceMs: 0, getRound: () => round,
    send: payload => { sent.push(payload); return fail ? Promise.reject(new Error('offline')) : Promise.resolve(true); },
  });
  controller.mark(1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(controller.pendingSeats(), [1]);
  fail = false;
  assert.equal(await controller.flush(), true);
  assert.deepEqual(controller.pendingSeats(), []);
  assert.deepEqual(sent.at(-1).scores, ['4']);
});

test('a newer edit is not cleared by an older in-flight push', async () => {
  let release;
  const round = { code: 'ABCD', localSeat: 0, seatToken: 'seat', hostToken: 'host', scores: [['4']] };
  const controller = liveSync.createScorePushController({
    debounceMs: 1000, getRound: () => round,
    send: () => new Promise(resolve => { release = resolve; }),
  });
  controller.mark(0);
  const flushing = controller.flush();
  round.scores[0][0] = '5';
  controller.mark(0);
  release(true);
  await flushing;
  assert.deepEqual(controller.pendingSeats(), [0]);
  controller.stop();
});

test('switching rooms discards pending work and ignores stale completion', async () => {
  let release;
  const round = { code: 'OLD1', localSeat: 0, seatToken: 'old', scores: [['4']] };
  const controller = liveSync.createScorePushController({
    debounceMs: 1000, getRound: () => round,
    send: () => new Promise(resolve => { release = resolve; }),
  });
  controller.mark(0);
  const flushing = controller.flush();
  round.code = 'NEW2';
  round.scores = [['5']];
  controller.mark(0);
  release(true);
  await flushing;
  assert.deepEqual(controller.pendingSeats(), [0]);
  controller.stop();
});
