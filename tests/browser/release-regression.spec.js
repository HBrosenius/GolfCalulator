const { test, expect } = require('@playwright/test');

test('legacy data loads and export/import preserves all collections', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const result = await page.evaluate(() => {
    const course = { name: 'Testbanan', tee: 'Gul', holes: 9, slope: 113, cr: 36, par: 36 };
    const round = { id: 'round-1', courseName: 'Testbanan', holes: 9, subjects: [] };
    const player = { id: 'player-1', name: 'Ada', photo: null };
    localStorage.setItem('golf_courses_db', JSON.stringify([course]));
    localStorage.setItem('golf_rounds_db', JSON.stringify([round]));
    localStorage.setItem('golf_players_db', JSON.stringify([player]));
    localStorage.setItem('golf_tours_db', JSON.stringify([{ id: 'tour-1', courses: ['Testbanan'] }]));

    const migratedTours = toursLoad();
    const payload = _buildDataPayload(true, true, true);
    localStorage.removeItem('golf_courses_db');
    localStorage.removeItem('golf_rounds_db');
    localStorage.removeItem('golf_players_db');
    const imported = _applyImportPayload(JSON.parse(JSON.stringify(payload)));

    return {
      migratedTours,
      payload,
      imported,
      courses: dbLoad(),
      rounds: roundsLoad(),
      players: playersLoad(),
    };
  });

  expect(result.migratedTours[0].courses).toEqual([{ name: 'Testbanan', maxRounds: 1 }]);
  expect(result.payload.version).toBe(1);
  expect(result.imported).toEqual({ addedCourses: 1, addedRounds: 1, addedPlayers: 1 });
  expect(result.courses).toEqual(result.payload.courses);
  expect(result.rounds).toEqual(result.payload.rounds);
  expect(result.players).toEqual(result.payload.players);
});

test('renaming a saved player keeps ID-linked history and statistics', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    const rows = Array.from({ length: 9 }, (_, i) => ({
      h: i + 1, par: 4, si: i + 1, strokes: 1,
      score: 5, netto: 4, pts: 2, skipped: false,
    }));
    localStorage.setItem('golf_players_db', JSON.stringify([
      { id: 42, name: 'Henrik', nick: 'Henk', hi: 12.3 },
    ]));
    localStorage.setItem('golf_rounds_db', JSON.stringify([{
      id: 1001, date: '2026-08-01', courseName: 'Testbanan', tee: 'Gul',
      holes: 9, gameMode: 'individual',
      subjects: [{
        playerId: 42, name: 'Gamla smeknamnet', hi: 12.3, ph: 6,
        totalPoints: 18, totalBrutto: 45, rows,
      }],
    }]));
    openPlayerHistory(42);
  });

  await expect(page.locator('#playerHistoryView')).toBeVisible();
  await expect(page.locator('#playerHistoryHeader')).toContainText('Henrik');
  await expect(page.locator('#playerHistoryHeader')).toContainText('Henk');
  await expect(page.locator('#playerHistoryHeader')).toContainText('1 rundor');
  await expect(page.locator('#playerHistoryList')).toContainText('Testbanan');
  await expect(page.locator('#playerHistoryList .player-history-pts').last()).toHaveText('18p');
});

test('installed PWA reloads offline and defers an upgrade during an active round', async ({ page, context }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.evaluate(() => {
    localStorage.setItem('golf_inprogress_round', JSON.stringify({
      savedAt: Date.now(),
      state: { courseName: 'Offlinebanan', holes: 9, scores: [['4', '', '', '', '', '', '', '', '']] },
    }));
  });
  await page.reload();
  await expect(page.locator('#resumeBanner')).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.app-footer')).toContainText('v2.1');
  await expect(page.locator('#resumeBanner')).toBeVisible();
  const missingResource = await page.evaluate(() => fetch('./missing-release-test.js')
    .then(response => ({ resolved: true, ok: response.ok, status: response.status }))
    .catch(() => ({ resolved: false, ok: false, status: 0 })));
  expect(missingResource.ok).toBe(false);
  await expect(page.locator('#step1')).toBeVisible();
  await context.setOffline(false);

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js?release-regression=1');
    watchServiceWorkerRegistration(registration);
  });
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return !!registration.waiting;
  }), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#pwaUpdateNotice')).toBeHidden();

  await page.evaluate(() => inprogressClear());
  await expect(page.locator('#pwaUpdateNotice')).toBeVisible();
  await expect(page.locator('#pwaUpdateNotice')).toContainText('En ny version finns');
  await expect(page.locator('#pwaUpdateNotice button')).toHaveText('Uppdatera nu');
});
