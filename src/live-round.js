(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfLiveRound = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SHARED_SCORE_MODES = new Set(['scramble', 'foursome']);

  function isSharedScoreMode(mode) {
    return SHARED_SCORE_MODES.has(mode);
  }

  function isSeatEditable(state, seat) {
    if (!state.liveRoomCode) return true;
    if (state.liveSeat === seat) return true;
    return state.liveSeat === 0 && !(state.liveSeatsClaimed && state.liveSeatsClaimed[seat]);
  }

  function uniquePlayerIdForName(name, players) {
    const matches = (players || []).filter(player => player.name === name || player.nick === name);
    return matches.length === 1 ? matches[0].id : null;
  }

  function buildStateFromRoom(room, options) {
    const settings = options || {};
    const savedPlayers = settings.savedPlayers || [];
    const shared = isSharedScoreMode(room.gameMode);
    const next = {
      courseName: room.courseName, teeColor: room.teeColor, holes: room.holes,
      slope: room.slope, cr: room.cr, par: room.par,
      hpar: room.hpar || [], si: room.si || [],
      gameMode: room.gameMode,
      numPlayers: (room.players || []).length,
      players: [], playerIds: [], teams: null,
      teamAssign: ['A', 'A', 'B', 'B'], playerTees: [], scores: [],
      note: room.note || '', weather: room.weather || null,
      markers: room.markers || { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } },
      liveRoomCode: settings.code, liveSeat: settings.seat, liveSeatsClaimed: null,
      liveHostToken: null, liveSeatToken: settings.seatToken,
      bets: Array.isArray(room.bets) ? room.bets : [],
      tourContext: room.tourRef ? { code: room.tourRef.code, submissionOwner: false } : null,
    };

    if (shared) {
      next.teams = (room.teams || []).map(team => ({
        name: team.name,
        members: (team.members || []).map(member => ({
          name: member.name,
          playerId: uniquePlayerIdForName(member.name, savedPlayers),
        })),
        playingHandicap: team.playingHandicap,
      }));
    } else {
      if (typeof settings.teeData !== 'function' || typeof settings.calculatePlayingHandicap !== 'function') {
        throw new TypeError('teeData and calculatePlayingHandicap are required for individual rooms');
      }
      next.players = (room.players || []).map(player => {
        const tee = player.tee || room.teeColor;
        const data = settings.teeData(tee);
        return {
          name: player.name, hi: player.hi, tee,
          playingHandicap: settings.calculatePlayingHandicap(player.hi, data.slope, data.cr, data.par, room.holes),
          slope: data.slope, cr: data.cr, par: data.par,
        };
      });
      next.playerTees = next.players.map(player => player.tee);
      const seatPlayer = next.players[settings.seat];
      const automaticId = seatPlayer ? uniquePlayerIdForName(seatPlayer.name, savedPlayers) : null;
      const localPlayerId = settings.selectedPlayerId ?? automaticId;
      if (seatPlayer && localPlayerId != null) {
        seatPlayer.playerId = localPlayerId;
        next.playerIds[settings.seat] = localPlayerId;
      }
    }

    const seatCount = shared ? next.teams.length : next.players.length;
    next.scores = Array.from({ length: seatCount }, (_, index) => {
      const seatData = room.seats && room.seats[index];
      return seatData && Array.isArray(seatData.scores) ? [...seatData.scores] : new Array(room.holes).fill('');
    });
    return next;
  }

  function mergeRoomSnapshot(current, room) {
    if (!room || !room.seats) return { state: current, scoresChanged: false, claimsChanged: false, markersChanged: false, metaChanged: false, betsChanged: false };
    const next = { ...current, scores: (current.scores || []).map(row => Array.isArray(row) ? [...row] : row) };
    let scoresChanged = false;
    Object.keys(room.seats).forEach(seatKey => {
      const seat = Number(seatKey);
      const seatData = room.seats[seatKey];
      if (seat === current.liveSeat || !seatData || !Array.isArray(seatData.scores)) return;
      if (!next.scores[seat]) next.scores[seat] = new Array(current.holes).fill('');
      seatData.scores.forEach((value, hole) => {
        if (next.scores[seat][hole] !== value) scoresChanged = true;
        next.scores[seat][hole] = value;
      });
    });

    let claimsChanged = false;
    if (current.liveSeat === 0) {
      const claimed = {};
      Object.keys(room.seats).forEach(seatKey => {
        const seat = Number(seatKey);
        if (seat !== current.liveSeat) claimed[seat] = !!room.seats[seatKey].claimed;
      });
      const previous = current.liveSeatsClaimed || {};
      const seats = new Set([...Object.keys(previous), ...Object.keys(claimed)]);
      claimsChanged = [...seats].some(seat => !!previous[seat] !== !!claimed[seat]);
      next.liveSeatsClaimed = claimed;
    }

    let markersChanged = false;
    let metaChanged = false;
    if (current.liveSeat !== 0) {
      if (room.markers && current.markers) {
        const ctp = room.markers.ctp?.player || '';
        const ld = room.markers.ld?.player || '';
        markersChanged = ctp !== (current.markers.ctp?.player || '') || ld !== (current.markers.ld?.player || '');
        next.markers = {
          ...current.markers,
          ctp: { ...current.markers.ctp, player: ctp },
          ld: { ...current.markers.ld, player: ld },
        };
      }
      const note = room.note !== undefined ? room.note || '' : current.note;
      const weather = room.weather !== undefined ? room.weather || null : current.weather;
      metaChanged = note !== current.note || weather !== current.weather;
      next.note = note;
      next.weather = weather;
    }

    const betsChanged = Array.isArray(room.bets) && room.bets !== current.bets;
    if (Array.isArray(room.bets)) next.bets = room.bets;
    return { state: next, scoresChanged, claimsChanged, markersChanged, metaChanged, betsChanged };
  }

  return Object.freeze({ isSharedScoreMode, isSeatEditable, buildStateFromRoom, mergeRoomSnapshot });
}));
