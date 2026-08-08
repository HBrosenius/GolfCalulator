'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const extras = require('../src/round-extras.js');

function player(name, holes) {
  return { subj: { name }, rows: holes.map((hole, index) => ({ h: index + 1, par: 4, score: hole.score, netto: hole.netto, pts: hole.pts, skipped: !!hole.skipped })) };
}

test('skins carry ties forward and leave a final tie unresolved', () => {
  const results = [
    player('Ada', [{ score: 4, netto: 4 }, { score: 4, netto: 3 }, { score: 4, netto: 4 }]),
    player('Bo', [{ score: 4, netto: 4 }, { score: 5, netto: 5 }, { score: 4, netto: 4 }]),
  ];
  assert.deepEqual(extras.computeSkins(results, 'net'), {
    skinsWon: { Ada: 2 },
    perHole: [
      { h: 1, winner: null, atStake: 1 },
      { h: 2, winner: 'Ada', atStake: 2 },
      { h: 3, winner: null, atStake: 1 },
    ],
    unresolvedCarry: 1,
  });
});

test('skins skip a hole if any player did not finish it', () => {
  const results = [
    player('Ada', [{ score: 4, netto: 4 }, { score: 3, netto: 3 }]),
    player('Bo', [{ score: 5, netto: 5 }, { skipped: true }]),
  ];
  assert.deepEqual(extras.computeSkins(results, 'gross').perHole, [{ h: 1, winner: 'Ada', atStake: 1 }]);
});

test('bet outcomes cover proposer win, loss, push and unplayed hole', () => {
  const played = [player('Ada', [{ netto: 3 }]), player('Bo', [{ netto: 5 }]), player('Cy', [{ netto: 4 }])];
  assert.deepEqual(extras.resolveBetOutcome({ hole: 0, proposerSeat: 0 }, played), { outcome: 'proposer_wins', winnerSeat: 0 });
  assert.deepEqual(extras.resolveBetOutcome({ hole: 0, proposerSeat: 1 }, played), { outcome: 'proposer_loses', winnerSeat: 0 });
  played[1].rows[0].netto = 3;
  assert.deepEqual(extras.resolveBetOutcome({ hole: 0, proposerSeat: 0 }, played), { outcome: 'push' });
  played[2].rows[0].skipped = true;
  assert.deepEqual(extras.resolveBetOutcome({ hole: 0, proposerSeat: 0 }, played), { outcome: 'unplayed' });
});

test('multi-player bets net opposing transfers into minimal payments', () => {
  const results = [
    player('Ada', [{ netto: 3 }, { netto: 5 }]),
    player('Bo', [{ netto: 4 }, { netto: 3 }]),
    player('Cy', [{ netto: 5 }, { netto: 4 }]),
  ];
  const settlement = extras.computeBetSettlement(results, [
    { hole: 0, proposerSeat: 0, amount: 20, status: 'locked' },
    { hole: 1, proposerSeat: 0, amount: 10, status: 'locked' },
    { hole: 1, proposerSeat: 2, amount: 5, status: 'pending' },
  ]);
  assert.deepEqual(settlement.net, [
    { fromName: 'Cy', toName: 'Ada', amount: 20 },
    { fromName: 'Bo', toName: 'Ada', amount: 10 },
  ]);
  assert.deepEqual(settlement.unresolved, [{ hole: 2, proposerName: 'Cy', amount: 5 }]);
});

test('highlights select best and toughest holes and include markers', () => {
  const items = extras.collectHighlightItems([
    player('Ada', [{ score: 3, netto: 3, pts: 3 }, { score: 6, netto: 6, pts: 0 }]),
    player('Bo', [{ score: 4, netto: 4, pts: 2 }, { score: 5, netto: 5, pts: 1 }]),
  ], { ctp: { player: 'Bo', hole: 0 }, ld: { player: 'Ada', hole: 1 } });
  assert.equal(items.find(item => item.label === 'Bästa hål').value, 'Ada · hål 1 (3p)');
  assert.equal(items.find(item => item.label === 'Tuffaste hålet').value, 'hål 2');
  assert.ok(items.some(item => item.label === 'Närmast pinnen · hål 1' && item.value === 'Bo'));
  assert.ok(items.some(item => item.label === 'Längsta drive · hål 2' && item.value === 'Ada'));
});
