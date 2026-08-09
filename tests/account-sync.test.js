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

test('account export downloads the complete authenticated archive', async () => {
  let captured;
  const client = createClient('https://sync.test', async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ format: 'poangbogey-account-export' }), { headers: { 'Content-Type': 'application/json' } });
  });
  const archive = await client.exportAccount('session-token');
  assert.equal(captured.url, 'https://sync.test/account/export');
  assert.equal(captured.options.headers.Authorization, 'Bearer session-token');
  assert.equal(archive.format, 'poangbogey-account-export');
});

test('account dashboard endpoints use authenticated reads', async () => {
  const calls = [];
  const client = createClient('https://sync.test', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ sessions: [] }), { headers: { 'Content-Type': 'application/json' } });
  });
  await client.sessions('session-token');
  assert.equal(calls[0].url, 'https://sync.test/account/sessions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer session-token');
});

test('account session controls address only public session IDs', async () => {
  const calls = [];
  const client = createClient('https://sync.test', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ revoked: 1 }), { headers: { 'Content-Type': 'application/json' } });
  });
  await client.revokeSession('session-token', 'public-session-id');
  await client.revokeOtherSessions('session-token');
  await client.securityEvents('session-token');
  assert.deepEqual(calls.map(call => call.url), [
    'https://sync.test/account/sessions/public-session-id',
    'https://sync.test/account/sessions',
    'https://sync.test/account/security-events',
  ]);
  assert.deepEqual(calls.map(call => call.options.method), ['DELETE', 'DELETE', undefined]);
  calls.forEach(call => assert.equal(call.options.headers.Authorization, 'Bearer session-token'));
});

test('push subscription methods keep keys in authenticated request bodies', async () => {
  const calls = [];
  const client = createClient('https://sync.test', async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ enabled: true }), { headers: { 'Content-Type': 'application/json' } });
  });
  const subscription = { endpoint: 'https://push.test/sub', keys: { p256dh: 'public', auth: 'auth' } };
  await client.pushKey();
  await client.savePush('session', subscription, { rounds: true });
  await client.deletePush('session');
  assert.deepEqual(calls.map(call => call.url), ['https://sync.test/account/push-key', 'https://sync.test/account/push', 'https://sync.test/account/push']);
  assert.equal(JSON.parse(calls[1].options.body).subscription.endpoint, subscription.endpoint);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer session');
  assert.equal(calls[2].options.method, 'DELETE');
});
