import { describe, expect, it } from 'vitest';
import { correctRound } from '../src/round-corrections.js';
function round(mode) {
  const rows = () => Array.from({ length: 9 }, (_, h) => ({ h: h + 1, par: 4, si: h + 1, strokes: 1, score: 5, netto: 4, pts: 2, skipped: false }));
  return { holes: 9, gameMode: mode, subjects: ['ada', 'bo'].map(memberId => ({ memberId, teamId: ['fourball', 'scramble', 'foursome'].includes(mode) ? 'A' : null, totalPoints: 18, totalBrutto: 45, rows: rows() })) };
}
describe('frozen scoring corrections', () => {
  for (const mode of ['individual', 'match', 'fourball', 'scramble', 'foursome']) {
    it(`keeps historical strokes and recalculates ${mode}`, () => {
      const original = round(mode), corrected = correctRound(original, [{ memberId: 'ada', hole: 1, score: 7 }]);
      expect(original.subjects[0].rows[0].score).toBe(5);
      expect(corrected.subjects[0].rows[0]).toMatchObject({ strokes: 1, netto: 6, pts: 0 });
      expect(corrected.subjects[0].totalBrutto).toBe(47);
      expect(corrected.subjects[0].totalPoints).toBe(mode === 'fourball' ? 18 : 16);
      expect(corrected.subjects[1].totalPoints).toBe(['scramble', 'foursome'].includes(mode) ? 16 : 18);
      const pickup = correctRound(corrected, [{ memberId: 'ada', hole: 1, score: null }]);
      expect(pickup.subjects[0].totalBrutto).toBe(40);
      const resumed = correctRound(pickup, [{ memberId: 'ada', hole: 1, score: 4 }]);
      expect(resumed.subjects[0].rows[0]).toMatchObject({ skipped: false, score: 4, pts: 3 });
    });
  }
  it('rejects conflicting edits to a shared team hole', () => {
    expect(() => correctRound(round('scramble'), [{ memberId: 'ada', hole: 1, score: 4 }, { memberId: 'bo', hole: 1, score: 6 }])).toThrow('Conflicting');
  });
});
