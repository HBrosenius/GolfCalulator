(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfCompetition = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function config(tour) { return { format: 'stableford', tieBreak: 'handicap', ...(tour?.rulesSnapshot?.competition || tour?.competition || {}) }; }
  function isLegacy(tour) { const value = config(tour); return value.format === 'stableford' && value.tieBreak === 'handicap'; }
  function validate(value, tour) {
    if (value !== undefined && (!value || Array.isArray(value) || Object.keys(value).some(key => !['format', 'tieBreak'].includes(key)) || !['stableford', 'gross', 'net'].includes(value.format) || !['handicap', 'shared', 'best_round'].includes(value.tieBreak))) return 'Invalid competition settings';
    const rules = config({ competition: value });
    if (rules.format !== 'stableford') {
      if (!Number.isInteger(tour.bestOfN) || tour.bestOfN < 1) return 'Slagspel kräver ett fast antal räknade rundor.';
      if (new Set(tour.courses.map(course => course.holes)).size !== 1) return 'Alla banor måste ha samma antal hål i slagspel.';
      if (tour.bestOfN > tour.courses.reduce((sum, course) => sum + (course.maxRounds || 1), 0)) return 'Antalet räknade rundor överstiger banornas gränser.';
    }
    return null;
  }
  function complete(subject, holes) {
    return Array.isArray(subject?.rows) && subject.rows.length === holes && subject.rows.every(row => !row.skipped && Number.isInteger(row.score) && row.score >= 1 && Number.isFinite(row.strokes));
  }
  function metric(subject, format = 'stableford', holes) {
    if (format === 'stableford') return Number.isFinite(subject?.totalPoints) ? subject.totalPoints : (subject?.rows || []).reduce((sum, row) => sum + (Number.isFinite(row?.pts) ? row.pts : 0), 0);
    if (!complete(subject, holes)) return null;
    return subject.rows.reduce((sum, row) => sum + row.score - (format === 'net' ? row.strokes : 0), 0);
  }
  function snapshot(tour) {
    return { competition: config(tour), bestOfN: tour.bestOfN, duplicateCourseRule: tour.duplicateCourseRule || 'best',
      courseLimits: tour.courses.map(course => ({ courseId: course.id, maxRounds: course.maxRounds || 1 })), rulesRevision: tour.rulesRevision || 1 };
  }
  function standings(tour, eligible, roster, matches) {
    const rules = config(tour), direction = rules.format === 'stableford' ? -1 : 1;
    const compare = (a, b) => direction * (a.points - b.points) || a.date.localeCompare(b.date);
    const rows = roster.map(player => {
      const results = [];
      eligible.forEach(round => (round.subjects || []).filter(subject => matches(subject, player)).forEach(subject => {
        if (rules.format !== 'stableford' && round.gameMode !== 'individual') return;
        const points = metric(subject, rules.format, round.holes); if (points === null) return;
        results.push({ roundId: round.id, date: round.date, courseName: round.courseName, holes: round.holes, points, counted: false, reason: 'course_limit' });
      }));
      const byCourse = new Map(); results.forEach(result => { const key = `${result.courseName}\u0000${result.holes == null ? '' : result.holes}`; if (!byCourse.has(key)) byCourse.set(key, []); byCourse.get(key).push(result); });
      const candidates = [];
      byCourse.forEach(list => {
        const course = tour.courses.find(item => item.name === list[0].courseName && (item.holes == null || item.holes === list[0].holes));
        const sorted = list.slice().sort((a,b) => tour.duplicateCourseRule === 'first' ? a.date.localeCompare(b.date) : compare(a,b));
        candidates.push(...sorted.slice(0, course?.maxRounds > 0 ? course.maxRounds : 1));
      });
      candidates.sort(compare); const count = tour.bestOfN ? Math.min(tour.bestOfN, candidates.length) : candidates.length;
      candidates.forEach((result, i) => { result.counted = i < count; result.reason = i < count ? 'counted' : 'best_of_limit'; });
      const counted = candidates.slice(0, count), requiredRounds = rules.format === 'stableford' ? 0 : tour.bestOfN;
      return { player, total: counted.reduce((sum, result) => sum + result.points, 0), roundsPlayed: results.length, roundsCounted: count,
        tieBreak: rules.tieBreak, requiredRounds, complete: !requiredRounds || count >= requiredRounds, format: rules.format, results, counted, position: null, tied: false };
    }).filter(row => row.roundsPlayed > 0);
    const tie = (a,b) => {
      if (rules.tieBreak === 'handicap') return (a.player.hi || 0) - (b.player.hi || 0);
      if (rules.tieBreak === 'best_round') {
        for (let i = 0; i < Math.max(a.counted.length, b.counted.length); i++) {
          if (!a.counted[i] || !b.counted[i]) return !a.counted[i] ? 1 : -1;
          const delta = direction * (a.counted[i].points - b.counted[i].points); if (delta) return delta;
        }
      }
      return 0;
    };
    const rankCompare = (a,b) => direction * (a.total - b.total) || tie(a,b);
    rows.sort((a,b) => Number(b.complete) - Number(a.complete) || (!a.complete ? b.roundsCounted - a.roundsCounted : 0) || rankCompare(a,b));
    rows.forEach((row, index) => {
      if (!row.complete) return;
      row.position = rules.tieBreak !== 'handicap' && index && rows[index-1].complete && rankCompare(rows[index-1], row) === 0 ? rows[index-1].position : index + 1;
    });
    rows.forEach(row => { row.tied = row.position !== null && rows.filter(other => other.position === row.position).length > 1; });
    return rows;
  }
  const formatName = format => ({ stableford: 'Poängbogey', gross: 'Bruttoslagspel', net: 'Nettoslagspel' })[format] || 'Poängbogey';
  const tieName = tie => ({ handicap: 'Lägre handicapindex, sedan tourens spelarordning', shared: 'Delad placering vid samma total', best_round: 'Bästa räknade runda, sedan nästa; därefter delad plats' })[tie] || '';
  return Object.freeze({ config, isLegacy, validate, complete, metric, snapshot, standings, formatName, tieName });
}));
