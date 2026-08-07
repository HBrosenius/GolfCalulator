(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfScoring = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function assertFiniteNumber(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${name} must be a finite number`);
    }
  }

  function assertHoleCount(holes) {
    if (holes !== 9 && holes !== 18) throw new RangeError('holes must be 9 or 18');
  }

  function calculatePlayingHandicap(hi, slope, courseRating, par, holes) {
    [
      [hi, 'hi'], [slope, 'slope'], [courseRating, 'courseRating'], [par, 'par'],
    ].forEach(([value, name]) => assertFiniteNumber(value, name));
    assertHoleCount(holes);
    if (slope <= 0) throw new RangeError('slope must be positive');

    const handicap18 = Math.round(hi * (slope / 113) + (courseRating - par));
    return holes === 9 ? Math.round(handicap18 / 2) : handicap18;
  }

  function strokesOnHole(playingHandicap, strokeIndex, holes) {
    assertFiniteNumber(playingHandicap, 'playingHandicap');
    assertFiniteNumber(strokeIndex, 'strokeIndex');
    assertHoleCount(holes);
    if (!Number.isInteger(playingHandicap)) throw new TypeError('playingHandicap must be an integer');
    if (!Number.isInteger(strokeIndex) || strokeIndex < 1 || strokeIndex > 18) {
      throw new RangeError('strokeIndex must be an integer from 1 to 18');
    }

    // Swedish 9-hole cards retain the odd 18-hole stroke indexes (1, 3 … 17).
    const rank = holes === 9 ? Math.ceil(strokeIndex / 2) : strokeIndex;
    if (rank > holes) throw new RangeError('strokeIndex is outside this round');

    if (playingHandicap >= 0) {
      return Math.floor(playingHandicap / holes) + (rank <= playingHandicap % holes ? 1 : 0);
    }

    // A plus player gives strokes on the easiest holes first.
    const given = Math.abs(playingHandicap);
    const strokesGiven = Math.floor(given / holes) + (rank > holes - (given % holes) ? 1 : 0);
    return strokesGiven === 0 ? 0 : -strokesGiven;
  }

  function calculateStablefordPoints(score, par, strokes) {
    if (score === '' || score === null || score === undefined) return null;
    [score, par, strokes].forEach((value, i) => assertFiniteNumber(value, ['score', 'par', 'strokes'][i]));
    if (!Number.isInteger(score) || score < 1) throw new RangeError('score must be a positive integer');
    if (!Number.isInteger(par) || par < 1) throw new RangeError('par must be a positive integer');
    if (!Number.isInteger(strokes)) throw new TypeError('strokes must be an integer');
    return Math.max(0, par + 2 - (score - strokes));
  }

  function calculateScrambleHandicap(hi1, hi2) {
    assertFiniteNumber(hi1, 'hi1');
    assertFiniteNumber(hi2, 'hi2');
    const lower = Math.min(hi1, hi2);
    const higher = Math.max(hi1, hi2);
    return Math.round(lower * 0.5 + higher * 0.4);
  }

  function calculateFoursomeHandicap(ph1, ph2) {
    assertFiniteNumber(ph1, 'ph1');
    assertFiniteNumber(ph2, 'ph2');
    return Math.round((ph1 + ph2) / 2);
  }

  function calculateFourballTeamPoints(pointRows) {
    if (!Array.isArray(pointRows) || pointRows.length === 0) return 0;
    const holeCount = Math.max(...pointRows.map(row => Array.isArray(row) ? row.length : 0));
    let total = 0;
    for (let hole = 0; hole < holeCount; hole++) {
      const points = pointRows
        .map(row => Array.isArray(row) ? row[hole] : null)
        .filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
      if (points.length) total += Math.max(...points);
    }
    return total;
  }

  function calculateMatchPlayResult(results) {
    const first = results && results[0];
    const second = results && results[1];
    if (!first || !second || !Array.isArray(first.rows) || !Array.isArray(second.rows)) return null;

    const sequence = [];
    const count = Math.min(first.rows.length, second.rows.length);
    for (let i = 0; i < count; i++) {
      const a = first.rows[i];
      const b = second.rows[i];
      if (!a || !b || a.skipped || b.skipped) continue;
      if (!Number.isFinite(a.pts) || !Number.isFinite(b.pts)) continue;
      sequence.push(a.pts > b.pts ? 1 : (a.pts < b.pts ? -1 : 0));
    }

    let lead = 0;
    let winnerIdx = null;
    let text = 'Delad match';
    let decidedAt = sequence.length;
    for (let i = 0; i < sequence.length; i++) {
      lead += sequence[i];
      const remaining = sequence.length - (i + 1);
      if (Math.abs(lead) > remaining) {
        winnerIdx = lead > 0 ? 0 : 1;
        text = remaining > 0 ? `${Math.abs(lead)}&${remaining}` : `${Math.abs(lead)} upp`;
        decidedAt = i + 1;
        break;
      }
    }

    const decided = sequence.slice(0, decidedAt);
    return {
      winnerIdx,
      text,
      aWon: decided.filter(value => value > 0).length,
      bWon: decided.filter(value => value < 0).length,
      halved: decided.filter(value => value === 0).length,
      playedHoles: sequence.length,
    };
  }

  return Object.freeze({
    calculatePlayingHandicap,
    strokesOnHole,
    calculateStablefordPoints,
    calculateScrambleHandicap,
    calculateFoursomeHandicap,
    calculateFourballTeamPoints,
    calculateMatchPlayResult,
  });
}));
