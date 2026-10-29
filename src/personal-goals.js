(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./course-insights.js') : root.GolfCourseInsights, node ? require('./hole-stats.js') : root.GolfHoleStats);
  if (node) module.exports = api;
  root.GolfPersonalGoals = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Insights, Stats) {
  'use strict';
  function eligible(rounds, player, from, to, kind, today) {
    return Insights.entries(rounds, player).filter(entry => entry.kind === kind && entry.round.date >= from && entry.round.date <= to && (!today || entry.round.date <= today) &&
      !['withdrawn','disqualified'].includes(entry.round.tourRef?.resultStatus) && entry.round.tourRef?.approvalStatus !== 'provisional');
  }
  function progress(goal, rounds, player, today) {
    const matches = eligible(rounds, player, goal.startDate, goal.endDate, goal.roundKind, today).filter(entry => entry.complete && (!goal.holes || entry.round.holes === goal.holes) && (goal.type === 'rounds' || entry.key === goal.courseKey));
    const best = matches.length ? Math.min(...matches.map(entry => entry.rows.reduce((sum,row) => sum + row.score, 0))) : null;
    const achieved = goal.type === 'rounds' ? matches.length >= goal.target : best != null && best <= goal.target;
    return { current: goal.type === 'rounds' ? matches.length : best, matches: matches.length, achieved,
      status: today && today < goal.startDate ? 'future' : achieved ? 'achieved' : today && today > goal.endDate ? 'ended' : 'active' };
  }
  function recap(rounds, player, from, to, kind, today) {
    const entries = eligible(rounds, player, from, to, kind, today), complete = entries.filter(entry => entry.complete), groups = new Map();
    complete.forEach(entry => {
      const gross = entry.rows.reduce((sum,row) => sum + row.score,0), previous = groups.get(entry.key);
      if (!previous || gross < previous.gross) groups.set(entry.key, {key:entry.key, courseName:entry.round.courseName, tee:entry.tee, holes:entry.round.holes, gross, date:entry.round.date});
    });
    const bests=[...groups.values()].sort((a,b) => a.courseName.localeCompare(b.courseName,'sv') || a.tee.localeCompare(b.tee,'sv') || a.holes-b.holes || a.key.localeCompare(b.key));
    const versions=new Map();bests.forEach(item=>{const base=JSON.stringify([String(item.courseName).trim().toLocaleLowerCase('sv'),item.tee,item.holes]);item.version=(versions.get(base)||0)+1;versions.set(base,item.version);});
    return { count:complete.length, nine:complete.filter(entry => entry.round.holes === 9).length, eighteen:complete.filter(entry => entry.round.holes === 18).length,
      courses:new Set(complete.map(entry => String(entry.round.courseName).trim().toLocaleLowerCase('sv'))).size, incomplete:entries.length-complete.length,
      stats:Stats.summarize(complete.flatMap(entry => entry.rows)),
      bests };
  }
  return { progress, recap };
}));
