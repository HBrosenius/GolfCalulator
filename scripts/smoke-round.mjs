import Scoring from '../src/scoring.js';

// Build a real played-to-handicap round using the stored member and tee.
export function buildSmokeSubmission(tour, playedDate) {
  const course = tour.courses[0];
  const tee = course.tees[0];
  const member = tour.members[0];
  const handicap = Scoring.calculatePlayingHandicap(member.hi, tee.slope, tee.cr, tee.par, course.holes);
  const rows = tee.hpar.map((par, index) => {
    const si = tee.si[index];
    const strokes = Scoring.strokesOnHole(handicap, si, course.holes);
    const score = par + strokes;
    return { h: index + 1, par, si, strokes, score, netto: score - strokes,
      pts: Scoring.calculateStablefordPoints(score, par, strokes), skipped: false };
  });
  return {
    protocolVersion: 2, schemaVersion: 1, clientRoundId: crypto.randomUUID(), playedDate,
    courseId: course.id, gameMode: 'individual',
    subjects: [{ memberId: member.id, teeName: tee.name, teamId: null, rows,
      totalPoints: rows.reduce((sum, row) => sum + row.pts, 0),
      totalBrutto: rows.reduce((sum, row) => sum + row.score, 0) }],
  };
}
