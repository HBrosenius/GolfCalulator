'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/tour-sync.js');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('tour client keeps invitation secrets in the join body', async () => {
  let captured;
  const token = 'A'.repeat(43);
  const client = sync.createClient({
    baseUrl: 'https://example.test/',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ contributorToken: 'B'.repeat(43) }) };
    },
  });
  await client.join('abcd2345', token, 'Min telefon');
  assert.equal(captured.url, 'https://example.test/tour/ABCD2345/join');
  assert.doesNotMatch(captured.url, new RegExp(token));
  assert.equal(JSON.parse(captured.options.body).invitationToken, token);
  assert.equal(captured.options.headers.Authorization, undefined);
});

test('tour client can bind creation and joining to an account token and tour member', async () => {
  const requests = [];
  const client = sync.createClient({
    baseUrl: 'https://example.test',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
  });
  await client.create({ name: 'Tour' }, 'account-session');
  await client.join('ABCD2345', 'A'.repeat(43), 'Telefon', 'account-session', 'member-1');
  requests.forEach(request => assert.equal(request.options.headers.Authorization, 'Bearer account-session'));
  assert.equal(JSON.parse(requests[1].options.body).memberId, 'member-1');
});

test('tour client exposes server errors with status', async () => {
  const client = sync.createClient({
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'Invitation rejected' }) }),
  });
  await assert.rejects(client.join('ABCD2345', 'A'.repeat(43)), error => error.status === 403 && /rejected/.test(error.message));
});

test('organizer client operations use bearer authorization and bounded version bodies', async () => {
  const requests = [];
  const client = sync.createClient({
    baseUrl: 'https://example.test',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ tour: {} }) };
    },
  });
  await client.manage('abcd2345', 'organizer');
  const update = { protocolVersion: 2, schemaVersion: 1, expectedRevision: 1, name: 'Ny' };
  await client.updateConditions('abcd2345', 'organizer', update);
  await client.rotateInvitation('abcd2345', 'organizer');
  await client.complete('abcd2345', 'organizer');
  await client.cancel('abcd2345', 'organizer');
  await client.deleteTour('abcd2345', 'organizer');
  await client.revokeContributor('abcd2345', 'organizer', 'device-1');
  assert.deepEqual(requests.map(item => item.url), [
    'https://example.test/tour/ABCD2345/manage',
    'https://example.test/tour/ABCD2345/conditions',
    'https://example.test/tour/ABCD2345/rotate-invitation',
    'https://example.test/tour/ABCD2345/complete',
    'https://example.test/tour/ABCD2345/cancel',
    'https://example.test/tour/ABCD2345',
    'https://example.test/tour/ABCD2345/contributors/device-1/revoke',
  ]);
  requests.forEach(item => assert.equal(item.options.headers.Authorization, 'Bearer organizer'));
  assert.equal(requests[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[1].options.body), update);
  assert.equal(requests[5].options.method, 'DELETE');
  requests.slice(2).forEach(item => assert.deepEqual(JSON.parse(item.options.body), { protocolVersion: 2, schemaVersion: 1 }));
});

test('membership client operations use account authorization and explicit roles', async () => {
  const requests = [];
  const client = sync.createClient({
    baseUrl: 'https://example.test',
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
  });
  await client.updateMembership('abcd2345', 'account', 'member-1');
  await client.leave('abcd2345', 'account');
  await client.updateContributor('abcd2345', 'account', 'person-1', 'scorekeeper', null);
  await client.restoreContributor('abcd2345', 'account', 'person-1');
  await client.transferOwnership('abcd2345', 'account', 'person-1');
  assert.deepEqual(requests.map(item => item.url), [
    'https://example.test/tour/ABCD2345/membership',
    'https://example.test/tour/ABCD2345/leave',
    'https://example.test/tour/ABCD2345/contributors/person-1/membership',
    'https://example.test/tour/ABCD2345/contributors/person-1/restore',
    'https://example.test/tour/ABCD2345/transfer-ownership',
  ]);
  requests.forEach(item => assert.equal(item.options.headers.Authorization, 'Bearer account'));
  assert.deepEqual(JSON.parse(requests[0].options.body), { protocolVersion: 2, schemaVersion: 1, memberId: 'member-1' });
  assert.deepEqual(JSON.parse(requests[2].options.body), { protocolVersion: 2, schemaVersion: 1, role: 'scorekeeper', memberId: null });
  assert.equal(JSON.parse(requests[4].options.body).contributorId, 'person-1');
});

test('tour activity uses an authenticated read without secrets in the URL', async () => {
  let captured;
  const client = sync.createClient({ baseUrl: 'https://example.test', fetchImpl: async (url, options) => {
    captured = { url, options }; return { ok: true, json: async () => ({ activity: [] }) };
  } });
  await client.activity('abcd2345', 'account-token');
  assert.equal(captured.url, 'https://example.test/tour/ABCD2345/activity');
  assert.equal(captured.options.headers.Authorization, 'Bearer account-token');
  assert.doesNotMatch(captured.url, /account-token/);
});

test('real-time, administrator, correction and announcement client contracts stay versioned', async () => {
  const calls = [];
  const client = sync.createClient({ baseUrl: 'https://sync.test', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ tour: { revision: 2 } }), { headers: { 'Content-Type': 'application/json' } });
  } });
  await client.setAdministrator('ABCD2345', 'token', 'member-1', true);
  await client.editRound('ABCD2345', 'token', 'round-1', 4, '2026-07-11', 'Fel datum');
  await client.announce('ABCD2345', 'token', 'Samling 09:00');
  await client.startRound('ABCD2345', 'token', 'course-1', ['member-1']);
  assert.equal(client.liveUrl('ABCD2345'), 'wss://sync.test/tour/ABCD2345/live');
  assert.equal(client.spectatorFragment('ABCD2345'), '#spectate=ABCD2345');
  assert.deepEqual(calls.map(call => [call.options.method, call.url]), [
    ['PATCH', 'https://sync.test/tour/ABCD2345/contributors/member-1/administrator'],
    ['PATCH', 'https://sync.test/tour/ABCD2345/rounds/round-1'],
    ['POST', 'https://sync.test/tour/ABCD2345/announcements'],
    ['POST', 'https://sync.test/tour/ABCD2345/round-starts'],
  ]);
  assert.equal(JSON.parse(calls[1].options.body).expectedRevision, 4);
});

test('pending submission retry can be limited to one tour', async () => {
  const store = sync.createStore(memoryStorage());
  store.upsert({ code: 'ABCD2345', token: 'one', pendingSubmissions: [] });
  store.upsert({ code: 'EFGH2345', token: 'two', pendingSubmissions: [] });
  store.queueSubmission('ABCD2345', { clientRoundId: 'round-1' });
  store.queueSubmission('EFGH2345', { clientRoundId: 'round-2' });
  const submitted = [];
  const client = { submitRound: async code => { submitted.push(code); return { tour: { revision: 2 } }; } };
  await sync.flushPending(store, client, 'abcd2345');
  assert.deepEqual(submitted, ['ABCD2345']);
  assert.equal(store.find('ABCD2345').pendingSubmissions.length, 0);
  assert.equal(store.find('EFGH2345').pendingSubmissions.length, 1);
});

test('shared tour cache upserts credentials without duplicating codes', () => {
  const store = sync.createStore(memoryStorage());
  assert.equal(store.upsert({ code: 'abcd2345', role: 'contributor', token: 'one' }), true);
  assert.equal(store.upsert({ code: 'ABCD2345', tour: { revision: 2 } }), true);
  assert.equal(store.load().length, 1);
  assert.equal(store.find('abcd2345').token, 'one');
  assert.equal(store.find('ABCD2345').tour.revision, 2);
  assert.equal(store.remove('ABCD2345'), true);
  assert.equal(store.find('ABCD2345'), null);
});

test('invitation links use URL fragments and reject malformed data', () => {
  const token = 'x'.repeat(43);
  const fragment = sync.invitationFragment('abcd2345', token);
  assert.equal(fragment, `#tour=ABCD2345&invite=${token}`);
  assert.deepEqual(sync.parseInvitationFragment(fragment), { code: 'ABCD2345', invitationToken: token });
  assert.equal(sync.parseInvitationFragment('?tour=ABCD2345&invite=' + token), null);
  assert.throws(() => sync.invitationFragment('bad', token), /Invalid/);
});

test('pending submissions survive failures and clear after an idempotent retry', async () => {
  const store = sync.createStore(memoryStorage());
  store.upsert({ code: 'ABCD2345', token: 'secret', pendingSubmissions: [] });
  store.queueSubmission('ABCD2345', { clientRoundId: 'round-1' });
  let fail = true;
  const client = {
    submitRound: async () => {
      if (fail) throw new Error('offline');
      return { tour: { revision: 3 }, duplicate: true };
    },
  };
  const first = await sync.flushPending(store, client);
  assert.equal(first[0].ok, false);
  assert.equal(store.find('ABCD2345').pendingSubmissions[0].attempts, 1);
  fail = false;
  const second = await sync.flushPending(store, client);
  assert.equal(second[0].ok, true);
  assert.deepEqual(store.find('ABCD2345').pendingSubmissions, []);
  assert.equal(store.find('ABCD2345').tour.revision, 3);
});
