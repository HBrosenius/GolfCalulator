const { test, expect } = require('@playwright/test');

test('select course, score two players, finish and find the saved round', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => {
    playersSave([{ id: 1, name: 'Ada', hi: 10 }, { id: 2, name: 'Bo', hi: 20 }]);
    toursSave([{ id: 99, name: 'Vanliga rundor-touren', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', roster: [1,2], courses: [{ name: 'Binga Golf', holes: 9, maxRounds: 20 }], duplicateCourseRule: 'best', bestOfN: null }]);
  });

  await page.locator('#courseSearchInput').fill('Binga Golf');
  const course = page.locator('.course-group').filter({ hasText: 'Binga Golf' });
  await course.locator('.cg-tee-btn').filter({ hasText: 'Gul' }).click();

  await expect(page.locator('#step2')).toBeVisible();
  await expect(page.locator('#step2CourseInfo')).toContainText('Binga Golf');
  await page.locator('#step2 button', { hasText: 'Nästa' }).click();

  await page.locator('#btnP2').click();
  await page.locator('#pname_0').fill('Ada');
  await page.locator('#phi_0').fill('10');
  await page.locator('#pname_1').fill('Bo');
  await page.locator('#phi_1').fill('20');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();

  await expect(page.locator('#step4')).toBeVisible();
  await expect(page.locator('#tourQualificationNotice')).toContainText('Vanliga rundor-touren');
  for (let hole = 0; hole < 9; hole++) {
    await page.locator(`#score_0_${hole}`).fill('4');
    await page.locator(`#score_1_${hole}`).fill('5');
  }
  await page.locator('#step4 button', { hasText: 'Beräkna' }).click();

  await expect(page.locator('#step5')).toBeVisible();
  await expect(page.locator('#rankingContainer')).toContainText('Ada');
  await expect(page.locator('#rankingContainer')).toContainText('Bo');
  await expect(page.locator('#rankingContainer .rank-pts')).toHaveCount(2);
  await expect(page.locator('#rankingContainer')).toContainText('36 slag');
  await expect(page.locator('#rankingContainer')).toContainText('45 slag');

  const savedRounds = await page.evaluate(() => JSON.parse(localStorage.getItem('golf_rounds_db') || '[]'));
  expect(savedRounds).toHaveLength(1);
  expect(savedRounds[0].courseName).toBe('Binga Golf');
  expect(savedRounds[0].subjects.map(subject => subject.name)).toEqual(['Ada', 'Bo']);

  await page.locator('#step5 button', { hasText: 'Ny runda' }).click();
  await page.locator('[data-primary-nav="rounds"]').click();
  await expect(page.locator('#historyView')).toBeVisible();
  await expect(page.locator('#historyList')).toContainText('Binga Golf');
  await expect(page.locator('#historyList')).toContainText('Ada');
  await expect(page.locator('#historyList')).toContainText('36 slag');
  await expect(page.locator('#historyList')).toContainText('45 slag');
});

async function openPlayerSetup(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#courseSearchInput').fill('Binga Golf');
  await page.locator('.course-group').filter({ hasText: 'Binga Golf' })
    .locator('.cg-tee-btn').filter({ hasText: 'Gul' }).click();
  await page.locator('#step2 button', { hasText: 'Nästa' }).click();
}

async function openScorecard(page) {
  await openPlayerSetup(page);
  await page.locator('#pname_0').fill('Ada');
  await page.locator('#phi_0').fill('10');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#step4')).toBeVisible();
}

test('player details survive changing player count and game mode', async ({ page }) => {
  await openPlayerSetup(page);
  await page.locator('#pname_0').fill('Ada');
  await page.locator('#phi_0').fill('10.4');
  await page.locator('#btnP2').click();
  await expect(page.locator('#pname_0')).toHaveValue('Ada');
  await expect(page.locator('#phi_0')).toHaveValue('10.4');
  await page.locator('#pname_1').fill('Bo');
  await page.locator('#phi_1').fill('20');
  await page.locator('#btnModeMatch').click();
  await expect(page.locator('#pname_1')).toHaveValue('Bo');
  await expect(page.locator('#phi_1')).toHaveValue('20');
});

test('round setup rejects a handicap above the supported maximum', async ({ page }) => {
  await openPlayerSetup(page);
  await page.locator('#phi_0').fill('55');
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#step3')).toBeVisible();
  expect(dialogs).toHaveLength(1);
});

test('returning through unchanged setup preserves scores and a single totals row', async ({ page }) => {
  await openScorecard(page);
  await page.locator('#score_0_0').fill('5');
  const points = await page.locator('#tot_0').textContent();
  await page.locator('#step4 button', { hasText: 'Tillbaka' }).click();
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#score_0_0')).toHaveValue('5');
  await expect(page.locator('#scoreTfoot')).toHaveCount(1);
  await expect(page.locator('#tot_0')).toHaveText(points);
  expect(await page.evaluate(() => inprogressLoad().state.scores[0][0])).toBe(5);
});

test('rebuilding the scorecard replaces its totals row', async ({ page }) => {
  await openScorecard(page);
  await page.evaluate(() => { buildScoreTable(); buildScoreTable(); });
  await expect(page.locator('#scoreTfoot')).toHaveCount(1);
});

test('typing 20 keeps both digits on the same hole', async ({ page }) => {
  await openScorecard(page);
  await page.locator('#score_0_0').pressSequentially('20', { delay: 50 });
  await expect(page.locator('#score_0_0')).toHaveValue('20');
  await expect(page.locator('#score_0_1')).toHaveValue('');
  await expect(page.locator('#score_0_1')).toBeFocused();
});

test('score navigation skips remote seats and supports reverse tab', async ({ page }) => {
  await openPlayerSetup(page);
  await page.locator('#btnP2').click();
  await page.locator('#phi_0').fill('10');
  await page.locator('#phi_1').fill('20');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await page.evaluate(() => {
    liveSyncStop();
    state.liveRoomCode = 'TEST';
    state.liveSeat = 0;
    state.liveSeatsClaimed = { 0: true, 1: true };
    buildScoreTable();
  });
  await page.locator('#score_0_0').focus();
  await page.locator('#score_0_0').press('Enter');
  await expect(page.locator('#score_0_1')).toBeFocused();
  await page.locator('#score_0_1').press('Shift+Tab');
  await expect(page.locator('#score_0_0')).toBeFocused();
});

test('changing a scored roster requires confirmation before clearing scores', async ({ page }) => {
  await openScorecard(page);
  await page.locator('#score_0_0').fill('5');
  await page.locator('#step4 button', { hasText: 'Tillbaka' }).click();
  await page.locator('#pname_0').fill('Bo');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#step3')).toBeVisible();
  expect(await page.evaluate(() => state.scores[0][0])).toBe(5);
  expect(await page.evaluate(() => inprogressLoad().state.scores[0][0])).toBe(5);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#step4')).toBeVisible();
  await expect(page.locator('#score_0_0')).toHaveValue('');
});

async function addSelectablePlayers(page) {
  await page.evaluate(() => {
    playersSave([{ id: 101, name: 'Ada', hi: 10 }, { id: 102, name: 'Bo', hi: 20 }]);
    buildPlayerCards();
  });
}

test('rejecting a duplicate saved player preserves the original player identity', async ({ page }) => {
  await openPlayerSetup(page);
  await page.locator('#btnP2').click();
  await addSelectablePlayers(page);
  await page.locator('#ppicker_0').selectOption('101');
  await page.locator('#ppicker_1').selectOption('102');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#ppicker_1').selectOption('101');
  await expect(page.locator('#pname_1')).toHaveValue('Bo');
  expect(await page.evaluate(() => state.playerIds)).toEqual([101, 102]);
  await expect(page.locator('#ppicker_1')).toHaveValue('102');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  expect(await page.evaluate(() => state.players.map(player => [player.name, player.playerId])))
    .toEqual([['Ada', 101], ['Bo', 102]]);
});

test('handicap edits retain saved-player links and name edits clear the picker', async ({ page }) => {
  await openPlayerSetup(page);
  await addSelectablePlayers(page);
  await page.locator('#ppicker_0').selectOption('101');
  await page.locator('#phi_0').fill('12');
  expect(await page.evaluate(() => state.playerIds[0])).toBe(101);
  await page.locator('#btnP2').click();
  await expect(page.locator('#ppicker_0')).toHaveValue('101');
  await expect(page.locator('#phi_0')).toHaveValue('12');
  await page.locator('#btnP1').click();
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await page.locator('#score_0_0').fill('5');
  await page.locator('#step4 button', { hasText: 'Tillbaka' }).click();
  await page.locator('#phi_0').fill('14');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#step4')).toBeVisible();
  await expect(page.locator('#score_0_0')).toHaveValue('5');
  expect(await page.evaluate(() => state.players[0])).toMatchObject({ playerId: 101, hi: 14 });
  await page.locator('#step4 button', { hasText: 'Tillbaka' }).click();
  await page.locator('#pname_0').fill('Someone else');
  expect(await page.evaluate(() => state.playerIds[0])).toBeNull();
  await expect(page.locator('#ppicker_0')).toHaveValue('');
});
