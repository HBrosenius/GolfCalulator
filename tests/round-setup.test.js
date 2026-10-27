const test = require('node:test');
const assert = require('node:assert/strict');
const { fromRound, freshState } = require('../src/round-setup.js');
const { isRoundSetup, isBackupPayload } = require('../src/validation.js');
const { mergeSnapshots } = require('../src/account-sync.js');
const { createBackupPayload } = require('../src/storage.js');
const course = { name: 'Course', tee: 'Gul', holes: 9, slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17] };
const setup = () => ({ id: 'group', name: 'Thursday', createdAt: 1, updatedAt: 1,
  courses: [structuredClone(course)], gameMode: 'individual', minTeeShots: null,
  players: [{ playerId: 1, name: 'Old name', hi: 20, tee: 'Gul', team: 'A' }] });

test('reusing a setup refreshes stable player identities and excludes old scores and credentials', () => {
  const source = { ...setup(), scores: [[4]], liveHostToken: 'secret', editingId: 99, tourContext: { code: 'ABCD2345' } };
  const state = freshState(source, [{ id: 1, name: 'Current name', hi: -2 }]);
  assert.deepEqual(state.players, [{ name: 'Current name', hi: -2 }]);
  assert.deepEqual(state.playerIds, [1]);
  assert.equal(state._originalTee, 'Gul');
  assert.deepEqual(state.scores, []);
  assert.equal(state.liveHostToken, null);
  assert.equal(state.tourContext, null);
  assert.equal(state.editingId, undefined);
  state.hpar[0] = 3;
  assert.equal(source.courses[0].hpar[0], 4);
  const missing = freshState(setup(), []);
  assert.equal(missing.players[0].hi, 20);
  assert.equal(missing.playerIds[0], null);
});

test('play again reconstructs fourball mixed tees and shared-score teams with missing handicaps left empty', () => {
  const rows = course.hpar.map((par, h) => ({ par, si: course.si[h] }));
  const individual = { ...course, courseName: course.name, gameMode: 'fourball', subjects: [
    { name: 'Ada', playerId: 1, hi: 12, tee: 'Gul', teamId: 'B', rows },
    { name: 'Bo', playerId: 2, hi: 8, tee: 'Röd', slope: 120, cr: 35, par: 36, teamId: 'A', rows },
  ] };
  const replay = fromRound(individual);
  assert.deepEqual(replay.players.map(player => player.team), ['B', 'A']);
  assert.deepEqual(replay.courses.map(tee => tee.tee), ['Gul', 'Röd']);
  assert.equal(replay.courses[1].slope, 120);
  const shared = fromRound({ ...individual, gameMode: 'scramble', subjects: [
    { name: 'Team', members: ['Ada', 'Guest'], memberIds: [1, null], rows },
  ] }, [{ id: 1, name: 'Ada', hi: 9 }]);
  assert.deepEqual(shared.players.map(player => player.hi), [9, null]);
});

test('saved groups validate, round-trip backups and reject executable or credential fields', () => {
  const group = setup();
  assert.equal(isRoundSetup(group), true);
  const backup = createBackupPayload({ setups: [group] });
  assert.equal(isBackupPayload(backup), true);
  assert.equal(isRoundSetup({ ...group, liveHostToken: 'secret' }), false);
  assert.equal(isRoundSetup({ ...group, players: [{ ...group.players[0], photo: '<img>' }] }), false);
  assert.equal(isRoundSetup({ ...group, players: [...group.players, ...group.players] }), false);
  assert.equal(isRoundSetup({ ...group, courses: [{ ...course, si: [] }] }), false);
});

test('groups use three-way sync and tombstones instead of resurrecting stale copies', () => {
  const group = setup();
  const remote = { setups: [{ ...group, name: 'Updated', updatedAt: 2 }] };
  assert.equal(mergeSnapshots(remote, { setups: [group] }, { setups: [group] }).setups[0].name, 'Updated');
  const deleted = mergeSnapshots({ setupDeletions: [{ id: group.id, deletedAt: 3 }] }, { setups: [group] });
  assert.deepEqual(deleted.setups, []);
});
