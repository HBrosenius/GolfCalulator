const { test, expect } = require('@playwright/test');

test('legacy data loads and export/import preserves all collections', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const result = await page.evaluate(() => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      h: i + 1, par: 4, si: i + 1, strokes: 1, score: 5, netto: 4, pts: 2, skipped: false,
    }));
    const course = {
      name: 'Testbanan', tee: 'Gul', holes: 9, slope: 113, cr: 36, par: 36,
      hpar: Array(9).fill(4), si: [1,2,3,4,5,6,7,8,9],
    };
    const round = {
      schemaVersion: 2, id: 1001, date: '2026-08-09', courseName: 'Testbanan', tee: 'Gul', mixedTees: false,
      holes: 9, slope: 113, cr: 36, par: 36, gameMode: 'individual', note: '', weather: null,
      markers: { ctp: { hole: null, player: '' }, ld: { hole: null, player: '' } }, bets: [],
      liveRoomCode: null, tourRef: null,
      subjects: [{
        playerId: 42, memberId: null, name: 'Ada', hi: 18, ph: 9, tee: 'Gul', slope: 113, cr: 36, par: 36,
        totalPoints: 18, totalBrutto: 45, members: null, memberIds: null, teamId: null, teammate: null, rows,
      }],
    };
    const player = { id: 42, name: 'Ada', hi: 18, photo: null };
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

test('hostile backup values cannot create executable DOM', async ({ page }) => {
  await page.goto('/index.html');
  const result = await page.evaluate(() => {
    localStorage.clear();
    const hostileTee = '\"><img data-x>';
    const payload = {
      version: 1, exportedAt: '2026-08-09T08:00:00.000Z', rounds: [], players: [],
      courses: [{
        name: 'Säker bana', tee: hostileTee, holes: 9, slope: 113, cr: 36, par: 36,
        hpar: Array(9).fill(4), si: [1,2,3,4,5,6,7,8,9],
      }],
    };
    const imported = _applyImportPayload(payload);
    state.courseName = 'Säker bana';
    state.teeColor = null;
    renderTeePresets();
    const button = [...document.querySelectorAll('#teePresetRow [data-tee-index]')]
      .find(element => element.textContent.includes(hostileTee));
    let rejectedExecutableId = false;
    try {
      _applyImportPayload({ ...payload, courses: [], rounds: [{ id: '1);alert(1)//' }] });
    } catch (_) { rejectedExecutableId = true; }
    return {
      imported,
      injectedElement: !!document.querySelector('[data-x]'),
      inlineHandler: button?.getAttribute('onclick') || null,
      renderedText: button?.textContent || '',
      rejectedExecutableId,
    };
  });
  expect(result.imported.addedCourses).toBe(1);
  expect(result.injectedElement).toBe(false);
  expect(result.inlineHandler).toBeNull();
  expect(result.renderedText).toContain('><img data-x>');
  expect(result.rejectedExecutableId).toBe(true);
});

test('renaming a saved player keeps ID-linked history and statistics', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    const rows = Array.from({ length: 9 }, (_, i) => ({
      h: i + 1, par: 4, si: i + 1, strokes: 1,
      score: 5, netto: 4, pts: 2, skipped: false,
    }));
    const player = { id: 'player-42', name: 'Henrik', nick: 'Henk', hi: 12.3 };
    localStorage.setItem('golf_players_db', JSON.stringify([player]));
    localStorage.setItem('golf_rounds_db', JSON.stringify([{
      id: 1001, date: '2026-08-01', courseName: 'Testbanan', tee: 'Gul',
      holes: 9, gameMode: 'individual',
      markers: {
        ctp: { hole: 2, player: 'Nya smeknamnet' },
        ld: { hole: 4, player: 'Nya smeknamnet' },
      },
      subjects: [{
        playerId: 'player-42', name: 'Henk', hi: 12.3, ph: 6,
        totalPoints: 18, totalBrutto: 45, rows,
      }],
    }]));
    roundsLoad();
    localStorage.setItem('golf_players_db', JSON.stringify([
      { ...player, nick: 'Nya smeknamnet' },
    ]));
    openPlayersView();
  });
  await page.getByText('Nya smeknamnet', { exact: false }).click();

  await expect(page.locator('#playerHistoryView')).toBeVisible();
  await expect(page.locator('#playerHistoryHeader')).toContainText('Henrik');
  await expect(page.locator('#playerHistoryHeader')).toContainText('Nya smeknamnet');
  await expect(page.locator('#playerHistoryHeader')).toContainText('1 rundor');
  await expect(page.locator('#playerHistoryList')).toContainText('Testbanan');
  await expect(page.locator('#playerHistoryList')).toContainText('Längsta drive');
  await expect(page.locator('#playerHistoryList')).toContainText('Närmast pinnen');
  await expect(page.locator('#playerHistoryList .player-history-pts').last()).toHaveText('18p');
});

test('a safe pending app update activates without waiting for a banner click', async ({ page }) => {
  await page.goto('/index.html');
  const messages = await page.evaluate(() => {
    localStorage.removeItem('golf_inprogress');
    const sent = [];
    _pendingServiceWorker = { postMessage: message => sent.push(message) };
    _applyingPwaUpdate = false;
    showPendingUpdateIfSafe();
    return { sent, applying: _applyingPwaUpdate };
  });

  expect(messages).toEqual({
    sent: [{ type: 'SKIP_WAITING' }],
    applying: true,
  });
});

test('top navigation separates play, players, rounds, tours and statistics', async ({ page }) => {
  await page.goto('/index.html');
  const nav = page.getByRole('navigation', { name: 'Huvudmeny' });
  await expect(page.locator('#step1').getByRole('button', { name: /Sparade rundor/ })).toHaveCount(0);
  await expect(page.locator('#step1').getByRole('button', { name: /^Spelare$/ })).toHaveCount(0);

  await nav.getByRole('button', { name: /Spelare/ }).click();
  await expect(page.locator('#playersView')).toBeVisible();
  await expect(nav.getByRole('button', { name: /Spelare/ })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('button', { name: /Rundor/ }).click();
  await expect(page.locator('#historyView')).toBeVisible();

  await nav.getByRole('button', { name: /Tour/ }).click();
  await expect(page.locator('#tourView')).toBeVisible();

  await nav.getByRole('button', { name: /Statistik/ }).click();
  await expect(page.locator('#statisticsView')).toBeVisible();
  await expect(page.locator('#statisticsView')).toContainText('Säsong');
  await expect(page.locator('#statisticsView')).toContainText('Hall of Fame');
  await expect(page.locator('#statisticsView')).toContainText('Banrekord');

  await page.locator('#statisticsView').getByRole('button', { name: /Säsong/ }).click();
  await expect(page.locator('#seasonView')).toBeVisible();
  await page.locator('#seasonView').getByRole('button').first().click();
  await expect(page.locator('#statisticsView')).toBeVisible();

  await nav.locator('[data-primary-nav="play"]').click();
  await expect(page.locator('#step1')).toBeVisible();
  await expect(page.locator('#stepIndicator')).toBeVisible();
});

test('magic-link sign-in preserves local use and uploads a merged cloud snapshot', async ({ page }) => {
  let uploaded = null;
  let uploadCount = 0;
  let exchangeBody = null;
  await page.addInitScript(() => {
    localStorage.setItem('golf_players_db', JSON.stringify([{ id: 'local-player', name: 'Ada', hi: 12 }]));
  });
  await page.route('https://golfcalc-sync.golfcalc-sync.workers.dev/account/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/account/exchange') {
      exchangeBody = JSON.parse(route.request().postData());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        sessionToken: 's'.repeat(43), expiresAt: Date.now() + 60_000,
        user: { id: 'user-1', email: 'ada@example.com', createdAt: Date.now() },
      }) });
    } else if (url.pathname === '/account/profile') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: { displayName: 'Ada', handicap: 12 } }) });
    } else if (url.pathname === '/account/tours') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tours: [] }) });
    } else if (url.pathname === '/account/sessions') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ id: 'session-1', current: true, deviceName: 'Chrome på Windows', deviceType: 'desktop', lastSeenAt: Date.now() }] }) });
    } else if (url.pathname === '/account/security-events') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [{ id: 'event-1', type: 'session_created', at: Date.now(), deviceName: 'Chrome på Windows' }] }) });
    } else if (url.pathname === '/account/snapshot' && route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        version: 0, updatedAt: null, data: { courses: [], rounds: [], players: [], tours: [] },
      }) });
    } else if (url.pathname === '/account/snapshot' && route.request().method() === 'PUT') {
      uploaded = JSON.parse(route.request().postData());
      uploadCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, updatedAt: Date.now() }) });
    } else await route.fulfill({ status: 204 });
  });

  await page.goto(`/index.html#account_token=${'t'.repeat(43)}&account_api=${encodeURIComponent('https://golfcalc-sync.golfcalc-sync.workers.dev')}`);
  await expect(page.locator('#accountView')).toBeVisible();
  await expect(page.locator('#accountContent')).toContainText('ada@example.com');
  await expect(page.locator('#accountDashboard')).toContainText('aktiva sessioner');
  await expect(page.locator('#accountDashboard')).toContainText('Spelarprofil: Ada · HCP 12');
  await expect(page.locator('#accountButton .account-button-label')).toHaveText('Ada');
  await expect(page.locator('#accountButton')).toHaveAttribute('aria-label', /Ada/);
  await expect(page.locator('#accountDashboard')).toContainText('Chrome på Windows · den här');
  await expect(page.locator('#accountDashboard')).toContainText('Kontosäkerhet (1)');
  expect(exchangeBody).toMatchObject({ deviceName: 'Chrome på Windows', deviceType: 'desktop' });
  await expect.poll(() => uploaded).not.toBeNull();
  await expect(page.locator('#accountSyncSummary')).toContainText('Senast synkroniserad');
  const initialUploadCount = uploadCount;
  await page.evaluate(() => playersSave([...playersLoad(), { id: 'new-player', name: 'Bo', hi: 8 }]));
  await expect.poll(() => uploadCount, { timeout: 5000 }).toBeGreaterThan(initialUploadCount);
  await page.getByRole('button', { name: /Synkronisera nu/ }).click();
  await expect(page.locator('#accountStatus')).toContainText('Synkroniseringen är klar');
  expect(uploaded.baseVersion).toBe(0);
  expect(uploaded.data.players).toEqual([
    { id: 'local-player', name: 'Ada', hi: 12 },
    { id: 'new-player', name: 'Bo', hi: 8 },
  ]);
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

test('ongoing local and shared tours appear on the start page', async ({ page }) => {
  const sharedTour = {
    name: 'Aktiv delad tour', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
    bestOfN: 2, duplicateCourseRule: 'best', rounds: [],
    members: [{ id: 'member-1', name: 'Ada', hi: 18 }],
    courses: [{ id: 'course-1', name: 'Testbanan', holes: 9, maxRounds: 1, tees: [{ name: 'Gul' }] }],
  };
  await page.addInitScript(sharedTour => {
    localStorage.clear();
    localStorage.setItem('golf_tours_db', JSON.stringify([
      { id: 1, name: 'Aktiv lokal tour', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', bestOfN: null, duplicateCourseRule: 'best', roster: [], courses: [] },
      { id: 2, name: 'Avslutad tour', startDate: '2025-01-01', endDate: '2025-12-31', status: 'completed', bestOfN: null, duplicateCourseRule: 'best', roster: [], courses: [] },
      { id: 3, name: 'Publicerad lokal kopia', sharedCode: 'ABCD2345', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', bestOfN: null, duplicateCourseRule: 'best', roster: [], courses: [] },
    ]));
    localStorage.setItem('golf_shared_tours_db', JSON.stringify([{
      code: 'ABCD2345', role: 'contributor', token: 'A'.repeat(43), tour: sharedTour, pendingSubmissions: [],
    }]));
  }, sharedTour);
  let sharedFetches = 0;
  await page.route('**/tour/ABCD2345', route => {
    sharedFetches++;
    const refreshed = sharedFetches >= 2 ? {
      ...sharedTour,
      rounds: [{
        id: 'round-live', playedDate: '2026-08-08', courseName: 'Testbanan', holes: 9, gameMode: 'individual',
        subjects: [{ memberId: 'member-1', name: 'Ada', totalPoints: 34 }],
      }],
    } : sharedTour;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(refreshed) });
  });

  await page.goto('/index.html');
  await expect(page.locator('#activeToursCard')).toBeVisible();
  await expect(page.locator('.active-tour-btn')).toHaveCount(2);
  await expect(page.locator('#activeToursCard')).toContainText('Aktiv delad tour');
  await expect(page.locator('#activeToursCard')).toContainText('Aktiv lokal tour');
  await expect(page.locator('#activeToursCard')).not.toContainText('Avslutad tour');
  await expect(page.locator('#activeToursCard')).not.toContainText('Publicerad lokal kopia');

  await page.getByRole('button', { name: /Aktiv delad tour/ }).click();
  await expect(page.locator('#tourView')).toBeVisible();
  await expect(page.locator('#tourContent')).toContainText('Villkor');
  await page.evaluate(() => startSharedTourRefresh('ABCD2345', 50));
  await expect(page.locator('#tourContent')).toContainText('Ada 34p');
  await page.locator('#tourView > .card > div').first().locator('button').click();
  const fetchesAfterClose = sharedFetches;
  await expect(page.locator('#step1')).toBeVisible();
  await expect(page.locator('#activeToursCard')).toBeVisible();
  await page.waitForTimeout(160);
  expect(sharedFetches).toBe(fetchesAfterClose);
});

test('a shared tour invitation lets the contributor select any tour player', async ({ page }) => {
  const code = 'ABCD2345';
  const invitationToken = 'A'.repeat(43);
  const contributorToken = 'B'.repeat(43);
  let joinCalls = 0;
  const tour = {
    protocolVersion: 2, schemaVersion: 1, revision: 1,
    name: 'Delad sommartour', startDate: '2026-06-01', endDate: '2026-08-31', status: 'open',
    bestOfN: 2, duplicateCourseRule: 'first', contributorCount: 1, rounds: [],
    members: [{ id: 'member-ada', name: 'Ada', hi: 18 }, { id: 'member-bo', name: 'Bo', hi: 12 }],
    courses: [{
      id: 'course-1', name: 'Delad bana', holes: 9, maxRounds: 1,
      tees: [{ name: 'Gul', slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17] }],
    }],
  };
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('golf_players_db', JSON.stringify([{ id: 42, name: 'Ada', nick: 'Ace', hi: 18 }]));
  });
  await page.route(`**/tour/${code}/join`, route => {
    joinCalls++;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ tour, contributorId: 'contributor-1', contributorToken }),
    });
  });
  await page.route(`**/tour/${code}/access`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'contributor', contributorId: 'contributor-1' }),
  }));
  await page.route(`**/tour/${code}`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(tour),
  }));

  await page.goto(`/index.html#tour=${code}&invite=${invitationToken}`);
  await expect(page.locator('#tourView')).toBeVisible();
  await expect(page.locator('#tourContent')).toContainText('Delad sommartour');
  await expect(page.locator('#tourContent')).toContainText('Villkor');
  await expect(page.locator('#tourContent')).toContainText('2026-06-01 – 2026-08-31');
  await expect(page.locator('#tourContent')).toContainText('Spelarens bästa 2 rundor');
  await expect(page.locator('#tourContent')).toContainText('De första rundorna upp till banans gräns räknas');
  await expect(page.locator('#tourContent')).toContainText('Individuellt, bästboll och matchspel');
  await expect(page.locator('#tourContent')).toContainText('Inkluderade banor');
  await expect(page.locator('#tourContent')).toContainText('Delad bana');
  await expect(page.locator('#tourContent')).toContainText('9 hål · tee Gul · högst 1 runda räknas');
  await expect(page.locator('#tourContent')).toContainText('Ada');
  await expect(page.locator('#tourContent')).toContainText('Bo');
  await expect(page.locator('#tourContent')).not.toContainText('Spelarkoppling på denna enhet');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await page.evaluate(({ code, invitationToken }) => {
    location.hash = GolfTourSync.invitationFragment(code, invitationToken);
    return acceptSharedTourInvitationIfPresent();
  }, { code, invitationToken });
  expect(joinCalls).toBe(1);

  await page.getByRole('button', { name: '+ Ny tourrunda' }).click();
  await page.locator('#tournamentSetupMembers input[value="0"]').uncheck();
  await page.getByRole('button', { name: 'Fortsätt till scorekortet' }).click();
  await expect(page.locator('#step3')).toBeVisible();
  const context = await page.evaluate(() => ({
    tourCode: state.tourContext?.code,
    savedCourse: dbFind('Delad bana', 'Gul', 9),
    selectedMemberId: state.playerMemberIds[0],
    selectedName: document.getElementById('pname_0').value,
    selectedHi: document.getElementById('phi_0').value,
  }));
  expect(context.tourCode).toBe(code);
  expect(context.savedCourse).toMatchObject({ name: 'Delad bana', tee: 'Gul', holes: 9 });
  expect(context).toMatchObject({ selectedMemberId: 'member-bo', selectedName: 'Bo', selectedHi: '12' });
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

test('shared tour organizer actions remain readable on a dark mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/index.html');
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    sharedTourStore.upsert({
      code: 'ABCD2345', role: 'organizer', token: 'A'.repeat(43), invitationToken: 'B'.repeat(43),
      tour: {
        name: 'Mörk tour', startDate: '2026-06-01', endDate: '2026-08-31', status: 'open', rounds: [],
        members: [{ id: 'member-1', name: 'Ada', hi: 18 }],
        courses: [{ id: 'course-1', name: 'Testbanan', holes: 9, maxRounds: 1, tees: [{ name: 'Gul' }] }],
      },
      contributors: [1, 2, 3].map(index => ({
        id: `device-${index}`, deviceLabel: `Chrome på mobil ${index}`, createdAt: Date.UTC(2026, 6, index), revokedAt: null,
      })), memberLinks: {}, pendingSubmissions: [],
    });
    openSharedTourDetail('ABCD2345');
  });

  const rotate = page.getByRole('button', { name: '🔄 Skapa ny inbjudningslänk' });
  const complete = page.getByRole('button', { name: '✓ Avsluta touren' });
  await expect(rotate).toBeVisible();
  await expect(complete).toBeVisible();
  await expect(page.locator('.tour-revoke-btn')).toHaveCount(3);
  const styles = await page.locator('.tour-admin-actions').evaluate(element => {
    const buttons = [...element.querySelectorAll('button')];
    return {
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      colors: buttons.map(button => ({ background: getComputedStyle(button).backgroundColor, color: getComputedStyle(button).color })),
    };
  });
  expect(styles.columns).toBe(1);
  expect(styles.colors[0]).not.toEqual(styles.colors[1]);
  expect(styles.colors.every(style => style.background !== style.color)).toBe(true);
  const contributorLayout = await page.locator('.tour-contributor-list').evaluate(element => {
    const rows = [...element.querySelectorAll('.tour-contributor-row')];
    const buttons = [...element.querySelectorAll('.tour-revoke-btn')];
    return {
      buttonsFitRows: buttons.every((button, index) => button.getBoundingClientRect().width < rows[index].getBoundingClientRect().width / 2),
      listBottom: element.getBoundingClientRect().bottom,
    };
  });
  const actionsTop = await page.locator('.tour-admin-actions').evaluate(element => element.getBoundingClientRect().top);
  expect(contributorLayout.buttonsFitRows).toBe(true);
  expect(actionsTop).toBeGreaterThanOrEqual(contributorLayout.listBottom);
});

test('organizer can edit published shared-tour conditions', async ({ page }) => {
  const code = 'ABCD2345';
  const token = 'A'.repeat(43);
  const tour = {
    revision: 3, name: 'Sommartour', startDate: '2026-06-01', endDate: '2026-08-31', status: 'open',
    bestOfN: 2, duplicateCourseRule: 'best', rounds: [], members: [{ id: 'member-1', name: 'Ada', hi: 18 }],
    courses: [{ id: 'course-1', name: 'Testbanan', holes: 9, maxRounds: 1, tees: [{ name: 'Gul' }] }],
  };
  let submitted;
  await page.route(`**/tour/${code}/conditions`, async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ...tour, ...submitted, revision: 4,
      courses: tour.courses.map(course => ({ ...course, maxRounds: submitted.courseLimits[0].maxRounds })),
    }) });
  });
  await page.route(`**/tour/${code}/manage`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ tour, contributors: [] }),
  }));
  await page.goto('/index.html');
  await page.evaluate(({ code, token, tour }) => {
    localStorage.clear();
    sharedTourStore.upsert({ code, role: 'organizer', token, tour, pendingSubmissions: [] });
    openSharedTourDetail(code);
  }, { code, token, tour });
  await page.getByRole('button', { name: /Redigera villkor/ }).click();
  await page.locator('#sharedTourEditName').fill('Hösttour');
  await page.locator('#sharedTourEditEnd').fill('2026-09-30');
  await page.locator('#sharedTourEditBest').fill('3');
  await page.locator('#sharedTourEditRule').selectOption('first');
  await page.locator('.shared-tour-course-limit').fill('4');
  await page.getByRole('button', { name: 'Spara villkor' }).click();
  await expect(page.locator('#tourContent')).toContainText('Hösttour');
  expect(submitted).toMatchObject({ expectedRevision: 3, endDate: '2026-09-30', bestOfN: 3, duplicateCourseRule: 'first' });
  expect(submitted.courseLimits).toEqual([{ courseId: 'course-1', maxRounds: 4 }]);
});

test('offline shared-tour submission shows its error and can be retried', async ({ page }) => {
  const code = 'ABCD2345';
  const tour = {
    revision: 1, name: 'Offline-tour', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
    bestOfN: null, duplicateCourseRule: 'best', rounds: [], members: [{ id: 'member-1', name: 'Ada', hi: 18 }],
    courses: [{ id: 'course-1', name: 'Synkbanan', holes: 9, maxRounds: 1, tees: [{ name: 'Gul' }] }],
  };
  await page.route(`**/tour/${code}/rounds`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      tour: { ...tour, revision: 2 }, round: { id: 'server-round-1' }, duplicate: false,
    }),
  }));
  await page.route(`**/tour/${code}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tour) }));
  await page.goto('/index.html');
  await page.evaluate(({ code, tour }) => {
    localStorage.clear();
    sharedTourStore.upsert({
      code, role: 'contributor', token: 'B'.repeat(43), tour,
      pendingSubmissions: [{
        attempts: 2, lastError: 'Nätverket svarar inte',
        payload: { protocolVersion: 2, schemaVersion: 1, clientRoundId: 'round-offline', playedDate: '2026-08-08', courseId: 'course-1' },
      }],
    });
    openSharedTourDetail(code);
  }, { code, tour });
  await expect(page.locator('.tour-sync-panel')).toContainText('1 runda väntar på synkning');
  await expect(page.locator('.tour-sync-panel')).toContainText('Senaste fel: Nätverket svarar inte');
  await page.getByRole('button', { name: 'Försök synka igen' }).click();
  await expect(page.locator('.tour-sync-panel')).toHaveCount(0);
  expect(await page.evaluate(code => sharedTourStore.find(code).pendingSubmissions, code)).toEqual([]);
});

test('ongoing local and shared tours can be cancelled and removed', async ({ page }) => {
  const code = 'ABCD2345';
  const token = 'A'.repeat(43);
  const sharedTour = {
    revision: 1, name: 'Delad att avbryta', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
    completedReason: null, bestOfN: null, duplicateCourseRule: 'best', rounds: [],
    members: [{ id: 'member-1', name: 'Ada', hi: 18 }],
    courses: [{ id: 'course-1', name: 'Testbanan', holes: 9, maxRounds: 1, tees: [{ name: 'Gul' }] }],
  };
  let sharedDeleted = false;
  await page.route(`**/tour/${code}/cancel`, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...sharedTour, revision: 2, status: 'cancelled', completedReason: 'cancelled' }),
  }));
  await page.route(`**/tour/${code}`, route => {
    if (route.request().method() === 'DELETE') {
      sharedDeleted = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sharedTour) });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/index.html');

  await page.evaluate(() => {
    localStorage.clear();
    tourSaveNew({
      id: 101, name: 'Lokal att avbryta', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
      bestOfN: null, duplicateCourseRule: 'best', roster: [], courses: [],
    });
    openTourView();
    openTourDetail(101);
  });
  await page.getByRole('button', { name: 'Avbryt tour', exact: true }).click();
  expect(await page.evaluate(() => tourFind(101).status)).toBe('cancelled');
  await expect(page.locator('#tourContent')).toContainText('Avbruten');
  await page.getByRole('button', { name: 'Ta bort tour', exact: true }).click();
  expect(await page.evaluate(() => tourFind(101))).toBeUndefined();

  await page.evaluate(({ code, token, sharedTour }) => {
    sharedTourStore.upsert({ code, role: 'organizer', token, tour: sharedTour, pendingSubmissions: [] });
    openSharedTourDetail(code);
    stopSharedTourRefresh();
  }, { code, token, sharedTour });
  await page.getByRole('button', { name: /Avbryt touren/ }).click();
  await expect(page.locator('#tourContent')).toContainText('Touren är avbruten');
  await page.getByRole('button', { name: /Ta bort touren permanent/ }).click();
  expect(sharedDeleted).toBe(true);
  expect(await page.evaluate(code => sharedTourStore.find(code), code)).toBeNull();
});

test('participant removal only forgets the shared tour on that device', async ({ page }) => {
  const code = 'ABCD2345';
  let networkMutations = 0;
  await page.route(`**/tour/${code}**`, route => {
    if (route.request().method() !== 'GET') networkMutations++;
    return route.abort();
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/index.html');
  await page.evaluate(code => {
    sharedTourStore.upsert({
      code, role: 'contributor', token: 'B'.repeat(43), pendingSubmissions: [],
      tour: {
        revision: 1, name: 'Deltagartour', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
        bestOfN: null, duplicateCourseRule: 'best', rounds: [], members: [], courses: [],
      },
    });
    openSharedTourDetail(code);
    stopSharedTourRefresh();
  }, code);
  networkMutations = 0;
  await page.getByRole('button', { name: 'Ta bort från den här enheten' }).click();
  expect(await page.evaluate(code => sharedTourStore.find(code), code)).toBeNull();
  expect(networkMutations).toBe(0);
});

test('installed PWA reloads offline and applies a deferred upgrade after an active round', async ({ page, context }) => {
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

  await Promise.all([
    page.waitForNavigation(),
    page.evaluate(() => inprogressClear()),
  ]);
  await expect.poll(() => page.evaluate(async () =>
    !(await navigator.serviceWorker.getRegistration())?.waiting
  ), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#pwaUpdateNotice')).toBeHidden();
});

test('account conflict choices, notification history and privacy controls work end to end', async ({ page }) => {
  const api = 'https://golfcalc-sync.golfcalc-sync.workers.dev';
  const token = 's'.repeat(43);
  let firstSaveAttempted = false;
  let savedData;
  let deleted = false;
  await page.route(`${api}/account/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/account/snapshot' && route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        version: firstSaveAttempted ? 2 : 1, updatedAt: Date.now(),
        data: { courses: [], rounds: [{ id: 'cloud-round' }], players: [], tours: [] },
      }) });
    }
    if (path === '/account/snapshot' && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (!firstSaveAttempted) { firstSaveAttempted = true; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Synkkonflikt', currentVersion: 2 }) }); }
      savedData = body.data;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 3, updatedAt: Date.now() }) });
    }
    if (path === '/account/export') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ format: 'poangbogey-account-export', version: 1, snapshot: { data: savedData || {} } }) });
    if (path === '/account/me' && route.request().method() === 'DELETE') { deleted = true; return route.fulfill({ status: 204 }); }
    if (path === '/account/profile') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"profile":null}' });
    if (path === '/account/tours') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"tours":[]}' });
    if (path === '/account/sessions') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"sessions":[]}' });
    if (path === '/account/security-events') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' });
    if (path === '/account/push') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"preferences":{}}' });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
  });
  await page.addInitScript(({ api, token }) => {
    localStorage.clear();
    localStorage.setItem('golf_account_session', JSON.stringify({ apiBase: api, token, user: { id: 'u1', email: 'ada@example.com' } }));
    localStorage.setItem('golf_rounds_db', JSON.stringify([{ id: 'local-round' }]));
  }, { api, token });
  await page.goto('/index.html');
  await page.evaluate(() => { serviceWorkerNotificationHistory = async () => [{ id: 'n1', title: '<b>Ny runda</b>', body: 'Ada registrerade 36p', url: './index.html#shared_tour=ABCD2345', at: Date.now() }]; openAccountView(); });
  await expect(page.locator('#accountNotificationHistory')).toContainText('<b>Ny runda</b>');
  await expect(page.locator('#accountNotificationHistory b')).toHaveCount(0);
  await page.getByRole('button', { name: '☁️ Synkronisera nu' }).click();
  await expect(page.locator('#accountConflictPanel')).toContainText('Synkkonflikt');
  await page.getByRole('button', { name: 'Slå ihop båda' }).click();
  expect(savedData.rounds.map(round => round.id).sort()).toEqual(['cloud-round', 'local-round']);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Exportera molndata/ }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^poangbogey-cloud-/);

  page.on('dialog', async dialog => dialog.type() === 'prompt' ? dialog.accept('ada@example.com') : dialog.accept());
  await page.getByRole('button', { name: 'Radera konto och molndata' }).click();
  await expect.poll(() => deleted).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('golf_account_session'))).toBeNull();
});

test('first-run onboarding and shared-tour collaboration controls are visible', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/index.html');
  await expect(page.locator('#firstRunCard')).toContainText('Tre saker för att komma igång');
  await page.getByRole('button', { name: 'Jag är redo' }).click();
  await expect(page.locator('#firstRunCard')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('golf_first_run_complete'))).toBe('1');

  await page.evaluate(() => {
    playersSave([{ id: 'local-ada', name: 'Ada Andersson', nick: 'Ace', hi: 12, photo: 'data:image/jpeg;base64,/9j/2Q==' }]);
    dbUpsert({ name: 'Testbanan', tee: 'Gul', holes: 9, slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17] });
    const tour = {
      revision: 4, name: 'Live-tour', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open',
      bestOfN: null, duplicateCourseRule: 'best', members: [{ id: 'm1', name: 'Ada', hi: 12 }],
      courses: [{ id: 'c1', name: 'Testbanan', holes: 9, maxRounds: 3, tees: [{ name: 'Gul', slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17] }] }],
      announcements: [{ id: 'a1', author: 'Admin', message: 'Samling 09:00', at: Date.now() }],
      rounds: [{ id: 'r1', courseName: 'Testbanan', holes: 9, gameMode: 'individual', playedDate: '2026-08-01', subjects: [{ memberId: 'm1', name: 'Ada', totalPoints: 18 }] }],
    };
    sharedTourStore.upsert({ code: 'ABCD2345', role: 'administrator', token: 'A'.repeat(43), memberLinks: { 'local-ada': 'm1' }, tour, contributors: [], activity: [
      { type: 'round_corrected', actorName: 'Admin', actorRole: 'administrator', at: Date.now(), details: { courseName: 'Testbanan', reason: 'Fel datum' } },
    ], pendingSubmissions: [] });
    _tourViewMode = 'shared'; _tourViewActiveId = 'ABCD2345'; renderSharedTourDetail('ABCD2345'); showPrimaryView('tour', 'tourView');
  });
  await expect(page.locator('#tourContent')).toContainText('Samling 09:00');
  await expect(page.locator('.tour-standings')).toContainText('Tourställning');
  await expect(page.locator('.tour-standing-row').first()).toContainText('🥇');
  await expect(page.locator('.tour-standing-row').first()).toContainText('Ada');
  await expect(page.locator('.tour-standing-score').first()).toContainText('18');
  await expect(page.locator('.tour-standing-avatar img').first()).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(page.getByLabel('Filtrera ändringslogg')).toBeVisible();
  await expect(page.locator('#tourContent')).toContainText('anledning: Fel datum');
  await expect(page.getByRole('button', { name: /Dela åskådarlänk/ })).toBeVisible();
  await page.getByRole('button', { name: '+ Ny tourrunda' }).click();
  await expect(page.locator('#tournamentSetup')).toContainText('Starta tourrunda · Live-tour');
  await expect(page.locator('#tournamentSetupMembers input')).toHaveCount(1);
  await page.getByRole('button', { name: 'Avbryt' }).click();
  await page.evaluate(() => { _spectatorTour = sharedTourStore.find('ABCD2345').tour; _tourViewMode = 'spectator'; _tourViewActiveId = 'ABCD2345'; renderSpectatorTourDetail('ABCD2345'); });
  await expect(page.locator('#tourContent')).toContainText('Åskådarläge · live');
  await expect(page.locator('#tourContent')).toContainText('18');
  await expect(page.getByRole('button', { name: '+ Ny tourrunda' })).toHaveCount(0);
  await page.evaluate(() => { _tourViewMode = 'shared'; renderSharedTourDetail('ABCD2345'); });
  await expect(page.getByRole('button', { name: 'Publicera' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Korrigera datum' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Skapa ny inbjudningslänk/ })).toHaveCount(0);
  await page.getByRole('button', { name: '+ Ny tourrunda' }).click();
  await page.getByRole('button', { name: 'Fortsätt till scorekortet' }).click();
  await expect(page.locator('#step3')).toBeVisible();
  await expect(page.locator('#playerCardsContainer input[id^="pname_"][readonly]')).toHaveCount(1);
  await page.locator('#step3').getByRole('button', { name: 'Nästa →' }).click();
  await page.locator('#score_0_0').fill('5');
  await expect(page.locator('#tournamentLivePanel')).toContainText('Prognos efter inmatade hål');
  await expect(page.locator('#tournamentLivePanel')).toContainText('1/9 hål');
  await page.locator('#step4').getByRole('button', { name: /Beräkna/ }).click();
  await expect(page.locator('#step5')).toContainText('Tourpåverkan · Live-tour');
});
