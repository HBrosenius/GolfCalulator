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
