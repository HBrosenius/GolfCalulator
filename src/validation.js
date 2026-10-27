(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfValidation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isJoinCode(value) {
    return typeof value === 'string' && /^[A-HJ-KM-NP-Z2-9]{20}$/.test(value.toUpperCase());
  }

  function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  function isPhotoDataUrl(value) {
    return typeof value === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOnlyKeys(value, allowed) {
    return isObject(value) && Object.keys(value).every(key => allowed.has(key));
  }

  function isText(value, max, allowEmpty = false) {
    return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) &&
      (allowEmpty || value.trim().length > 0);
  }

  function isNumber(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  }

  function isInteger(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function optional(value, check) { return value === undefined || value === null || check(value); }

  function isCourse(course) {
    const keys = new Set(['id', 'name', 'tee', 'holes', 'slope', 'cr', 'par', 'hpar', 'si',
      'ratingCategory', 'catalogTee', 'catalogId', 'catalogVersion', 'catalogUpdatedAt',
      'catalogSource', 'catalogVerifiedAt', 'catalogVerificationStatus']);
    const sourceOk = optional(course.catalogSource, source => hasOnlyKeys(source, new Set(['url', 'title'])) &&
      isText(source.url, 500) && /^https?:\/\//.test(source.url) && isText(source.title, 120));
    return optional(course.id, value => isText(value, 80)) && hasOnlyKeys(course, keys) && isText(course.name, 80) && isText(course.tee, 50) &&
      (course.holes === 9 || course.holes === 18) && isNumber(course.slope, 55, 155) &&
      isNumber(course.cr, 25, 85) && isInteger(course.par, 27, 90) &&
      Array.isArray(course.hpar) && course.hpar.length === course.holes && course.hpar.every(value => isInteger(value, 3, 6)) &&
      Array.isArray(course.si) && course.si.length === course.holes && course.si.every(value => isInteger(value, 1, 18)) &&
      new Set(course.si).size === course.si.length &&
      optional(course.ratingCategory, value => ['all', 'men', 'women'].includes(value)) &&
      optional(course.catalogTee, value => isText(value, 24)) &&
      optional(course.catalogId, value => isText(value, 80) && /^[a-z0-9-]+$/.test(value)) &&
      optional(course.catalogVersion, value => isInteger(value, 1, Number.MAX_SAFE_INTEGER)) &&
      optional(course.catalogUpdatedAt, value => isInteger(value, 1, Number.MAX_SAFE_INTEGER)) && sourceOk &&
      optional(course.catalogVerifiedAt, value => isInteger(value, 1, Number.MAX_SAFE_INTEGER)) &&
      optional(course.catalogVerificationStatus, value => ['verified', 'needs-review', 'legacy'].includes(value));
  }

  function isPlayer(player) {
    const keys = new Set(['id', 'name', 'lastName', 'hi', 'nick', 'photo']);
    return hasOnlyKeys(player, keys) && isInteger(player.id, 1, Number.MAX_SAFE_INTEGER) &&
      isText(player.name, 50) && optional(player.lastName, value => isText(value, 50)) &&
      optional(player.nick, value => isText(value, 50)) && isNumber(player.hi, -10, 54) &&
      optional(player.photo, isPhotoDataUrl);
  }

  function isMarker(marker, holes) {
    return hasOnlyKeys(marker, new Set(['hole', 'player'])) &&
      (marker.hole === null || isInteger(marker.hole, 0, holes - 1)) && isText(marker.player, 50, true);
  }

  function isMarkers(markers, holes) {
    return hasOnlyKeys(markers, new Set(['ctp', 'ld', 'assigned'])) && isMarker(markers.ctp, holes) &&
      isMarker(markers.ld, holes) && optional(markers.assigned, value => typeof value === 'boolean');
  }

  function isResultRow(row, holes) {
    const keys = new Set(['h', 'par', 'si', 'strokes', 'score', 'netto', 'pts', 'skipped', 'teeShotBy', 'countsForTeam']);
    return hasOnlyKeys(row, keys) && isInteger(row.h, 1, holes) && isInteger(row.par, 3, 6) &&
      isInteger(row.si, 1, 18) && isInteger(row.strokes, -20, 20) && typeof row.skipped === 'boolean' &&
      optional(row.teeShotBy, value => isText(value, 50)) &&
      optional(row.countsForTeam, value => typeof value === 'boolean') &&
      (row.skipped
        ? (row.score === '–' || row.score === null) && (row.netto === '–' || row.netto === null) && row.pts === 0
        : isInteger(row.score, 1, 20) && isInteger(row.netto, -20, 40) && isInteger(row.pts, 0, 8));
  }

  function isSubject(subject, holes) {
    const keys = new Set([
      'playerId', 'memberId', 'name', 'hi', 'ph', 'tee', 'slope', 'cr', 'par', 'totalPoints',
      'totalBrutto', 'members', 'memberIds', 'teamId', 'teammate', 'rows',
    ]);
    return hasOnlyKeys(subject, keys) && optional(subject.playerId, value => isInteger(value, 1, Number.MAX_SAFE_INTEGER)) &&
      optional(subject.memberId, value => isText(value, 80)) && isText(subject.name, 80) &&
      optional(subject.hi, value => isNumber(value, -10, 54)) && isInteger(subject.ph, -20, 72) &&
      optional(subject.tee, value => isText(value, 50)) && optional(subject.slope, value => isNumber(value, 55, 155)) &&
      optional(subject.cr, value => isNumber(value, 25, 85)) && optional(subject.par, value => isInteger(value, 27, 90)) &&
      isInteger(subject.totalPoints, 0, holes * 8) && isInteger(subject.totalBrutto, 0, holes * 20) &&
      optional(subject.members, value => Array.isArray(value) && value.length <= 12 && value.every(name => isText(name, 50))) &&
      optional(subject.memberIds, value => Array.isArray(value) && value.length <= 12 &&
        value.every(id => id === null || isInteger(id, 1, Number.MAX_SAFE_INTEGER))) &&
      optional(subject.teamId, value => isText(value, 30)) && optional(subject.teammate, value => isText(value, 50)) &&
      Array.isArray(subject.rows) && subject.rows.length === holes && subject.rows.every(row => isResultRow(row, holes));
  }

  function isBet(bet, holes) {
    const keys = new Set([
      'id', 'hole', 'amount', 'proposerSeat', 'createdAt', 'resolvedAt', 'status', 'cancelReason', 'responses',
    ]);
    return hasOnlyKeys(bet, keys) && isText(bet.id, 80) && isInteger(bet.hole, 0, holes - 1) &&
      isInteger(bet.amount, 1, 10000) && isInteger(bet.proposerSeat, 0, 11) &&
      isInteger(bet.createdAt, 0, Number.MAX_SAFE_INTEGER) && optional(bet.resolvedAt, value => isInteger(value, 0, Number.MAX_SAFE_INTEGER)) &&
      ['pending', 'locked', 'cancelled'].includes(bet.status) && optional(bet.cancelReason, value => isText(value, 30)) &&
      isObject(bet.responses) && Object.keys(bet.responses).every(key => /^\d{1,2}$/.test(key) &&
        ['pending', 'accepted', 'declined'].includes(bet.responses[key]));
  }

  function isTourRef(value) {
    return hasOnlyKeys(value, new Set(['code', 'syncStatus', 'submissionId'])) &&
      /^[A-HJ-KM-NP-Z2-9]{8}$/.test(value.code) &&
      optional(value.syncStatus, status => ['pending', 'synced'].includes(status)) &&
      optional(value.submissionId, id => isText(id, 80));
  }

  function isRound(round) {
    const keys = new Set([
      'schemaVersion', 'id', 'date', 'courseName', 'tee', 'mixedTees', 'holes', 'slope', 'cr', 'par',
      'gameMode', 'note', 'weather', 'markers', 'minTeeShots', 'bets', 'liveRoomCode', 'tourRef', 'subjects',
    ]);
    return hasOnlyKeys(round, keys) && optional(round.schemaVersion, value => value === 1 || value === 2) &&
      optional(round.minTeeShots, value => isInteger(value, 0, 18)) &&
      (isInteger(round.id, 1, Number.MAX_SAFE_INTEGER) || (typeof round.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(round.id))) && isDate(round.date) && isText(round.courseName, 80) &&
      isText(round.tee, 50) && optional(round.mixedTees, value => typeof value === 'boolean') &&
      (round.holes === 9 || round.holes === 18) && isNumber(round.slope, 55, 155) && isNumber(round.cr, 25, 85) &&
      isInteger(round.par, 27, 90) && ['individual', 'scramble', 'fourball', 'foursome', 'match'].includes(round.gameMode) &&
      optional(round.note, value => isText(value, 120, true)) && optional(round.weather, value => ['sun', 'cloud', 'rain', 'wind'].includes(value)) &&
      optional(round.markers, value => isMarkers(value, round.holes)) &&
      optional(round.bets, value => Array.isArray(value) && value.length <= round.holes && value.every(bet => isBet(bet, round.holes))) &&
      optional(round.liveRoomCode, value => /^[A-HJ-KM-NP-Z2-9]{4}$/.test(value) || /^[A-HJ-KM-NP-Z2-9]{20}$/.test(value)) && optional(round.tourRef, isTourRef) &&
      Array.isArray(round.subjects) && round.subjects.length >= 1 && round.subjects.length <= 12 &&
      round.subjects.every(subject => isSubject(subject, round.holes));
  }

  function isLocalTour(tour) {
    const keys = new Set(['id', 'name', 'startDate', 'endDate', 'status', 'bestOfN',
      'duplicateCourseRule', 'roster', 'courses', 'sharedCode']);
    return hasOnlyKeys(tour, keys) && isInteger(tour.id, 1, Number.MAX_SAFE_INTEGER) &&
      isText(tour.name, 120) && isDate(tour.startDate) && isDate(tour.endDate) && tour.startDate <= tour.endDate &&
      ['open', 'completed', 'cancelled'].includes(tour.status) &&
      optional(tour.bestOfN, value => isInteger(value, 1, Number.MAX_SAFE_INTEGER)) &&
      optional(tour.duplicateCourseRule, value => ['best', 'first'].includes(value)) &&
      optional(tour.sharedCode, value => typeof value === 'string' && /^[A-HJ-KM-NP-Z2-9]{8}$/.test(value)) &&
      Array.isArray(tour.roster) && tour.roster.length <= 500 &&
      tour.roster.every(id => isInteger(id, 1, Number.MAX_SAFE_INTEGER)) &&
      Array.isArray(tour.courses) && tour.courses.length <= 500 && tour.courses.every(course =>
        (typeof course === 'string' && isText(course, 80)) ||
        (hasOnlyKeys(course, new Set(['name', 'maxRounds', 'holes'])) && isText(course.name, 80) &&
          optional(course.maxRounds, value => isInteger(value, 1, Number.MAX_SAFE_INTEGER)) &&
          optional(course.holes, value => value === 9 || value === 18)));
  }

  function isRoundSetup(setup) {
    const keys = new Set(['id', 'name', 'createdAt', 'updatedAt', 'courses', 'players', 'gameMode', 'minTeeShots']);
    if (!hasOnlyKeys(setup, keys) || !isText(setup.id, 80) || !isText(setup.name, 80) ||
      !isInteger(setup.createdAt, 1, Number.MAX_SAFE_INTEGER) || !isInteger(setup.updatedAt, 1, Number.MAX_SAFE_INTEGER) ||
      !['individual', 'match', 'scramble', 'fourball', 'foursome'].includes(setup.gameMode) ||
      !Array.isArray(setup.courses) || !setup.courses.length || setup.courses.length > 12 || !setup.courses.every(isCourse) ||
      !Array.isArray(setup.players) || !setup.players.length || setup.players.length > 4 ||
      !optional(setup.minTeeShots, value => isInteger(value, 0, 18))) return false;
    const course = setup.courses[0];
    if (setup.courses.some(item => item.name !== course.name || item.holes !== course.holes) ||
      new Set(setup.courses.map(item => item.tee)).size !== setup.courses.length) return false;
    if (!setup.players.every(player => hasOnlyKeys(player, new Set(['playerId', 'name', 'hi', 'tee', 'team'])) &&
      optional(player.playerId, id => isInteger(id, 1, Number.MAX_SAFE_INTEGER)) && isText(player.name, 50) &&
      optional(player.hi, hi => isNumber(hi, -10, 54)) && setup.courses.some(item => item.tee === player.tee) &&
      ['A', 'B'].includes(player.team))) return false;
    if (new Set(setup.players.map(player => player.name.trim().toLocaleLowerCase('sv-SE'))).size !== setup.players.length) return false;
    const ids = setup.players.filter(player => player.playerId != null).map(player => player.playerId);
    if (new Set(ids).size !== ids.length) return false;
    if (['scramble', 'foursome'].includes(setup.gameMode) && setup.players.some(player => player.tee !== course.tee)) return false;
    if (setup.gameMode === 'match' && setup.players.length !== 2) return false;
    if (setup.gameMode === 'fourball' && setup.players.length !== 4) return false;
    if (['scramble', 'foursome'].includes(setup.gameMode) &&
      !(setup.players.length === 4 || (setup.gameMode === 'scramble' && setup.players.length === 2))) return false;
    if (['scramble', 'foursome', 'fourball'].includes(setup.gameMode) && setup.players.length === 4 &&
      setup.players.filter(player => player.team === 'A').length !== 2) return false;
    return true;
  }

  function isBackupPayload(value) {
    const keys = new Set(['version', 'exportedAt', 'courses', 'rounds', 'players', 'playerDeletions', 'courseDeletions', 'setups', 'setupDeletions', ...(value?.version === 2 ? ['tours'] : [])]);
    return optional(value?.setups, items => Array.isArray(items) && items.length <= 100 && items.every(isRoundSetup)) && ['playerDeletions', 'courseDeletions', 'setupDeletions'].every(key => optional(value?.[key], entries => Array.isArray(entries) && entries.length <= 5000 && entries.every(item => hasOnlyKeys(item, new Set(['id', 'deletedAt'])) && isText(item.id, 128) && isInteger(item.deletedAt, 1, Number.MAX_SAFE_INTEGER)))) && hasOnlyKeys(value, keys) && (value.version === 1 || value.version === 2) &&
      (value.version === 1 || (Array.isArray(value.tours) && value.tours.length <= 500 && value.tours.every(isLocalTour))) && optional(value.exportedAt, date => {
      if (!isText(date, 40)) return false;
      const parsed = new Date(date);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === date;
    }) && Array.isArray(value.courses) && value.courses.length <= 500 && value.courses.every(isCourse) &&
      Array.isArray(value.rounds) && value.rounds.length <= 5000 && value.rounds.every(isRound) &&
      Array.isArray(value.players) && value.players.length <= 500 && value.players.every(isPlayer);
  }

  return Object.freeze({ isBackupPayload, isRoundSetup, isJoinCode, isPhotoDataUrl, isPositiveInteger });
}));
