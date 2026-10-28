'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const rules = require('../src/tour-rules.js'), competition = require('../src/competition.js');
const players = [{ id: 1, name: 'Ada', hi: 12 }, { id: 2, name: 'Bo', hi: 8 }, { id: 3, name: 'Cy', hi: 20 }];
const tour = (format = 'stableford', tieBreak = 'shared', bestOfN = 1) => ({ roster: players.map(player => player.id), competition: { format, tieBreak }, bestOfN, startDate: '2026-01-01', endDate: '2026-12-31', duplicateCourseRule: 'best', courses: [{ id: 'c1', name: 'Banan', holes: 9, maxRounds: 3 }] });
function round(id, playerId, gross, strokes = 1, points = 18) { return { id, date: `2026-07-${String(Number(id) || 1).padStart(2, '0')}`, courseName: 'Banan', holes: 9, gameMode: 'individual', subjects: [{ playerId, totalPoints: points, totalBrutto: gross * 9, rows: Array.from({ length: 9 }, (_,h) => ({ h: h+1, score: gross, strokes, pts: points / 9, skipped: false })) }] }; }
test('gross/net rank lower complete scores and derive net from frozen strokes', () => {
  const rounds = [round('1',1,5,2), round('2',2,4,0)];
  assert.equal(rules.computeStandings(tour('gross'), rounds, players)[0].player.id, 2);
  const net = rules.computeStandings(tour('net'), rounds, players); assert.equal(net[0].player.id, 1); assert.equal(net[0].total, 27);
});
test('incomplete stroke series are unranked until their fixed number of rounds is recorded', () => {
  const rows = rules.computeStandings(tour('gross','shared',2), [round('1',1,4),round('2',2,5),round('3',2,5)], players);
  assert.equal(rows[0].player.id, 2); assert.equal(rows[0].position, 1); assert.equal(rows[1].position, null); assert.equal(rows[1].complete, false);
});
test('shared places use competition numbering, best-round ties use counted results only', () => {
  const input = [round('1',1,5,1,20),round('2',2,5,1,20),round('3',3,5,1,10)];
  assert.deepEqual(rules.computeStandings(tour(), input, players).map(row=>row.position), [1,1,3]);
  const tied = [round('1',1,5,1,30), round('2',1,5,1,10), round('3',2,5,1,20), round('4',2,5,1,20)];
  const ranked = rules.computeStandings(tour('stableford','best_round',2), tied, players); assert.equal(ranked[0].player.id, 1); assert.deepEqual(ranked.map(row=>row.position), [1,2]);
});
test('course quota and best-of exclusions explain every selection in both directions', () => {
  const configured = tour('gross','shared',1); configured.courses[0].maxRounds = 2;
  const ranked = rules.computeStandings(configured, [round('1',1,6),round('2',1,4),round('3',1,5)], players)[0];
  assert.equal(ranked.total,36); assert.equal(ranked.results.find(result=>result.roundId==='1').reason,'course_limit'); assert.equal(ranked.results.find(result=>result.roundId==='3').reason,'best_of_limit');
});
test('stroke play rejects team formats, pickups and mismatched course lengths', () => {
  const picked = round('1',1,4); picked.subjects[0].rows[0].skipped = true;
  assert.equal(rules.computeStandings(tour('net'),[picked],players).length,0);
  const team = round('2',1,4); team.gameMode='scramble'; assert.equal(rules.computeStandings(tour('gross'),[team],players).length,0);
  assert.ok(competition.validate({format:'gross',tieBreak:'shared'}, {...tour('gross'),bestOfN:null}));
  assert.ok(competition.validate({format:'net',tieBreak:'shared'}, {...tour('net'),courses:[{holes:9,maxRounds:1},{holes:18,maxRounds:1}]}));
});
test('legacy default ranking remains points followed by lower handicap', () => {
  const configured = tour(); delete configured.competition;
  const ranked = rules.computeStandings(configured,[round('1',1,5),round('2',2,5)],players); assert.equal(ranked[0].player.id,2); assert.deepEqual(ranked.map(row=>row.position),[1,2]);
});
