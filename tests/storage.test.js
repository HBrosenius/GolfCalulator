'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../src/storage.js');

function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('JSON storage round-trips data and falls back after corrupt JSON', () => {
  const backing = memoryStorage();
  const store = storage.createJsonStore(backing);
  assert.equal(store.available, true);
  assert.equal(store.save('rounds', [{ id: 1 }], true), true);
  assert.deepEqual(store.load('rounds', []), [{ id: 1 }]);
  backing.setItem('rounds', '{broken');
  assert.deepEqual(store.load('rounds', []), []);
});

test('storage failures are reported without throwing', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  const store = storage.createJsonStore(broken);
  assert.equal(store.available, false);
  assert.deepEqual(store.load('key', []), []);
  assert.equal(store.save('key', []), false);
});

test('legacy tour course strings migrate without changing modern entries', () => {
  const modern = { name: 'Binga Golf', maxRounds: 2, holes: 9 };
  assert.deepEqual(storage.migrateTours([
    { id: 'old', courses: ['Binga Golf'] },
    { id: 'new', courses: [modern] },
  ]), [
    { id: 'old', courses: [{ name: 'Binga Golf', maxRounds: 1 }] },
    { id: 'new', courses: [modern] },
  ]);
  assert.deepEqual(storage.migrateTours(null), []);
});

test('backup serialization is versioned and normalizes missing collections', () => {
  const payload = storage.createBackupPayload({ rounds: [{ id: 'r1' }] }, new Date('2026-08-07T12:00:00Z'));
  assert.deepEqual(payload, {
    version: 1,
    exportedAt: '2026-08-07T12:00:00.000Z',
    courses: [],
    rounds: [{ id: 'r1' }],
    players: [],
  });
});

test('round identity uses stable player IDs while preserving legacy name matching', () => {
  const renamed = { id: 42, name: 'Henrik', nick: 'Henk' };
  assert.equal(storage.subjectMatchesPlayer({ playerId: 42, name: 'Old nickname' }, renamed), true);
  assert.equal(storage.subjectMatchesPlayer({ playerId: 7, name: 'Henk' }, renamed), false);
  assert.equal(storage.subjectMatchesPlayer({ name: 'Henk' }, renamed), true);
  assert.equal(storage.roundIncludesPlayer({ subjects: [
    { name: 'Lag A', members: ['Old nickname', 'Other'], memberIds: [42, 9] },
  ] }, renamed), true);
});
