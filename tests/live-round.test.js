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
