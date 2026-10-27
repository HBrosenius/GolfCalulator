const test = require('node:test');
const assert = require('node:assert/strict');
const explanation = require('../src/score-explanations.js');

test('explanations distinguish unfinished, pickup, received and given strokes', () => {
  assert.equal(explanation.hole('', 4, 1, 5, 9).status, 'unfinished');
  assert.equal(explanation.hole(0, 4, 1, 5, 9).points, 0);
  assert.deepEqual(explanation.hole(5, 4, 1, 5, 9), { status: 'played', score: 5, par: 4, strokeIndex: 1, strokes: 1, net: 4, points: 2 });
  const plus = explanation.hole(4, 4, 17, -1, 9);
  assert.equal(plus.strokes, -1);
  assert.equal(plus.net, 5);
  assert.equal(plus.points, 1);
  assert.equal(explanation.hole(12, 4, 1, 0, 18).points, 0);
});

test('handicap explanation follows the existing rounding before halving nine holes', () => {
  const result = explanation.playingHandicap(10.5, 113, 36, 36, 9);
  assert.equal(result.rounded18, 11);
  assert.equal(result.playingHandicap, 6);
  assert.equal(explanation.playingHandicap(-2, 113, 36, 36, 9).playingHandicap, -1);
});
