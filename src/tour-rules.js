(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfTourRules = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHARED_TOUR_SCHEMA_VERSION = 1;
  const LIVE_PROTOCOL_VERSION = 2;
  const EXCLUDED_GAME_MODES = new Set(['scramble', 'foursome']);

  function subjectMatchesPlayer(subject, player) {
    if (!subject || !player) return false;
    if (subject.playerId != null) return subject.playerId === player.id;
    const names = new Set([player.name, player.nick].filter(Boolean));
    return names.has(subject.name);
  }

  function rosterPlayers(tour, players) {
    const ids = new Set(Array.isArray(tour?.roster) ? tour.roster : []);
    return (players || []).filter(player => ids.has(player.id));
  }

  function courseMatches(course, round) {
    return course && round && course.name === round.courseName && (course.holes == null || course.holes === round.holes);
  }

  function matchingRounds(tour, rounds, players) {
    if (!tour || !Array.isArray(tour.courses)) return [];
    const roster = rosterPlayers(tour, players);
    return (rounds || []).filter(round =>
      tour.courses.some(course => courseMatches(course, round)) &&
      round.date >= tour.startDate && round.date <= tour.endDate &&
      !EXCLUDED_GAME_MODES.has(round.gameMode) &&
      roster.some(player => (round.subjects || []).some(subject => subjectMatchesPlayer(subject, player)))
    );
  }

  function computeStandings(tour, rounds, players) {
    const roster = rosterPlayers(tour, players);
    const eligible = matchingRounds(tour, rounds, players);
    const perPlayer = new Map(roster.map(player => [player.id, []]));
    eligible.forEach(round => {
      (round.subjects || []).forEach(subject => {
        const player = roster.find(candidate => subjectMatchesPlayer(subject, candidate));
        if (player) perPlayer.get(player.id).push({
          points: subject.totalPoints,
          date: round.date,
          courseName: round.courseName,
          holes: round.holes,
          roundId: round.id,
        });
      });
    });

    const duplicateRule = tour.duplicateCourseRule || 'best';
    const maxRounds = result => {
      const course = tour.courses.find(candidate => courseMatches(candidate, {
        courseName: result.courseName,
        holes: result.holes,
      }));
      return course && course.maxRounds > 0 ? course.maxRounds : 1;
    };
    const courseKey = result => `${result.courseName}\u0000${result.holes == null ? '' : result.holes}`;

    const rows = roster.map(player => {
      const results = perPlayer.get(player.id);
      const byCourse = new Map();
      results.forEach(result => {
        const key = courseKey(result);
        if (!byCourse.has(key)) byCourse.set(key, []);
        byCourse.get(key).push(result);
      });
      const eligibleForBestOf = [];
      byCourse.forEach(list => {
        const sorted = list.slice().sort((a, b) => duplicateRule === 'first'
          ? a.date.localeCompare(b.date)
          : b.points - a.points || a.date.localeCompare(b.date));
        eligibleForBestOf.push(...sorted.slice(0, maxRounds(list[0])));
      });
      eligibleForBestOf.sort((a, b) => b.points - a.points || a.date.localeCompare(b.date));
      const count = tour.bestOfN ? Math.min(tour.bestOfN, eligibleForBestOf.length) : eligibleForBestOf.length;
      const counted = eligibleForBestOf.slice(0, count);
      return {
        player,
        total: counted.reduce((sum, result) => sum + result.points, 0),
        roundsPlayed: results.length,
        roundsCounted: counted.length,
      };
    }).filter(row => row.roundsPlayed > 0);

    rows.sort((a, b) => b.total - a.total || (a.player.hi || 0) - (b.player.hi || 0));
    return rows;
  }

  function buildSharedTourCreate(tour, players, courseEntries) {
    const roster = rosterPlayers(tour, players);
    if (roster.length !== (tour.roster || []).length) throw new Error('Tour roster contains an unknown player');
    const courses = (tour.courses || []).map(course => {
      const tees = (courseEntries || []).filter(entry =>
        entry.name === course.name && (course.holes == null || entry.holes === course.holes));
      if (!tees.length) throw new Error(`Tour course has no saved tee: ${course.name}`);
      const holes = course.holes || tees[0].holes;
      return {
        name: course.name,
        holes,
        maxRounds: course.maxRounds > 0 ? course.maxRounds : 1,
        tees: tees.map(entry => ({
          name: entry.tee,
          slope: entry.slope,
          cr: entry.cr,
          par: entry.par,
          hpar: [...entry.hpar],
          si: [...entry.si],
        })),
      };
    });
    return {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      schemaVersion: SHARED_TOUR_SCHEMA_VERSION,
      name: tour.name,
      startDate: tour.startDate,
      endDate: tour.endDate,
      bestOfN: tour.bestOfN || null,
      duplicateCourseRule: tour.duplicateCourseRule || 'best',
      members: roster.map(player => ({ name: player.nick || player.name, hi: player.hi })),
      courses,
    };
  }

  function buildRoundSubmission(round, sharedRecord) {
    if (!round || !sharedRecord?.tour) throw new Error('Shared tour context is required');
    if (EXCLUDED_GAME_MODES.has(round.gameMode)) throw new Error('Shared-score rounds cannot be submitted to a tour');
    const course = sharedRecord.tour.courses.find(item => item.name === round.courseName && item.holes === round.holes);
    if (!course) throw new Error('Round course is not in the shared tour');
    const links = sharedRecord.memberLinks || {};
    const subjects = (round.subjects || []).map(subject => {
      const memberId = links[subject.playerId];
      if (!memberId) return null;
      const teeName = subject.tee || round.tee;
      if (!course.tees.some(tee => tee.name === teeName)) throw new Error(`Round tee is not in the shared tour: ${teeName}`);
      return {
        memberId,
        teeName,
        totalPoints: subject.totalPoints,
        totalBrutto: subject.totalBrutto,
        teamId: subject.teamId || null,
        rows: subject.rows.map(row => ({
          h: row.h, par: row.par, si: row.si, strokes: row.strokes,
          score: row.score, netto: row.netto, pts: row.pts, skipped: !!row.skipped,
        })),
      };
    }).filter(Boolean);
    if (!subjects.length) throw new Error('Round contains no linked tour members');
    return {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      schemaVersion: SHARED_TOUR_SCHEMA_VERSION,
      clientRoundId: String(round.id),
      playedDate: round.date,
      courseId: course.id,
      gameMode: round.gameMode,
      subjects,
      ...(round.liveRoomCode ? { liveRoomCode: round.liveRoomCode } : {}),
    };
  }

  function computeSharedStandings(sharedTour) {
    const players = (sharedTour?.members || []).map(member => ({ id: member.id, name: member.name, hi: member.hi }));
    const localTour = {
      roster: players.map(player => player.id),
      startDate: sharedTour.startDate,
      endDate: sharedTour.endDate,
      bestOfN: sharedTour.bestOfN,
      duplicateCourseRule: sharedTour.duplicateCourseRule,
      courses: (sharedTour.courses || []).map(course => ({ name: course.name, holes: course.holes, maxRounds: course.maxRounds })),
    };
    const rounds = (sharedTour.rounds || []).map(round => ({
      id: round.id,
      date: round.playedDate,
      courseName: round.courseName,
      holes: round.holes,
      gameMode: round.gameMode,
      subjects: round.subjects.map(subject => ({
        playerId: subject.memberId,
        name: subject.name,
        totalPoints: subject.totalPoints,
      })),
    }));
    return computeStandings(localTour, rounds, players);
  }

  return Object.freeze({
    SHARED_TOUR_SCHEMA_VERSION,
    LIVE_PROTOCOL_VERSION,
    buildSharedTourCreate,
    buildRoundSubmission,
    computeSharedStandings,
    courseMatches,
    matchingRounds,
    computeStandings,
    subjectMatchesPlayer,
  });
}));
