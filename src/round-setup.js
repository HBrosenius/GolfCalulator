(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfRoundSetup = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const copyCourse = course => ({ ...Object.fromEntries(['ratingCategory','catalogTee','catalogId','catalogVersion','catalogUpdatedAt','catalogSource','catalogVerifiedAt','catalogVerificationStatus'].filter(key => course[key] != null).map(key => [key, structuredClone(course[key])])), name: course.name, tee: course.tee, holes: course.holes,
    slope: course.slope, cr: course.cr, par: course.par, hpar: [...course.hpar], si: [...course.si] });

  function fromRound(round, savedPlayers = []) {
    const shared = ['scramble', 'foursome'].includes(round.gameMode);
    const courses = [];
    const players = [];
    for (const [index, subject] of round.subjects.entries()) {
      const tee = subject.tee || round.tee;
      if (!courses.some(course => course.tee === tee)) courses.push(copyCourse({
        ...(round.courseSnapshot || []).find(course => course.tee === tee),
        name: round.courseName, tee, holes: round.holes,
        slope: subject.slope ?? round.slope, cr: subject.cr ?? round.cr, par: subject.par ?? round.par,
        hpar: subject.rows.map(row => row.par), si: subject.rows.map(row => row.si),
      }));
      const members = shared ? (subject.members || []).map((name, i) => ({ name, playerId: subject.memberIds?.[i] ?? null, hi: null }))
        : [{ name: subject.name, playerId: subject.playerId ?? null, hi: subject.hi ?? null }];
      members.forEach(member => {
        const saved = member.playerId == null ? null : savedPlayers.find(player => player.id === member.playerId);
        players.push({ playerId: saved?.id ?? null, name: saved ? (saved.nick || saved.name) : member.name,
          hi: saved?.hi ?? member.hi, tee,
          team: shared ? (index === 0 ? 'A' : 'B') : (subject.teamId || (players.length < 2 ? 'A' : 'B')) });
      });
    }
    if (round.tee && courses.some(course => course.tee === round.tee)) courses.sort((a, b) => Number(b.tee === round.tee) - Number(a.tee === round.tee));
    return { courses, players, gameMode: round.gameMode, minTeeShots: round.minTeeShots ?? null };
  }

  function freshState(setup, savedPlayers = []) {
    const course = setup.courses[0];
    const players = setup.players.map(player => {
      const saved = player.playerId == null ? null : savedPlayers.find(item => item.id === player.playerId);
      return { name: saved ? (saved.nick || saved.name) : player.name, hi: saved?.hi ?? player.hi };
    });
    // Deliberately construct a fresh round: no editing ID, scores, tour context,
    // marker winners, wagers, dates or device-specific live credentials transfer.
    return { courseName: course.name, teeColor: course.tee, _originalTee: course.tee, holes: course.holes,
      slope: course.slope, cr: course.cr, par: course.par, hpar: [...course.hpar], si: [...course.si],
      setupCourses: setup.courses.map(copyCourse), gameMode: setup.gameMode,
      numPlayers: players.length, players, playerIds: setup.players.map(player =>
        savedPlayers.some(saved => saved.id === player.playerId) ? player.playerId : null),
      playerMemberIds: [], teamAssign: setup.players.map(player => player.team), playerTees: setup.players.map(player => player.tee),
      teams: null, scores: [], note: '', weather: null, minTeeShots: setup.minTeeShots ?? null,
      markers: { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } },
      liveRoomCode: null, liveSeat: null, liveHostToken: null, liveSeatToken: null, liveSeatsClaimed: null,
      bets: [], tourContext: null };
  }

  return Object.freeze({ fromRound, freshState, copyCourse });
}));
