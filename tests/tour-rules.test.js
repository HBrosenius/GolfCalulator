'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const tours = require('../src/tour-rules.js');

const players = [
  { id: 1, name: 'Ada', nick: 'Ace', hi: 12 },
  { id: 2, name: 'Bo', hi: 8 },
  { id: 3, name: 'Cy', hi: 20 },
];
const tour = {
  roster: [1, 2], startDate: '2026-06-01', endDate: '2026-08-31',
  courses: [{ name: 'Banan', holes: 18, maxRounds: 2 }],
  duplicateCourseRule: 'best', bestOfN: null,
};
const round = (id, date, mode, subjects, overrides = {}) => ({
  id, date, gameMode: mode, courseName: 'Banan', holes: 18, subjects, ...overrides,
});

test('matching rounds require course, date, supported mode, and roster player', () => {
  const input = [
    round('ok', '2026-07-01', 'individual', [{ playerId: 1, name: 'Old name', totalPoints: 35 }]),
    round('date', '2026-09-01', 'individual', [{ playerId: 1, totalPoints: 40 }]),
    round('course', '2026-07-01', 'individual', [{ playerId: 1, totalPoints: 40 }], { courseName: 'Annan' }),
    round('mode', '2026-07-01', 'scramble', [{ playerId: 1, totalPoints: 40 }]),
    round('roster', '2026-07-01', 'individual', [{ playerId: 3, totalPoints: 40 }]),
  ];
  assert.deepEqual(tours.matchingRounds(tour, input, players).map(item => item.id), ['ok']);
});

test('legacy subject names remain eligible but stable IDs take precedence', () => {
  assert.equal(tours.subjectMatchesPlayer({ name: 'Ace' }, players[0]), true);
  assert.equal(tours.subjectMatchesPlayer({ playerId: 99, name: 'Ace' }, players[0]), false);
});

test('best duplicate rule applies per-course cap before best-of-N', () => {
  const input = [
    round('a1', '2026-06-01', 'individual', [{ playerId: 1, totalPoints: 30 }]),
    round('a2', '2026-06-02', 'individual', [{ playerId: 1, totalPoints: 40 }]),
    round('a3', '2026-06-03', 'individual', [{ playerId: 1, totalPoints: 35 }]),
    round('b1', '2026-06-01', 'individual', [{ playerId: 2, totalPoints: 38 }]),
  ];
  const standings = tours.computeStandings({ ...tour, bestOfN: 1 }, input, players);
  assert.deepEqual(standings.map(row => [row.player.id, row.total, row.roundsPlayed, row.roundsCounted]), [
    [1, 40, 3, 1], [2, 38, 1, 1],
  ]);
});

test('first duplicate rule keeps chronological rounds and lower handicap breaks ties', () => {
  const input = [
    round('a1', '2026-06-01', 'individual', [{ playerId: 1, totalPoints: 20 }, { playerId: 2, totalPoints: 30 }]),
    round('a2', '2026-06-02', 'individual', [{ playerId: 1, totalPoints: 30 }, { playerId: 2, totalPoints: 20 }]),
    round('a3', '2026-06-03', 'individual', [{ playerId: 1, totalPoints: 50 }, { playerId: 2, totalPoints: 50 }]),
  ];
  const standings = tours.computeStandings({ ...tour, duplicateCourseRule: 'first' }, input, players);
  assert.deepEqual(standings.map(row => [row.player.id, row.total]), [[2, 50], [1, 50]]);
});

test('nine- and eighteen-hole configurations are capped separately', () => {
  const mixedTour = { ...tour, courses: [
    { name: 'Banan', holes: 9, maxRounds: 1 },
    { name: 'Banan', holes: 18, maxRounds: 1 },
  ] };
  const input = [
    round('nine', '2026-06-01', 'individual', [{ playerId: 1, totalPoints: 20 }], { holes: 9 }),
    round('eighteen', '2026-06-02', 'individual', [{ playerId: 1, totalPoints: 36 }]),
  ];
  assert.equal(tours.computeStandings(mixedTour, input, players)[0].total, 56);
});

test('local tours serialize to the shared Worker contract with course snapshots', () => {
  const payload = tours.buildSharedTourCreate({ ...tour, name: 'Sommar-touren', bestOfN: 3 }, players, [{
    name: 'Banan', tee: 'Gul', holes: 18, slope: 113, cr: 72, par: 72,
    hpar: Array(18).fill(4), si: Array.from({ length: 18 }, (_, index) => index + 1),
  }]);
  assert.equal(payload.protocolVersion, 2);
  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(payload.members, [{ name: 'Ace', hi: 12 }, { name: 'Bo', hi: 8 }]);
  assert.equal(payload.courses[0].tees[0].name, 'Gul');
  assert.equal(payload.courses[0].tees[0].hpar.length, 18);
});

test('shared serialization fails if roster or course definitions are incomplete', () => {
  assert.throws(() => tours.buildSharedTourCreate({ ...tour, roster: [1, 99] }, players, []), /unknown player/);
  assert.throws(() => tours.buildSharedTourCreate(tour, players, []), /no saved tee/);
});

test('saved rounds serialize with linked tour-member IDs and per-player tees', () => {
  const rows = Array.from({ length: 18 }, (_, index) => ({
    h: index + 1, par: 4, si: index + 1, strokes: 1, score: 5, netto: 4, pts: 2, skipped: false,
  }));
  const payload = tours.buildRoundSubmission({
    id: 123, date: '2026-07-01', courseName: 'Banan', holes: 18, tee: 'Gul', gameMode: 'individual',
    subjects: [
      { playerId: 1, tee: 'Gul', totalPoints: 36, totalBrutto: 90, rows },
      { playerId: 3, tee: 'Gul', totalPoints: 36, totalBrutto: 90, rows },
    ],
  }, {
    memberLinks: { 1: 'member-1' },
    tour: { courses: [{ id: 'course-1', name: 'Banan', holes: 18, tees: [{ name: 'Gul' }] }] },
  });
  assert.equal(payload.clientRoundId, '123');
  assert.deepEqual(payload.subjects.map(subject => subject.memberId), ['member-1']);
  assert.equal(payload.subjects[0].teeName, 'Gul');
});

test('shared server rounds feed the same standings rules', () => {
  const standings = tours.computeSharedStandings({
    startDate: '2026-06-01', endDate: '2026-08-31', bestOfN: null, duplicateCourseRule: 'best',
    members: [{ id: 'm1', name: 'Ada', hi: 12 }, { id: 'm2', name: 'Bo', hi: 8 }],
    courses: [{ id: 'c1', name: 'Banan', holes: 18, maxRounds: 1 }],
    rounds: [{
      id: 'r1', playedDate: '2026-07-01', courseName: 'Banan', holes: 18, gameMode: 'individual',
      subjects: [{ memberId: 'm1', name: 'Ada', totalPoints: 36 }, { memberId: 'm2', name: 'Bo', totalPoints: 35 }],
    }],
  });
  assert.deepEqual(standings.map(row => [row.player.name, row.total]), [['Ada', 36], ['Bo', 35]]);
});
