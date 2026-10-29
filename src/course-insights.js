(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./storage.js') : root.GolfStorage, typeof module === 'object' && module.exports ? require('./hole-stats.js') : root.GolfHoleStats);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfCourseInsights = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Storage, Stats) {
  'use strict';
  const scored = row => row && !row.skipped && Number.isInteger(row.score) && row.score > 0 && Number.isInteger(row.par) && row.par >= 3 && row.par <= 6;
  function entries(rounds, player) {
    return (rounds || []).flatMap(round => {
      if ((round.gameMode || 'individual') !== 'individual' || ['draft', 'in_progress'].includes(round.lifecycle) || ![9, 18].includes(round.holes)) return [];
      const subjects = (round.subjects || []).filter(subject => Storage.subjectMatchesPlayer(subject, player));
      if (subjects.length !== 1) return [];
      const subject = subjects[0], rows = subject.rows;
      // A changed hole layout or rating is a separate comparison, even with the same course name.
      if (!Array.isArray(rows) || rows.length !== round.holes || !rows.every((row, i) => row && (row.h ?? i + 1) === i + 1 && Number.isInteger(row.par) && row.par >= 3 && row.par <= 6)) return [];
      const tee = subject.tee || round.tee || 'Okänd tee';
      const slope = subject.slope ?? round.slope ?? null, cr = subject.cr ?? round.cr ?? null;
      const key = JSON.stringify([String(round.courseName || '').trim().toLocaleLowerCase('sv'), tee, round.holes, slope, cr, rows.map(row => row.par), ...(rows.some((row,i)=>(row.courseHole??i+1)!==i+1) ? [rows.map(row=>row.courseHole??row.h)] : [])]);
      const complete = rows.every(scored);
      return [{ round, subject, key, tee, slope, cr, complete, rows: rows.filter(scored), kind: round.roundKind === 'practice' ? 'practice' : 'competitive' }];
    });
  }
  function groups(rounds, player) {
    const map = new Map();
    entries(rounds, player).forEach(entry => {
      if (!map.has(entry.key)) map.set(entry.key, { key: entry.key, courseName: entry.round.courseName || 'Okänd bana', tee: entry.tee, holes: entry.round.holes, slope: entry.slope, cr: entry.cr, count: 0 });
      map.get(entry.key).count++;
    });
    return [...map.values()].sort((a, b) => a.courseName.localeCompare(b.courseName, 'sv') || a.holes - b.holes || a.tee.localeCompare(b.tee, 'sv') || a.key.localeCompare(b.key));
  }
  function summarize(rounds, player, options = {}) {
    const selected = entries(rounds, player).filter(entry => entry.key === options.key && entry.kind === (options.kind || 'competitive') && entry.complete === (options.completion !== 'incomplete') && (!options.from || entry.round.date >= options.from) && (!options.to || entry.round.date <= options.to))
      .sort((a, b) => String(b.round.date).localeCompare(String(a.round.date)) || String(b.round.id).localeCompare(String(a.round.id)));
    const aggregate = rows => ({ count: rows.length, average: rows.length ? rows.reduce((sum, row) => sum + row.score - row.par, 0) / rows.length : null });
    const holeCount = selected[0]?.round.holes || 0;
    const holes = Array.from({ length: holeCount }, (_, i) => ({ hole: selected[0]?.subject.rows[i]?.courseHole || i + 1, ...aggregate(selected.flatMap(entry => { const row = entry.subject.rows[i]; return scored(row) ? [row] : []; })) }));
    const ranked = holes.filter(hole => hole.count > 0).sort((a, b) => a.average - b.average || a.hole - b.hole);
    return {
      stats: Stats.summarize(selected.flatMap(entry => entry.subject.rows)),
      count: selected.length, scoredHoles: selected.reduce((sum, entry) => sum + entry.rows.length, 0), holes,
      strongest: ranked.length ? ranked.filter(hole => hole.average === ranked[0].average) : [],
      toughest: ranked.length ? ranked.filter(hole => hole.average === ranked[ranked.length - 1].average) : [],
      splits: [0, 9].filter(start => start < holeCount).map(start => ({ label: `Hål ${selected[0]?.subject.rows[start]?.courseHole || start+1}–${selected[0]?.subject.rows[Math.min(start+8,holeCount-1)]?.courseHole || Math.min(start+9,holeCount)}`, ...aggregate(selected.flatMap(entry => entry.subject.rows.slice(start, start + 9).filter(scored))) })),
      pars: [3, 4, 5, 6].map(par => ({ par, ...aggregate(selected.flatMap(entry => entry.rows.filter(row => row.par === par))) })).filter(item => item.count),
      recent: selected.slice(0, 5).map(entry => ({ id: entry.round.id, date: entry.round.date, complete: entry.complete, holes: entry.rows.length, gross: entry.rows.reduce((sum, row) => sum + row.score, 0), toPar: entry.rows.reduce((sum, row) => sum + row.score - row.par, 0) })),
    };
  }
  return { groups, summarize, entries };
}));
