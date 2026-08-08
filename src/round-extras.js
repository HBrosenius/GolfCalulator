(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfRoundExtras = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function collectHighlightItems(results, markers) {
    if (!Array.isArray(results) || !results.some(r => r.rows.some(row => !row.skipped))) return [];
    const items = [];
    let best = null;
    results.forEach(r => r.rows.forEach(row => {
      if (!row.skipped && (!best || row.pts > best.pts || (row.pts === best.pts && row.h < best.h))) {
        best = { name: r.subj.name, h: row.h, pts: row.pts };
      }
    }));
    if (best) items.push({ icon: '🔥', label: 'Bästa hål', value: `${best.name} · hål ${best.h} (${best.pts}p)` });

    const leaderBy = predicate => {
      let leader = null;
      results.forEach(r => {
        const count = r.rows.filter(row => !row.skipped && predicate(row)).length;
        if (count > 0 && (!leader || count > leader.n)) leader = { name: r.subj.name, n: count };
      });
      return leader;
    };
    const birdies = leaderBy(row => row.score === row.par - 1);
    if (birdies) items.push({ icon: '🐦', label: 'Flest birdies', value: `${birdies.name} · ${birdies.n} st` });
    const eagles = leaderBy(row => row.score <= row.par - 2);
    if (eagles) items.push({ icon: '🦅', label: 'Eagle el. bättre', value: `${eagles.name} · ${eagles.n} st` });
    const zeros = leaderBy(row => row.pts === 0);
    if (zeros) items.push({ icon: '😬', label: 'Flest nollor', value: `${zeros.name} · ${zeros.n} st` });

    if (results.length >= 2) {
      const holes = {};
      results.forEach(r => r.rows.forEach(row => {
        if (row.skipped) return;
        const stat = holes[row.h] || (holes[row.h] = { sum: 0, n: 0 });
        stat.sum += row.pts;
        stat.n++;
      }));
      let toughest = null;
      Object.entries(holes).forEach(([hole, stat]) => {
        const candidate = { h: Number(hole), avg: stat.sum / stat.n };
        if (!toughest || candidate.avg < toughest.avg || (candidate.avg === toughest.avg && candidate.h < toughest.h)) toughest = candidate;
      });
      if (toughest) items.push({ icon: '🎯', label: 'Tuffaste hålet', value: `hål ${toughest.h}` });
    }

    if (markers?.ctp?.player) items.push({ icon: '🎯', label: `Närmast pinnen${markers.ctp.hole != null ? ` · hål ${markers.ctp.hole + 1}` : ''}`, value: markers.ctp.player });
    if (markers?.ld?.player) items.push({ icon: '💥', label: `Längsta drive${markers.ld.hole != null ? ` · hål ${markers.ld.hole + 1}` : ''}`, value: markers.ld.player });
    return items;
  }

  function computeSkins(results, basis) {
    if (!Array.isArray(results) || results.length < 2) return null;
    const numHoles = Math.max(...results.map(r => r.rows.length));
    let carry = 0;
    const skinsWon = {};
    const perHole = [];
    for (let i = 0; i < numHoles; i++) {
      const rows = results.map(r => r.rows[i]);
      if (rows.some(row => !row || row.skipped)) continue;
      const values = results.map((r, seat) => ({ seat, name: r.subj.name, value: basis === 'gross' ? r.rows[i].score : r.rows[i].netto }));
      const minimum = Math.min(...values.map(item => item.value));
      const winners = values.filter(item => item.value === minimum);
      const atStake = 1 + carry;
      if (winners.length === 1) {
        const winner = winners[0];
        skinsWon[winner.name] = (skinsWon[winner.name] || 0) + atStake;
        perHole.push({ h: rows[0].h, winner: winner.name, atStake });
        carry = 0;
      } else {
        perHole.push({ h: rows[0].h, winner: null, atStake });
        carry = atStake;
      }
    }
    return { skinsWon, perHole, unresolvedCarry: carry };
  }

  function resolveBetOutcome(bet, results) {
    const rows = results.map(r => r.rows[bet.hole]);
    if (rows.some(row => !row || row.skipped)) return { outcome: 'unplayed' };
    const values = rows.map((row, seat) => ({ seat, value: row.netto }));
    const minimum = Math.min(...values.map(item => item.value));
    const winners = values.filter(item => item.value === minimum);
    if (winners.length !== 1) return { outcome: 'push' };
    const winnerSeat = winners[0].seat;
    return winnerSeat === bet.proposerSeat ? { outcome: 'proposer_wins', winnerSeat } : { outcome: 'proposer_loses', winnerSeat };
  }

  function collapseSettlement(transfers) {
    const net = {};
    transfers.forEach(({ from, to, amount }) => {
      net[from] = (net[from] || 0) - amount;
      net[to] = (net[to] || 0) + amount;
    });
    const debtors = Object.entries(net).filter(([, value]) => value < 0).map(([seat, value]) => ({ seat: +seat, amount: -value })).sort((a, b) => b.amount - a.amount);
    const creditors = Object.entries(net).filter(([, value]) => value > 0).map(([seat, value]) => ({ seat: +seat, amount: value })).sort((a, b) => b.amount - a.amount);
    const result = [];
    let debtor = 0;
    let creditor = 0;
    while (debtor < debtors.length && creditor < creditors.length) {
      const amount = Math.min(debtors[debtor].amount, creditors[creditor].amount);
      if (amount > 0) result.push({ from: debtors[debtor].seat, to: creditors[creditor].seat, amount });
      debtors[debtor].amount -= amount;
      creditors[creditor].amount -= amount;
      if (debtors[debtor].amount === 0) debtor++;
      if (creditors[creditor].amount === 0) creditor++;
    }
    return result;
  }

  function seatName(results, seat) {
    return results[seat]?.subj.name || `Spelare ${seat + 1}`;
  }

  function computeBetSettlement(results, bets) {
    if (!Array.isArray(results) || !Array.isArray(bets) || !bets.length) return { net: [], perHole: [], unresolved: [] };
    const transfers = [];
    const perHole = bets.filter(bet => bet.status === 'locked').sort((a, b) => a.hole - b.hole).map(bet => {
      const resolution = resolveBetOutcome(bet, results);
      const base = { hole: bet.hole + 1, outcome: resolution.outcome, proposerName: seatName(results, bet.proposerSeat), amount: bet.amount };
      if (resolution.outcome === 'proposer_wins') {
        results.forEach((_, seat) => { if (seat !== bet.proposerSeat) transfers.push({ from: seat, to: bet.proposerSeat, amount: bet.amount }); });
        return { ...base, opponents: results.map((_, seat) => seat).filter(seat => seat !== bet.proposerSeat).map(seat => seatName(results, seat)) };
      }
      if (resolution.outcome === 'proposer_loses') {
        transfers.push({ from: bet.proposerSeat, to: resolution.winnerSeat, amount: bet.amount });
        return { ...base, winnerName: seatName(results, resolution.winnerSeat) };
      }
      return base;
    });
    const net = collapseSettlement(transfers).map(item => ({ fromName: seatName(results, item.from), toName: seatName(results, item.to), amount: item.amount }));
    const unresolved = bets.filter(bet => bet.status === 'pending').map(bet => ({ hole: bet.hole + 1, proposerName: seatName(results, bet.proposerSeat), amount: bet.amount }));
    return { net, perHole, unresolved };
  }

  return Object.freeze({ collectHighlightItems, computeSkins, resolveBetOutcome, collapseSettlement, computeBetSettlement });
}));
