(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./competition.js') : root.GolfCompetition);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfTourRules = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Competition) {
  'use strict';

  const SHARED_TOUR_SCHEMA_VERSION = 1;
  const LIVE_PROTOCOL_VERSION = 2;
  const SUPPORTED_GAME_MODES = new Set(['individual', 'scramble', 'fourball', 'foursome', 'match']);

  function subjectMatchesPlayer(subject, player) {
    if (!subject || !player) return false;
    if (Array.isArray(subject.memberIds) && subject.memberIds.includes(player.id)) return true;
    if (Array.isArray(subject.members)) {
      const names = new Set([player.name, player.nick].filter(Boolean));
      if (subject.members.some(name => names.has(name))) return true;
    }
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
      round.roundKind !== 'practice' && !['draft', 'in_progress'].includes(round.lifecycle) &&
      tour.courses.some(course => courseMatches(course, round)) &&
      round.date >= tour.startDate && round.date <= tour.endDate &&
      SUPPORTED_GAME_MODES.has(round.gameMode || 'individual') &&
      roster.some(player => (round.subjects || []).some(subject => subjectMatchesPlayer(subject, player)))
    );
  }

  function subjectPoints(subject) {
    if (Number.isFinite(subject?.totalPoints)) return subject.totalPoints;
    const points = Array.isArray(subject?.rows)
      ? subject.rows.filter(row => Number.isFinite(row?.pts)).map(row => row.pts)
      : [];
    return points.length ? points.reduce((sum, value) => sum + value, 0) : 0;
  }

  function computeStandings(tour, rounds, players) {
    const roster = rosterPlayers(tour, players);
    return Competition.standings(tour, matchingRounds(tour, rounds, players), roster, subjectMatchesPlayer);
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
    if (Competition.config(sharedRecord.tour).format !== 'stableford' && (round.gameMode !== 'individual' || !round.subjects.every(subject => Competition.complete(subject, round.holes)))) throw new Error('Slagspel kräver individuellt spel och slag på alla hål.');
    if (round.roundKind === 'practice') throw new Error('Träningsrundor kan inte skickas till en tour.');
    const course = sharedRecord.tour.courses.find(item => item.name === round.courseName && item.holes === round.holes);
    if (!course) throw new Error('Round course is not in the shared tour');
    const links = sharedRecord.memberLinks || {};
    const subjects = (round.subjects || []).flatMap(subject => {
      if (['scramble', 'foursome'].includes(round.gameMode)) {
        const localIds = Array.isArray(subject.memberIds) ? subject.memberIds : [];
        const memberIds = localIds.map(id => links[id]).filter(Boolean);
        return memberIds.map(memberId => ({
          memberId,
          teeName: round.tee,
          totalPoints: subject.totalPoints,
          totalBrutto: subject.totalBrutto,
          teamId: subject.name || null,
          rows: subject.rows.map(row => ({
            h: row.h, par: row.par, si: row.si, strokes: row.strokes,
            score: row.score, netto: row.netto, pts: row.pts, skipped: !!row.skipped,
          })),
        }));
      }
      const memberId = subject.memberId || links[subject.playerId];
      if (!memberId) return [];
      const teeName = subject.tee || round.tee;
      if (!course.tees.some(tee => tee.name === teeName)) throw new Error(`Round tee is not in the shared tour: ${teeName}`);
      return [{
        memberId,
        teeName,
        totalPoints: subject.totalPoints,
        totalBrutto: subject.totalBrutto,
        teamId: subject.teamId || null,
        rows: subject.rows.map(row => ({
          h: row.h, par: row.par, si: row.si, strokes: row.strokes,
          score: row.score, netto: row.netto, pts: row.pts, skipped: !!row.skipped,
        })),
      }];
    });
    if (!subjects.length) throw new Error('Round contains no linked tour members');
    return {
      protocolVersion: LIVE_PROTOCOL_VERSION,
      schemaVersion: SHARED_TOUR_SCHEMA_VERSION,
      rulesRevision: round.tourRef?.rulesRevision || sharedRecord.tour.rulesRevision || 1,
      clientRoundId: String(round.id),
      playedDate: round.date,
      courseId: course.id,
      gameMode: round.gameMode,
      ...(round.roundKind ? { roundKind: round.roundKind } : {}),
      subjects,
      ...(round.liveRoomCode ? { liveRoomCode: round.liveRoomCode } : {}),
    };
  }

  function eligibleSharedRounds(tour) {
    const rounds = [...(tour?.rounds || []), ...(tour?.provisionalRounds || []), ...(tour?.excludedRounds || []), ...(tour?.competitionRounds || [])];
    return rounds.filter((round, index) => rounds.findIndex(item => item.id === round.id) === index).filter(round => (!round.resultStatus || round.resultStatus === 'active') && (!tour.approvalRequired || round.approvalStatus === 'confirmed') && (Competition.config(tour).format === 'stableford' || (round.gameMode === 'individual' && round.subjects.every(subject => Competition.complete(subject, round.holes)))));
  }

  function computeSharedStandings(sharedTour) {
    const players = (sharedTour?.members || []).map(member => ({ id: member.id, name: member.name, hi: member.hi }));
    const localTour = {
      roster: players.map(player => player.id),
      startDate: sharedTour.startDate,
      endDate: sharedTour.endDate,
      bestOfN: sharedTour.bestOfN,
      duplicateCourseRule: sharedTour.duplicateCourseRule,
      competition: Competition.config(sharedTour),
      courses: (sharedTour.courses || []).map(course => ({ name: course.name, holes: course.holes, maxRounds: course.maxRounds })),
    };
    const rounds = eligibleSharedRounds(sharedTour).map(round => ({
      id: round.id,
      date: round.playedDate,
      courseName: round.courseName,
      holes: round.holes,
      gameMode: round.gameMode,
      subjects: round.subjects.map(subject => ({
        playerId: subject.memberId,
        name: subject.name,
        totalPoints: subject.totalPoints,
        totalBrutto: subject.totalBrutto,
        rows: subject.rows,
      })),
    }));
    return computeStandings(localTour, rounds, players);
  }

  function computePlayerProfiles(sharedTour) {
    const standings = computeSharedStandings(sharedTour);
    const format = Competition.config(sharedTour).format, direction = format === 'stableford' ? 1 : -1;
    const position = new Map(standings.map(row => [row.player.id, row.position]));
    const performances = new Map((sharedTour?.members || []).map(member => [member.id, []]));
    eligibleSharedRounds(sharedTour).forEach(round => (round.subjects || []).forEach(subject => {
      if (performances.has(subject.memberId)) performances.get(subject.memberId).push({
        points: Competition.metric(subject, format, round.holes), courseName: round.courseName, playedDate: round.playedDate,
        gameMode: round.gameMode, roundId: round.id,
      });
    }));
    return (sharedTour?.members || []).map(member => {
      const results = performances.get(member.id) || [];
      const points = results.map(result => result.points);
      const headToHead = { wins: 0, losses: 0, ties: 0 };
      eligibleSharedRounds(sharedTour).forEach(round => {
        const own = (round.subjects || []).find(subject => subject.memberId === member.id);
        if (!own) return;
        (round.subjects || []).filter(subject => subject.memberId !== member.id).forEach(opponent => {
          const difference = direction * (Competition.metric(own, format, round.holes) - Competition.metric(opponent, format, round.holes));
          if (difference > 0) headToHead.wins++;
          else if (difference < 0) headToHead.losses++;
          else headToHead.ties++;
        });
      });
      return {
        member,
        position: position.get(member.id) || null,
        appearances: results.length,
        totalPoints: points.reduce((sum, value) => sum + value, 0),
        averagePoints: points.length ? Math.round(points.reduce((sum, value) => sum + value, 0) / points.length * 10) / 10 : 0,
        bestRound: results.slice().sort((a, b) => direction * (b.points - a.points) || a.playedDate.localeCompare(b.playedDate))[0] || null,
        wins: position.get(member.id) === 1 && sharedTour?.status === 'completed' ? 1 : 0,
        podiums: position.get(member.id) && position.get(member.id) <= 3 && sharedTour?.status === 'completed' ? 1 : 0,
        headToHead,
      };
    }).sort((a, b) => (a.position || 999) - (b.position || 999) || a.member.name.localeCompare(b.member.name, 'sv-SE'));
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
    computePlayerProfiles,
    subjectPoints,
    subjectMatchesPlayer,
  });
}));
