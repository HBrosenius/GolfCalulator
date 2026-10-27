const { test, expect } = require('@playwright/test');
async function chooseCourse(page) {
  await page.locator('#courseSearchInput').fill('Binga Golf');
  await page.locator('.cg-tee-btn').filter({ hasText: 'Gul' }).first().click();
  await page.locator('#step2 button', { hasText: 'Nästa' }).click();
  await page.locator('#pname_0').fill('Ada');
  await page.locator('#phi_0').fill('10');
}
async function openScore(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await chooseCourse(page);
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await page.evaluate(() => checkpointDrafts());
}
async function finish(page) {
  for (let h = 0; h < 9; h++) await page.locator(`#score_0_${h}`).fill('4');
  await page.locator('#step4 button', { hasText: 'Beräkna' }).click();
  await expect(page.locator('#step5')).toBeVisible();
}

test('multiple named drafts survive starting another round, reload and resume', async ({ page }) => {
  await openScore(page);
  await page.locator('#roundDraftName').fill('Morning'); await page.locator('#roundDraftName').press('Tab');
  await page.locator('#score_0_0').fill('4');
  await page.getByRole('button', { name: 'Pausa och börja en ny runda' }).click();
  await expect(page.locator('#step1')).toBeVisible();
  await chooseCourse(page); await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await page.locator('#roundDraftName').fill('Afternoon'); await page.locator('#roundDraftName').press('Tab');
  await page.locator('#score_0_0').fill('6');
  await page.evaluate(() => checkpointDrafts());
  expect(await page.evaluate(async () => (await recoveryStore.list(recoveryScope())).drafts.length)).toBe(2);
  await page.reload();
  await page.locator('#roundDraftsList button').filter({ hasText: /^Morning ·/ }).click();
  await expect(page.locator('#score_0_0')).toHaveValue('4');
  await expect(page.locator('#roundDraftName')).toHaveValue('Morning');
  await page.getByRole('navigation').getByRole('button', { name: '⛳ Spela', exact: true }).click();
  await page.locator('#roundDraftsList button').filter({ hasText: /^Afternoon ·/ }).click();
  await expect(page.locator('#score_0_0')).toHaveValue('6');
});

test('past practice rounds retain their date, complete once and never count in local tours', async ({ page }) => {
  await page.goto('/index.html'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.evaluate(() => {
    playersSave([{ id: 1, name: 'Ada', hi: 10 }]);
    toursSave([{ id: 1, name: 'Summer', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', roster: [1], courses: [{ name: 'Binga Golf', holes: 9, maxRounds: 10 }], bestOfN: null, duplicateCourseRule: 'best' }]);
  });
  await chooseCourse(page); await page.locator('#ppicker_0').selectOption('1');
  await page.locator('#roundPlayedDate').fill('2026-05-15');
  await page.locator('#roundKind').selectOption('practice');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#roundDetailsSummary')).toContainText('2026-05-15');
  expect(await page.evaluate(async () => (await recoveryStore.list(recoveryScope())).drafts[0].status)).toBe('draft');
  await finish(page);
  const result = await page.evaluate(async () => ({ round: roundsLoad()[0], drafts: (await recoveryStore.list(recoveryScope())).drafts,
    matches: GolfTourRules.matchingRounds(toursLoad()[0], roundsLoad(), playersLoad()) }));
  expect(result.round).toMatchObject({ date: '2026-05-15', roundKind: 'practice', lifecycle: 'completed' });
  expect(result.drafts).toHaveLength(0); expect(result.matches).toHaveLength(0);
  await page.locator('#step5 button', { hasText: 'Ändra score' }).click();
  await page.locator('#score_0_0').fill('5');
  await page.locator('#step4 button', { hasText: 'Beräkna' }).click();
  await expect(page.locator('#step5')).toBeVisible();
  expect(await page.evaluate(() => roundsLoad().length)).toBe(1);
});

test('trash restore creates a portable local copy without undoing tombstones or resubmitting tours', async ({ page }) => {
  await openScore(page); await finish(page);
  const oldId = await page.evaluate(() => roundsLoad()[0].id);
  await page.evaluate(() => openHistory());
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.hi-del').click();
  await expect(page.locator('#roundTrashList button').filter({ hasText: /^Återställ/ })).toBeVisible();
  expect(await page.evaluate(() => roundsLoad())).toHaveLength(0);
  await page.locator('#roundTrashList button').filter({ hasText: /^Återställ/ }).click();
  await expect.poll(() => page.evaluate(() => roundsLoad().length)).toBe(1);
  const result = await page.evaluate(() => ({ round: roundsLoad()[0], deletions: roundDeletionsLoad(),
    valid: GolfValidation.isBackupPayload(_buildDataPayload(true, true, true, true)) }));
  expect(result.round.id).not.toBe(oldId);
  expect(result.round).toMatchObject({ restoredFrom: String(oldId), tourRef: null, liveRoomCode: null });
  expect(result.deletions.some(item => item.id === String(oldId))).toBe(true);
  expect(result.valid).toBe(true);
});

test('stale edits from a second tab create a conflict copy rather than overwriting the other draft', async ({ page, context }) => {
  await openScore(page); await page.locator('#score_0_0').fill('4'); await page.evaluate(() => checkpointDrafts());
  const second = await context.newPage(); await second.goto('/index.html');
  await second.getByRole('button', { name: /Fortsätt rundan/ }).click();
  await expect(second.locator('#score_0_0')).toHaveValue('4');
  await second.locator('#score_0_0').fill('6'); await second.evaluate(() => checkpointDrafts());
  await page.locator('#score_0_0').fill('8'); await page.evaluate(() => checkpointDrafts());
  const scores = await page.evaluate(async () => (await recoveryStore.list(recoveryScope())).drafts.map(draft => draft.state.scores[0][0]).sort());
  expect(scores).toEqual([6,8]);
  await expect(page.locator('#draftSaveStatus')).toContainText('konfliktkopia');
  await second.close();
});

test('a failed IndexedDB save preserves the earlier record and the latest recovery checkpoint', async ({ page }) => {
  await openScore(page); await page.locator('#score_0_0').fill('4'); await page.evaluate(() => checkpointDrafts());
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'vaults') throw new DOMException('Quota full', 'QuotaExceededError'); return original.apply(this, args); };
  });
  await page.locator('#score_0_0').fill('8');
  await expect(page.locator('#draftSaveStatus')).toContainText('Kunde inte spara');
  expect(await page.evaluate(async () => (await recoveryStore.list(recoveryScope())).drafts[0].state.scores[0][0])).toBe(4);
  await page.reload();
  await page.getByRole('button', { name: /Fortsätt rundan/ }).click();
  await expect(page.locator('#score_0_0')).toHaveValue('8');
});

test('draft vaults remain separated when accounts change', async ({ page }) => {
  await openScore(page); await page.locator('#score_0_0').fill('4'); await page.evaluate(() => checkpointDrafts());
  const guestScope = await page.evaluate(() => recoveryScope());
  await page.evaluate(() => accountSessionSave({ apiBase: 'https://golfcalc-sync.golfcalc-sync.workers.dev', token: 'a'.repeat(43), user: { id: 'account-a', email: 'a@example.com' } }));
  expect(await page.evaluate(async () => (await recoveryStore.list(recoveryScope())).drafts.length)).toBe(0);
  expect(await page.evaluate(async scope => (await recoveryStore.list(scope)).drafts.length, guestScope)).toBe(1);
  await page.evaluate(() => { accountSessionSave(null); goToStep(1); });
  await expect(page.locator('#roundDraftsList button').filter({ hasText: /Pågående/ })).toBeVisible();
});
