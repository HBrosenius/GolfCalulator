const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, mergeSnapshots } = require('../src/account-sync.js');

test('account client keeps bearer credentials out of magic-link requests', async () => {
  const calls = [];
  const client = createClient('https://sync.test', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  });
  await client.requestLink('henrik@example.com');
  assert.equal(calls[0].url, 'https://sync.test/account/login');
  assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('cloud snapshot merge preserves unique data and lets this device update matching IDs', () => {
  const remote = {
    courses: [{ name: 'A', tee: 'Gul', holes: 18 }],
    rounds: [{ id: 1, note: 'remote' }], players: [{ id: 'p1', hi: 12 }], tours: [],
  };
  const local = {
    courses: [{ name: 'B', tee: 'Gul', holes: 9 }],
    rounds: [{ id: 1, note: 'local' }, { id: 2 }], players: [{ id: 'p1', hi: 11 }], tours: [{ id: 3 }],
  };
  const merged = mergeSnapshots(remote, local);
  assert.equal(merged.courses.length, 2);
  assert.deepEqual(merged.rounds, [{ id: 1, note: 'local' }, { id: 2 }]);
  assert.deepEqual(merged.players, [{ id: 'p1', hi: 11 }]);
  assert.deepEqual(merged.tours, [{ id: 3 }]);
});

test('account deletion uses authenticated DELETE without a request body', async () => {
  let captured;
  const client = createClient('https://sync.test', async (url, options) => {
    captured = { url, options };
    return new Response(null, { status: 204 });
  });
  await client.deleteAccount('session-token');
  assert.equal(captured.url, 'https://sync.test/account/me');
  assert.equal(captured.options.method, 'DELETE');
  assert.equal(captured.options.headers.Authorization, 'Bearer session-token');
  assert.equal(captured.options.body, undefined);
});
