(function (root, factory) {
  const scoring = typeof module === 'object' && module.exports ? require('./scoring.js') : root.GolfScoring;
  const api = factory(scoring);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfScoreExplanations = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (scoring) {
  'use strict';
  function hole(score, par, strokeIndex, handicap, holes) {
    const strokes = scoring.strokesOnHole(handicap, strokeIndex, holes);
    if (score === '' || score == null) return { status: 'unfinished', par, strokeIndex, strokes };
    if (score === 0) return { status: 'pickup', par, strokeIndex, strokes, points: 0 };
    return { status: 'played', score, par, strokeIndex, strokes, net: score - strokes,
      points: scoring.calculateStablefordPoints(score, par, strokes) };
  }
  function playingHandicap(hi, slope, courseRating, par, holes) {
    const unrounded = hi * slope / 113 + courseRating - par;
    return { hi, slope, courseRating, par, holes, unrounded, rounded18: Math.round(unrounded),
      playingHandicap: scoring.calculatePlayingHandicap(hi, slope, courseRating, par, holes) };
  }
  return Object.freeze({ hole, playingHandicap });
}));
