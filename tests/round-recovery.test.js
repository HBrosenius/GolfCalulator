const test = require('node:test');
const assert = require('node:assert/strict');
const recovery = require('../src/round-recovery.js');
const state = { draftId: 'draft-a', courseName: 'Course', scores: [['', 0]], liveHostToken: 'device-only' };

test('multiple named drafts retain independent scores and detect stale revisions', () => {
  const first = recovery.saveDraft(null, { ...state, draftName: 'Morning' }, 0, 1);
  assert.equal(first.value.draft.status, 'in_progress');
  const second = recovery.saveDraft(first.vault, { ...state, draftId: 'draft-b', draftName: 'Afternoon', scores: [['']] }, 0, 2);
  assert.equal(second.value.draft.status, 'draft');
  const changed = recovery.saveDraft(second.vault, { ...state, scores: [[4, 0]] }, 1, 3);
  const conflict = recovery.saveDraft(changed.vault, { ...state, scores: [[6, 0]] }, 1, 4);
  assert.equal(conflict.value.forked, true);
  assert.notEqual(conflict.value.draft.id, state.draftId);
  assert.deepEqual(conflict.vault.drafts.find(draft => draft.id === 'draft-a').state.scores, [[4, 0]]);
  assert.deepEqual(conflict.value.draft.state.scores, [[6, 0]]);
  assert.equal(conflict.vault.drafts.find(draft => draft.id === 'draft-b').name, 'Afternoon');
});

test('deleted/completed drafts cannot be silently recreated by an old tab', () => {
  const first = recovery.saveDraft(null, state, 0, 1);
  const removed = recovery.removeDraft(first.vault, state.draftId, 2);
  const stale = recovery.saveDraft(removed.vault, state, 1, 3);
  assert.equal(stale.value.forked, true);
  assert.notEqual(stale.value.draft.id, state.draftId);
});

test('trash expires after thirty days and restoration is a new idempotent local identity', () => {
  const round = { id: 7, courseName: 'Old round', tourRef: { code: 'ABCD2345', syncStatus: 'pending' }, sourceDraftId: 'draft', liveRoomCode: 'A'.repeat(20) };
  const archived = recovery.archiveRound(null, round, 1);
  assert.equal(archived.value.round.id, 7);
  const restored = recovery.prepareRestore(archived.vault, archived.value.id, 2);
  const retry = recovery.prepareRestore(restored.vault, archived.value.id, 3);
  assert.equal(retry.value.id, restored.value.id);
  assert.notEqual(restored.value.id, 7);
  assert.equal(restored.value.restoredFrom, '7');
  assert.equal(restored.value.tourRef, null);
  assert.equal(restored.value.liveRoomCode, null);
  assert.equal(restored.value.sourceDraftId, undefined);
  assert.equal(recovery.cleanVault(restored.vault, recovery.RETENTION_MS + 2).trash.length, 0);
});

test('practice and in-progress data never enters local tour standings', () => {
  const { matchingRounds } = require('../src/tour-rules.js');
  const tour = { courses: [{ name: 'Course', holes: 9 }], roster: [1], startDate: '2026-01-01', endDate: '2026-12-31' };
  const round = { id: 1, date: '2026-05-15', courseName: 'Course', holes: 9, gameMode: 'individual', subjects: [{ playerId: 1 }] };
  assert.equal(matchingRounds(tour, [round], [{ id: 1 }]).length, 1);
  assert.equal(matchingRounds(tour, [{ ...round, roundKind: 'practice' }], [{ id: 1 }]).length, 0);
  assert.equal(matchingRounds(tour, [{ ...round, lifecycle: 'in_progress' }], [{ id: 1 }]).length, 0);
});
