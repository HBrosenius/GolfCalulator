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
    const player = { id: 42, name: 'Henrik', nick: 'Henk', hi: 12.3 };
    localStorage.setItem('golf_players_db', JSON.stringify([player]));
    localStorage.setItem('golf_rounds_db', JSON.stringify([{
      id: 1001, date: '2026-08-01', courseName: 'Testbanan', tee: 'Gul',
      holes: 9, gameMode: 'individual',
      subjects: [{
        name: 'Henk', hi: 12.3, ph: 6,
        totalPoints: 18, totalBrutto: 45, rows,
      }],
    }]));
    roundsLoad(); // migrates the unambiguous legacy name to playerId 42
    localStorage.setItem('golf_players_db', JSON.stringify([
      { ...player, nick: 'Nya smeknamnet' },
    ]));
    openPlayerHistory(42);
  });

  await expect(page.locator('#playerHistoryView')).toBeVisible();
  await expect(page.locator('#playerHistoryHeader')).toContainText('Henrik');
  await expect(page.locator('#playerHistoryHeader')).toContainText('Nya smeknamnet');
  await expect(page.locator('#playerHistoryHeader')).toContainText('1 rundor');
  await expect(page.locator('#playerHistoryList')).toContainText('Testbanan');
  await expect(page.locator('#playerHistoryList .player-history-pts').last()).toHaveText('18p');
});

test('a live joiner can link their seat to a local saved player', async ({ page }) => {
  await page.goto('/index.html');
  const linked = await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('golf_players_db', JSON.stringify([
      { id: 42, name: 'Lokala Ada', nick: 'Ace', hi: 18 },
    ]));
    const room = {
      courseName: 'Livebanan', teeColor: 'Gul', holes: 9,
      slope: 113, cr: 36, par: 36,
      hpar: Array(9).fill(4), si: [1,2,3,4,5,6,7,8,9],
      gameMode: 'individual', teams: null,
      players: [{ name: 'Ada på värdens mobil', hi: 18, tee: 'Gul' }],
      seats: [{ scores: Array(9).fill(''), claimed: false }],
      markers: { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } },
      note: '', weather: null, bets: [],
    };
    renderJoinLiveSeatList(room, 'ABCD');
    document.getElementById('joinLivePlayerSelect').value = '42';
    buildStateFromRoom(room, 'ABCD', 0, 'seat-token', 42);
    return {
      playerId: state.players[0].playerId,
      slotId: state.playerIds[0],
      selectorVisible: !document.getElementById('joinLivePlayerLink').classList.contains('hidden'),
    };
  });

  expect(linked).toEqual({ playerId: 42, slotId: 42, selectorVisible: true });
});

test('a shared tour invitation links a local member and starts a connected round', async ({ page }) => {
  const code = 'ABCD2345';
  const invitationToken = 'A'.repeat(43);
  const contributorToken = 'B'.repeat(43);
  const tour = {
    protocolVersion: 2, schemaVersion: 1, revision: 1,
    name: 'Delad sommartour', startDate: '2026-06-01', endDate: '2026-08-31', status: 'open',
    bestOfN: null, duplicateCourseRule: 'best', contributorCount: 1, rounds: [],
    members: [{ id: 'member-ada', name: 'Ada', hi: 18 }],
    courses: [{
      id: 'course-1', name: 'Delad bana', holes: 9, maxRounds: 1,
      tees: [{ name: 'Gul', slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,2,3,4,5,6,7,8,9] }],
    }],
  };
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('golf_players_db', JSON.stringify([{ id: 42, name: 'Ada', nick: 'Ace', hi: 18 }]));
  });
  await page.route(`**/tour/${code}/join`, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ tour, contributorId: 'contributor-1', contributorToken }),
  }));
  await page.route(`**/tour/${code}`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(tour),
  }));

  await page.goto(`/index.html#tour=${code}&invite=${invitationToken}`);
  await expect(page.locator('#tourView')).toBeVisible();
  await expect(page.locator('#tourContent')).toContainText('Delad sommartour');
  await expect(page.locator('#tourContent')).toContainText('Inkluderade banor');
  await expect(page.locator('#tourContent')).toContainText('Delad bana');
  await expect(page.locator('#tourContent')).toContainText('9 hål · tee Gul · högst 1 runda räknas');
  await expect(page.locator('#tourContent select')).toHaveValue('42');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');

  await page.getByRole('button', { name: '+ Ny tourrunda' }).click();
  const context = await page.evaluate(() => ({
    tourCode: state.tourContext?.code,
    savedCourse: dbFind('Delad bana', 'Gul', 9),
  }));
  expect(context.tourCode).toBe(code);
  expect(context.savedCourse).toMatchObject({ name: 'Delad bana', tee: 'Gul', holes: 9 });
});

test('an invited contributor saves and synchronizes a completed tour round', async ({ page }) => {
  const code = 'ABCD2345';
  const token = 'B'.repeat(43);
  const rows = Array.from({ length: 9 }, (_, index) => ({
    h: index + 1, par: 4, si: index + 1, strokes: 1,
    score: 5, netto: 4, pts: 2, skipped: false,
  }));
  const tour = {
    revision: 1, name: 'Delad tour', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
    members: [{ id: 'member-ada', name: 'Ada', hi: 18 }], rounds: [],
    courses: [{ id: 'course-1', name: 'Synkbanan', holes: 9, maxRounds: 1, tees: [{ name: 'Gul' }] }],
  };
  let authorization;
  await page.route(`**/tour/${code}/rounds`, async route => {
    const request = route.request();
    authorization = request.headers().authorization;
    const payload = request.postDataJSON();
    const serverRound = {
      id: 'submission-1', clientRoundId: payload.clientRoundId, playedDate: payload.playedDate,
      courseId: 'course-1', courseName: 'Synkbanan', holes: 9, gameMode: 'individual', subjects: payload.subjects,
    };
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ tour: { ...tour, revision: 2, rounds: [serverRound] }, round: serverRound, duplicate: false }),
    });
  });
  await page.goto('/index.html');
  await page.evaluate(({ code, token, tour, rows }) => {
    localStorage.clear();
    sharedTourStore.upsert({
      code, role: 'contributor', token, tour, memberLinks: { 42: 'member-ada' }, pendingSubmissions: [],
    });
    state = {
      courseName: 'Synkbanan', teeColor: 'Gul', holes: 9, slope: 113, cr: 36, par: 36,
      hpar: Array(9).fill(4), si: [1,2,3,4,5,6,7,8,9], gameMode: 'individual',
      note: '', weather: null, markers: { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } },
      bets: [], liveRoomCode: null, tourContext: { code, submissionOwner: true },
    };
    saveCurrentRound([{
      subj: { playerId: 42, name: 'Ada', hi: 18, tee: 'Gul', slope: 113, cr: 36, par: 36 },
      ph: 9, totalPoints: 18, totalBrutto: 45, rows,
    }]);
  }, { code, token, tour, rows });

  await expect.poll(() => page.evaluate(() => roundsLoad()[0]?.tourRef?.syncStatus)).toBe('synced');
  const saved = await page.evaluate(() => roundsLoad()[0]);
  expect(saved.tourRef.submissionId).toBe('submission-1');
  expect(authorization).toBe(`Bearer ${token}`);
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
