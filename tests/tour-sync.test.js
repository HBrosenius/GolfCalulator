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
