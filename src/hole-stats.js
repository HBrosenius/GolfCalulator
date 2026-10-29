(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfHoleStats = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const keys = ['putts', 'fairway', 'gir', 'penalties'];
  function valid(value, par, score) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return false;
    const number = (key, max) => value[key] == null || (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= max);
    if (!number('putts', 10) || !number('penalties', 20) || (value.gir != null && typeof value.gir !== 'boolean') ||
      (value.fairway != null && !['hit','left','right','miss','na'].includes(value.fairway))) return false;
    if (par === 3 && value.fairway != null && value.fairway !== 'na') return false;
    return !Number.isInteger(score) || score <= 0 || (value.putts || 0) + (value.penalties || 0) <= score;
  }
  function clean(value) {
    return Object.fromEntries(keys.filter(key => value?.[key] != null).map(key => [key, value[key]]));
  }
  function summarize(rows) {
    const played = (rows || []).filter(row => !row.skipped && Number.isInteger(row.score) && row.score > 0 && valid(row.stats || {}, row.par, row.score));
    const withField = field => played.filter(row => row.stats?.[field] != null);
    const putts = withField('putts'), penalties = withField('penalties'), gir = withField('gir');
    const fairways = withField('fairway').filter(row => row.par !== 3 && row.stats.fairway !== 'na');
    const sum = (list, field) => list.reduce((total, row) => total + row.stats[field], 0);
    return {
      recorded: played.filter(row => Object.keys(clean(row.stats)).length).length,
      putts: { count: putts.length, total: sum(putts,'putts'), threePutts: putts.filter(row => row.stats.putts >= 3).length },
      penalties: { count: penalties.length, total: sum(penalties,'penalties') },
      gir: { count: gir.length, hits: gir.filter(row => row.stats.gir).length },
      fairway: { count: fairways.length, hits: fairways.filter(row => row.stats.fairway === 'hit').length,
        left: fairways.filter(row => row.stats.fairway === 'left').length, right: fairways.filter(row => row.stats.fairway === 'right').length,
        other: fairways.filter(row => row.stats.fairway === 'miss').length },
    };
  }
  return { valid, clean, summarize };
}));
