'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../src/validation.js');

test('join-code and bet validation reject malformed client input', () => {
  assert.equal(validation.isJoinCode('ab2d'), true);
  assert.equal(validation.isJoinCode('ABOI'), false);
  assert.equal(validation.isJoinCode('ABC'), false);
  assert.equal(validation.isPositiveInteger(25), true);
  assert.equal(validation.isPositiveInteger(2.5), false);
});

function validBackup() {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    h: index + 1, par: 4, si: index + 1, strokes: 1, score: 5, netto: 4, pts: 2, skipped: false,
  }));
  return {
    version: 1, exportedAt: '2026-08-09T08:00:00.000Z',
    courses: [{
      name: 'Testbanan', tee: 'Gul', holes: 9, slope: 113, cr: 36, par: 36,
      hpar: Array(9).fill(4), si: [1,2,3,4,5,6,7,8,9],
    }],
    rounds: [{
      schemaVersion: 2, id: 123, date: '2026-08-09', courseName: 'Testbanan', tee: 'Gul', mixedTees: false,
      holes: 9, slope: 113, cr: 36, par: 36, gameMode: 'individual', note: '', weather: null,
      markers: { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } }, bets: [],
      liveRoomCode: null, tourRef: null,
      subjects: [{
        playerId: 42, memberId: null, name: 'Ada', hi: 18, ph: 9, tee: 'Gul', slope: 113, cr: 36, par: 36,
        totalPoints: 18, totalBrutto: 45, members: null, memberIds: null, teamId: null, teammate: null, rows,
      }],
    }],
    players: [{ id: 42, name: 'Ada', hi: 18 }],
  };
}

test('import and photo validation accept only supported shapes', () => {
  assert.equal(validation.isBackupPayload(validBackup()), true);
  assert.equal(validation.isBackupPayload({ version: 2, rounds: [] }), false);
  assert.equal(validation.isBackupPayload({ version: 1 }), false);
  assert.equal(validation.isPhotoDataUrl('data:image/png;base64,AA=='), true);
  assert.equal(validation.isPhotoDataUrl('javascript:alert(1)'), false);
});

test('backup validation preserves safe catalogue provenance and rating choices', () => {
  const backup = validBackup();
  Object.assign(backup.courses[0], {
    tee: '55 · Damer', ratingCategory: 'women', catalogTee: '55', catalogId: 'test-gk-9',
    catalogVersion: 2, catalogUpdatedAt: 1786665600000,
    catalogSource: { url: 'https://example.se/scorekort', title: 'Officiellt scorekort' },
    catalogVerifiedAt: 1786665600000, catalogVerificationStatus: 'verified',
  });
  assert.equal(validation.isBackupPayload(backup), true);
  backup.courses[0].catalogSource.url = 'javascript:alert(1)';
  assert.equal(validation.isBackupPayload(backup), false);
});

test('backup validation rejects executable fields, unknown keys, and malformed nested data', () => {
  const maliciousId = validBackup();
  maliciousId.rounds[0].id = '1);globalThis.pwned=true;//';
  assert.equal(validation.isBackupPayload(maliciousId), false);

  const unknownField = validBackup();
  unknownField.courses[0].onclick = 'alert(1)';
  assert.equal(validation.isBackupPayload(unknownField), false);

  const malformedRows = validBackup();
  malformedRows.rounds[0].subjects[0].rows[0].score = '<img src=x onerror=alert(1)>';
  assert.equal(validation.isBackupPayload(malformedRows), false);
});
