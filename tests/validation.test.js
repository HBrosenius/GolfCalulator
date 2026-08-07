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

test('import and photo validation accept only supported shapes', () => {
  assert.equal(validation.isBackupPayload({ version: 1, rounds: [] }), true);
  assert.equal(validation.isBackupPayload({ version: 2, rounds: [] }), false);
  assert.equal(validation.isBackupPayload({ version: 1 }), false);
  assert.equal(validation.isPhotoDataUrl('data:image/png;base64,AA=='), true);
  assert.equal(validation.isPhotoDataUrl('javascript:alert(1)'), false);
});
