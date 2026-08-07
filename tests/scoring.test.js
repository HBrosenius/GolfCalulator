'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../src/scoring.js');

test('playing handicap covers positive, zero, plus and mixed tees', () => {
  assert.equal(scoring.calculatePlayingHandicap(18, 113, 72, 72, 18), 18);
  assert.equal(scoring.calculatePlayingHandicap(0, 113, 72, 72, 18), 0);
  assert.equal(scoring.calculatePlayingHandicap(-2, 113, 72, 72, 18), -2);
  assert.equal(scoring.calculatePlayingHandicap(12.4, 135, 73.8, 72, 18), 17);
  assert.equal(scoring.calculatePlayingHandicap(12.4, 120, 70.2, 72, 18), 11);
});

test('9-hole handicap is rounded from the calculated 18-hole value', () => {
  assert.equal(scoring.calculatePlayingHandicap(17.2, 113, 72, 72, 9), 9);
  assert.equal(scoring.calculatePlayingHandicap(-3, 113, 72, 72, 9), -1);
});

test('stroke allocation covers zero, more than 18 and plus handicaps', () => {
  assert.equal(scoring.strokesOnHole(0, 1, 18), 0);
  assert.equal(scoring.strokesOnHole(20, 1, 18), 2);
  assert.equal(scoring.strokesOnHole(20, 2, 18), 2);
  assert.equal(scoring.strokesOnHole(20, 3, 18), 1);
  assert.equal(scoring.strokesOnHole(-2, 16, 18), 0);
  assert.equal(scoring.strokesOnHole(-2, 17, 18), -1);
  assert.equal(scoring.strokesOnHole(-20, 1, 18), -1);
  assert.equal(scoring.strokesOnHole(-20, 17, 18), -2);
});

test('9-hole stroke indexes are converted from odd 18-hole indexes', () => {
  assert.equal(scoring.strokesOnHole(10, 1, 9), 2);
  assert.equal(scoring.strokesOnHole(10, 3, 9), 1);
  assert.equal(scoring.strokesOnHole(10, 17, 9), 1);
});

test('Stableford calculation handles played, incomplete and invalid scores', () => {
  assert.equal(scoring.calculateStablefordPoints(5, 4, 1), 2);
  assert.equal(scoring.calculateStablefordPoints(8, 4, 0), 0);
  assert.equal(scoring.calculateStablefordPoints(null, 4, 0), null);
  assert.throws(() => scoring.calculateStablefordPoints(0, 4, 0), /positive integer/);
  assert.throws(() => scoring.calculateStablefordPoints(4.5, 4, 0), /positive integer/);
});

test('team formulas cover scramble, foursome and fourball', () => {
  assert.equal(scoring.calculateScrambleHandicap(10, 20), 13);
  assert.equal(scoring.calculateFoursomeHandicap(11, 18), 15);
  assert.equal(scoring.calculateFourballTeamPoints([[2, 1, null], [1, 3, 2]]), 7);
});

test('individual and shared-score modes use the same Stableford rule', () => {
  const individual = scoring.calculateStablefordPoints(5, 4, scoring.strokesOnHole(18, 1, 18));
  const scramble = scoring.calculateStablefordPoints(5, 4, scoring.strokesOnHole(18, 1, 18));
  const foursome = scoring.calculateStablefordPoints(5, 4, scoring.strokesOnHole(18, 1, 18));
  assert.deepEqual({ individual, scramble, foursome }, { individual: 2, scramble: 2, foursome: 2 });
});

test('match play reports an early win and ignores incomplete holes', () => {
  const rows = points => points.map(pts => pts === null ? { skipped: true, pts: 0 } : { skipped: false, pts });
  const result = scoring.calculateMatchPlayResult([
    { rows: rows([3, 3, 3, 3, 2, 2, null]) },
    { rows: rows([2, 2, 2, 2, 2, 2, null]) },
  ]);
  assert.deepEqual(result, {
    winnerIdx: 0, text: '4&2', aWon: 4, bWon: 0, halved: 0, playedHoles: 6,
  });
});

test('match play can finish tied', () => {
  const result = scoring.calculateMatchPlayResult([
    { rows: [{ pts: 3 }, { pts: 1 }] },
    { rows: [{ pts: 1 }, { pts: 3 }] },
  ]);
  assert.equal(result.winnerIdx, null);
  assert.equal(result.text, 'Delad match');
  assert.equal(result.playedHoles, 2);
});

test('invalid scoring inputs fail explicitly', () => {
  assert.throws(() => scoring.calculatePlayingHandicap(NaN, 113, 72, 72, 18), /finite number/);
  assert.throws(() => scoring.calculatePlayingHandicap(12, 0, 72, 72, 18), /positive/);
  assert.throws(() => scoring.strokesOnHole(12, 0, 18), /strokeIndex/);
  assert.throws(() => scoring.strokesOnHole(12, 1, 12), /9 or 18/);
});

test('extracted positive-handicap rules match the v2.0 formulas', () => {
  const legacyPlayingHandicap = (hi, slope, cr, par, holes) => {
    const handicap18 = Math.round(hi * (slope / 113) + (cr - par));
    return holes === 9 ? Math.round(handicap18 / 2) : handicap18;
  };
  const legacyStrokes = (ph, si, holes) => {
    const rank = holes === 9 ? Math.ceil(si / 2) : si;
    return Math.floor(ph / holes) + (rank <= ph % holes ? 1 : 0);
  };

  for (const holes of [9, 18]) {
    for (const hi of [0, 5.4, 18, 36, 54]) {
      assert.equal(
        scoring.calculatePlayingHandicap(hi, 128, 72.8, 72, holes),
        legacyPlayingHandicap(hi, 128, 72.8, 72, holes),
      );
    }
    const indexes = holes === 9 ? [1, 3, 9, 17] : [1, 2, 9, 18];
    for (const ph of [0, 1, holes, holes + 2, holes * 2 + 5]) {
      for (const si of indexes) {
        assert.equal(scoring.strokesOnHole(ph, si, holes), legacyStrokes(ph, si, holes));
      }
    }
  }
});
