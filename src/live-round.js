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

  return Object.freeze({ isSharedScoreMode, isSeatEditable, buildStateFromRoom });
}));
