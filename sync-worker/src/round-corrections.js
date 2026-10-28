import '../../src/scoring.js';
const Scoring = globalThis.GolfScoring;

// Submitted rows carry the frozen par, stroke index and strokes received. Never
// use today's member handicap or course rating to correct a historical result.
export function correctRound(round, changes = []) {
  if (!Array.isArray(changes) || changes.length > round.subjects.length * round.holes) throw new Error('Invalid hole corrections');
  const next = structuredClone(round), targets = new Map();
  const shared = ['scramble', 'foursome'].includes(round.gameMode);
  for (const change of changes) {
    if (!change || Object.keys(change).some(key => !['memberId', 'hole', 'score'].includes(key)) ||
      !Number.isInteger(change.hole) || change.hole < 1 || change.hole > round.holes ||
      !(change.score === null || (Number.isInteger(change.score) && change.score >= 1 && change.score <= 20))) throw new Error('Invalid hole correction');
    const subject = next.subjects.find(item => item.memberId === change.memberId);
    if (!subject) throw new Error('Unknown round member');
    const affected = shared ? next.subjects.filter(item => item.teamId === subject.teamId) : [subject];
    for (const player of affected) {
      const key = `${player.memberId}:${change.hole}`;
      if (targets.has(key) && targets.get(key) !== change.score) throw new Error('Conflicting shared team corrections');
      targets.set(key, change.score);
      const row = player.rows[change.hole - 1];
      row.skipped = change.score === null;
      row.score = row.skipped ? '–' : change.score;
      row.netto = row.skipped ? '–' : row.score - row.strokes;
      row.pts = row.skipped ? 0 : Scoring.calculateStablefordPoints(row.score, row.par, row.strokes);
    }
  }
  for (const subject of next.subjects) {
    subject.totalPoints = subject.rows.reduce((sum, row) => sum + row.pts, 0);
    subject.totalBrutto = subject.rows.reduce((sum, row) => sum + (row.skipped ? 0 : row.score), 0);
  }
  if (next.gameMode === 'fourball') {
    for (const teamId of new Set(next.subjects.map(item => item.teamId))) {
      const team = next.subjects.filter(item => item.teamId === teamId);
      const points = Scoring.calculateFourballTeamPoints(team.map(item => item.rows.map(row => row.pts)));
      team.forEach(item => { item.totalPoints = points; });
    }
  }
  return next;
}

export function correctionEvidence(before, after) {
  const evidence = round => ({ playedDate: round.playedDate, approvalStatus: round.approvalStatus || 'confirmed', resultStatus: round.resultStatus || 'active', subjects: round.subjects.map((subject, i) => ({
    memberId: subject.memberId, name: subject.name, totalPoints: subject.totalPoints, totalBrutto: subject.totalBrutto,
    rows: subject.rows.filter((row, h) => JSON.stringify(before.subjects[i].rows[h]) !== JSON.stringify(after.subjects[i].rows[h])),
  })) });
  return { before: evidence(before), after: evidence(after) };
}
