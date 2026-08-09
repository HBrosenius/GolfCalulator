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
