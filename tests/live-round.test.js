'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const liveRound = require('../src/live-round.js');

test('seat permissions allow solo play, own seat, and unclaimed host seats', () => {
  assert.equal(liveRound.isSeatEditable({ liveRoomCode: null }, 3), true);
  assert.equal(liveRound.isSeatEditable({ liveRoomCode: 'ABCD', liveSeat: 2 }, 2), true);
  assert.equal(liveRound.isSeatEditable({ liveRoomCode: 'ABCD', liveSeat: 1 }, 2), false);
  assert.equal(liveRound.isSeatEditable({ liveRoomCode: 'ABCD', liveSeat: 0, liveSeatsClaimed: { 2: false } }, 2), true);
  assert.equal(liveRound.isSeatEditable({ liveRoomCode: 'ABCD', liveSeat: 0, liveSeatsClaimed: { 2: true } }, 2), false);
});

test('individual room conversion calculates handicaps and copies remote scores', () => {
  const room = {
    courseName: 'Livebanan', teeColor: 'Gul', holes: 9, slope: 113, cr: 36, par: 36,
    hpar: Array(9).fill(4), si: [1, 2, 3, 4, 5, 6, 7, 8, 9], gameMode: 'individual',
    players: [{ name: 'Ada', hi: 18, tee: 'Gul' }, { name: 'Bo', hi: 12, tee: 'Blå' }],
    seats: [{ scores: ['4'] }, {}], note: 'Hej', weather: 'sun', bets: [],
  };
  const state = liveRound.buildStateFromRoom(room, {
    code: 'ABCD', seat: 1, seatToken: 'secret', savedPlayers: [{ id: 7, name: 'Bo' }],
    teeData: tee => tee === 'Blå' ? { slope: 120, cr: 35, par: 36 } : { slope: 113, cr: 36, par: 36 },
    calculatePlayingHandicap: (hi, slope) => hi + slope,
  });
  assert.equal(state.players[1].playingHandicap, 132);
  assert.equal(state.players[1].playerId, 7);
  assert.equal(state.playerIds[1], 7);
  assert.deepEqual(state.scores[0], ['4']);
  assert.deepEqual(state.scores[1], Array(9).fill(''));
  room.seats[0].scores[0] = '9';
  assert.equal(state.scores[0][0], '4');
});

test('explicit player choice wins over automatic matching', () => {
  const room = { courseName: 'B', teeColor: 'Gul', holes: 9, gameMode: 'individual', players: [{ name: 'Ada', hi: 1 }], seats: [] };
  const state = liveRound.buildStateFromRoom(room, {
    code: 'ABCD', seat: 0, seatToken: 'token', selectedPlayerId: 99,
    savedPlayers: [{ id: 7, name: 'Ada' }], teeData: () => ({ slope: 113, cr: 36, par: 36 }), calculatePlayingHandicap: () => 1,
  });
  assert.equal(state.players[0].playerId, 99);
});

test('shared room conversion links only unambiguous team member names', () => {
  const room = {
    courseName: 'B', holes: 9, gameMode: 'scramble', players: [],
    teams: [{ name: 'Lag A', playingHandicap: 8, members: [{ name: 'Ace' }, { name: 'Bo' }] }], seats: [{ scores: ['3'] }],
  };
  const state = liveRound.buildStateFromRoom(room, {
    code: 'ABCD', seat: 0, seatToken: 'token',
    savedPlayers: [{ id: 1, name: 'Ada', nick: 'Ace' }, { id: 2, name: 'Bo' }, { id: 3, name: 'Bertil', nick: 'Bo' }],
  });
  assert.equal(state.teams[0].members[0].playerId, 1);
  assert.equal(state.teams[0].members[1].playerId, null);
});

test('a joined live room retains tour context without submission ownership', () => {
  const room = {
    courseName: 'B', teeColor: 'Gul', holes: 9, slope: 113, cr: 36, par: 36,
    gameMode: 'individual', players: [{ name: 'Ada', hi: 1 }], seats: [], tourRef: { code: 'ABCD2345' },
  };
  const state = liveRound.buildStateFromRoom(room, {
    code: 'LIVE', seat: 0, seatToken: 'token', teeData: () => ({ slope: 113, cr: 36, par: 36 }), calculatePlayingHandicap: () => 1,
  });
  assert.deepEqual(state.tourContext, { code: 'ABCD2345', submissionOwner: false });
});

test('snapshot merge preserves the local seat and applies remote scores', () => {
  const current = { holes: 2, liveSeat: 1, scores: [['', ''], ['4', '5']], markers: { ctp: {}, ld: {} }, note: '', weather: null, bets: [] };
  const result = liveRound.mergeRoomSnapshot(current, {
    seats: { 0: { scores: ['3', '4'] }, 1: { scores: ['9', '9'] } }, bets: [],
  });
  assert.deepEqual(result.state.scores, [['3', '4'], ['4', '5']]);
  assert.equal(result.scoresChanged, true);
  assert.deepEqual(current.scores, [['', ''], ['4', '5']]);
});

test('host snapshot tracks claim changes without accepting remote metadata', () => {
  const current = {
    holes: 1, liveSeat: 0, scores: [['4'], ['']], liveSeatsClaimed: { 1: false },
    markers: { ctp: { player: 'Ada' }, ld: { player: '' } }, note: 'Lokalt', weather: 'sun', bets: [],
  };
  const result = liveRound.mergeRoomSnapshot(current, {
    seats: { 0: { scores: ['4'], claimed: true }, 1: { scores: ['5'], claimed: true } },
    markers: { ctp: { player: 'Bo' }, ld: { player: 'Bo' } }, note: 'Fjärr', weather: 'rain', bets: [],
  });
  assert.equal(result.claimsChanged, true);
  assert.deepEqual(result.state.liveSeatsClaimed, { 1: true });
  assert.equal(result.state.note, 'Lokalt');
  assert.equal(result.state.markers.ctp.player, 'Ada');
});

test('joiner snapshot mirrors markers, metadata and authoritative bets', () => {
  const current = {
    holes: 1, liveSeat: 1, scores: [[''], ['4']],
    markers: { ctp: { hole: 0, player: '' }, ld: { hole: 0, player: '' } }, note: '', weather: null, bets: [],
  };
  const bets = [{ id: 'b1', status: 'locked' }];
  const result = liveRound.mergeRoomSnapshot(current, {
    seats: { 0: { scores: ['3'] }, 1: { scores: ['4'] } },
    markers: { ctp: { player: 'Ada' }, ld: { player: 'Bo' } }, note: 'Blåsigt', weather: 'wind', bets,
  });
  assert.equal(result.markersChanged, true);
  assert.equal(result.metaChanged, true);
  assert.equal(result.betsChanged, true);
  assert.equal(result.state.markers.ctp.player, 'Ada');
  assert.equal(result.state.note, 'Blåsigt');
  assert.equal(result.state.bets, bets);
});
