const { test, expect } = require('@playwright/test');
const code = 'ABCD2345';
async function setup(page, role = 'organizer') {
  await page.goto('/index.html');
  await page.evaluate(({ code, role }) => {
    localStorage.clear();
    const rows = Array.from({ length: 9 }, (_, h) => ({ h: h + 1, par: 4, si: h + 1, strokes: 1, score: 5, netto: 4, pts: 2, skipped: false }));
    const course = { id: 'c1', name: 'Testbanan', holes: 9, maxRounds: 3, tees: [{ name: 'Gul', slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,2,3,4,5,6,7,8,9] }] };
    const tour = { revision: 4, name: 'Testtour', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open', bestOfN: null, duplicateCourseRule: 'best', members: [{ id: 'm1', name: 'Ada', hi: 12 }], courses: [course], announcements: [], rounds: [{ id: 'r1', clientRoundId: '123', revision: 1, courseId: 'c1', courseName: 'Testbanan', holes: 9, gameMode: 'individual', playedDate: '2026-08-01', subjects: [{ memberId: 'm1', name: 'Ada', teeName: 'Gul', totalPoints: 18, totalBrutto: 45, rows }] }] };
    roundsSave([{ schemaVersion: 2, id: 123, date: '2026-08-01', courseName: 'Testbanan', tee: 'Gul', holes: 9, slope: 113, cr: 36, par: 36, gameMode: 'individual', note: 'Keep my note', tourRef: { code, syncStatus: 'synced', submissionId: 'r1' }, subjects: [{ memberId: 'm1', playerId: 'local', name: 'Ada', hi: 12, ph: 6, totalPoints: 18, totalBrutto: 45, rows }] }]);
    sharedTourStore.upsert({ code, role, token: 'A'.repeat(43), memberLinks: { local: 'm1' }, tour, contributors: [], activity: [], pendingSubmissions: [] });
    _tourViewMode = 'shared'; _tourViewActiveId = code; renderSharedTourDetail(code); showPrimaryView('tour', 'tourView');
  }, { code, role });
}

test('organizer corrects a hole, updates history and standings, and reads safe audit evidence', async ({ page }) => {
  await setup(page);
  const original = await page.evaluate(code => sharedTourStore.find(code).tour, code);
  const after = structuredClone(original); after.revision = 5;
  Object.assign(after.rounds[0], { revision: 2, correctedAt: Date.now() });
  Object.assign(after.rounds[0].subjects[0], { totalPoints: 17, totalBrutto: 46 });
  Object.assign(after.rounds[0].subjects[0].rows[0], { score: 6, netto: 5, pts: 1 });
  let request;
  await page.route(`**/tour/${code}/rounds/r1`, async route => {
    request = route.request().postDataJSON();
    await route.fulfill({ json: { tour: after, correction: { id: 'a1' } } });
  });
  await page.getByRole('button', { name: 'Korrigera resultat' }).click();
  await page.getByLabel('Antal slag', { exact: true }).fill('6');
  await page.getByLabel('Anledning till korrigeringen').fill('Fel på hål 1');
  await page.getByRole('button', { name: 'Spara korrigering' }).click();
  await expect(page.locator('#tourRoundDialog')).toHaveCount(0);
  expect(request).toMatchObject({ expectedRoundRevision: 1, reason: 'Fel på hål 1', changes: [{ memberId: 'm1', hole: 1, score: 6 }] });
  expect(request.mutationId).toBeTruthy();
  await expect(page.locator('.tour-standing-score').first()).toContainText('17');
  const local = await page.evaluate(() => roundsLoad()[0]);
  expect(local).toMatchObject({ id: 123, note: 'Keep my note', subjects: [{ totalPoints: 17, totalBrutto: 46 }] });
  expect(local.subjects[0].rows[0].score).toBe(6);
  await page.route(`**/tour/${code}/rounds/r1/corrections`, route => route.fulfill({ json: { corrections: [{ at: Date.now(), actorName: 'Owner', reason: '<img src=x onerror=alert(1)>', before: { playedDate: '2026-08-01', subjects: original.rounds[0].subjects }, after: { playedDate: '2026-08-01', subjects: after.rounds[0].subjects } }], nextCursor: null } }));
  await page.getByRole('button', { name: 'Korrigeringshistorik' }).click();
  await expect(page.locator('#tourRoundDialog')).toContainText('Hål 1: 5 → 6');
  await expect(page.locator('#tourRoundDialog')).toContainText('<img src=x');
  await expect(page.locator('#tourRoundDialog img')).toHaveCount(0);
});

test('stale corrections preserve form input and request refresh; contributors cannot correct', async ({ page }) => {
  await setup(page);
  await page.route(`**/tour/${code}/rounds/r1`, route => route.fulfill({ status: 409, json: { error: 'Round changed' } }));
  await page.route(`**/tour/${code}/manage`, route => route.abort());
  await page.getByRole('button', { name: 'Korrigera resultat' }).click();
  await page.getByLabel('Upplockat hål').check();
  await page.getByLabel('Anledning till korrigeringen').fill('Upplockat i stället');
  await page.getByRole('button', { name: 'Spara korrigering' }).click();
  await expect(page.locator('#tourRoundDialog [role=status]')).toContainText('Rundan har ändrats');
  await expect(page.getByLabel('Anledning till korrigeringen')).toHaveValue('Upplockat i stället');
  await expect(page.getByLabel('Upplockat hål')).toBeChecked();
  await page.getByRole('button', { name: 'Stäng', exact: true }).click();
  await page.evaluate(code => { const record = sharedTourStore.find(code); sharedTourStore.upsert({ ...record, role: 'contributor' }); renderSharedTourDetail(code); }, code);
  await expect(page.getByRole('button', { name: 'Korrigera resultat' })).toHaveCount(0);
});

test('an in-flight correction cannot overwrite another account vault', async ({ page }) => {
  await setup(page);
  let release; const held = new Promise(resolve => { release = resolve; });
  let received; const request = new Promise(resolve => { received = resolve; });
  const tour = await page.evaluate(code => sharedTourStore.find(code).tour, code);
  await page.route(`**/tour/${code}/rounds/r1`, async route => { received(); await held; await route.fulfill({ json: { tour: { ...tour, revision: 5 } } }); });
  await page.getByRole('button', { name: 'Korrigera resultat' }).click();
  await page.getByLabel('Antal slag', { exact: true }).fill('6');
  await page.getByLabel('Anledning till korrigeringen').fill('Correction A');
  await page.getByRole('button', { name: 'Spara korrigering' }).click(); await request;
  await page.evaluate(() => accountSessionSave({ apiBase: 'https://other.test', token: 'B'.repeat(43), user: { id: 'other' } }));
  release(); await expect(page.locator('#tourRoundDialog')).toHaveCount(0);
  expect(await page.evaluate(() => roundsLoad())).toEqual([]);
  expect(await page.evaluate(() => sharedTourStore.load())).toEqual([]);
});

test('opt-in review counts only confirmed rounds and supports audited reopening', async ({ page }) => {
  await setup(page);
  await page.evaluate(code => { const record = sharedTourStore.find(code); record.tour.approvalRequired = true; record.tour.rounds[0].approvalStatus = 'provisional'; record.tour.provisionalRounds = record.tour.rounds; record.tour.rounds = []; sharedTourStore.upsert(record); renderSharedTourDetail(code); }, code);
  await expect(page.locator('.tour-standing-row')).toHaveCount(0);
  await expect(page.locator('#tourContent')).toContainText('Preliminär – väntar på granskning');
  const original = await page.evaluate(code => sharedTourStore.find(code).tour, code);
  let request;
  await page.route(`**/tour/${code}/rounds/r1`, async route => {
    request = route.request().postDataJSON(); const tour = structuredClone(original);
    tour.revision++; Object.assign(tour.rounds[0], { revision: request.expectedRoundRevision + 1, approvalStatus: request.approvalStatus });
    tour.provisionalRounds = tour.rounds.filter(round => round.approvalStatus !== 'confirmed');
    tour.rounds = tour.rounds.filter(round => round.approvalStatus === 'confirmed');
    await route.fulfill({ json: { tour } });
  });
  await page.getByRole('button', { name: 'Granska och godkänn', exact: true }).click();
  const dialog = page.locator('#tourRoundDialog');
  await expect(dialog.getByRole('columnheader', { name: 'Erhållna slag' })).toBeVisible();
  await dialog.getByLabel('Kommentar till godkännandet').fill('Kontrollerat mot scorekort');
  await dialog.getByRole('button', { name: 'Godkänn runda', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(request).toMatchObject({ expectedRoundRevision: 1, approvalStatus: 'confirmed', reason: 'Kontrollerat mot scorekort' });
  await expect(page.locator('.tour-standing-score').first()).toContainText('18');
  expect(await page.evaluate(() => roundsLoad()[0].tourRef.approvalStatus)).toBe('confirmed');
  await page.getByRole('button', { name: 'Återöppna granskning', exact: true }).click();
  await dialog.getByLabel('Anledning till återöppning').fill('Dubbelkontroll behövs');
  await dialog.getByRole('button', { name: 'Återöppna granskning', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.tour-standing-row')).toHaveCount(0);
  expect(await page.evaluate(() => roundsLoad()[0].tourRef.approvalStatus)).toBe('provisional');
  await page.evaluate(code => { _spectatorTour = sharedTourStore.find(code).tour; _tourViewMode = 'spectator'; renderSpectatorTourDetail(code); }, code);
  await expect(page.locator('#tourContent')).toContainText('Endast godkända rundor räknas i ställningen');
  await expect(page.locator('.tour-standing-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Granska och godkänn', exact: true })).toHaveCount(0);
});

test('approval policy is selectable only before the first submitted round', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: '✎ Redigera villkor' }).click();
  await expect(page.getByLabel('Kräv organisatörens godkännande av rundor')).toBeDisabled();
  await page.evaluate(code => { const record = sharedTourStore.find(code); record.tour.rounds = []; sharedTourStore.upsert(record); renderSharedTourDetail(code); }, code);
  await expect(page.getByLabel('Kräv organisatörens godkännande av rundor')).toBeEnabled();
  await page.getByLabel('Kräv organisatörens godkännande av rundor').check();
  let payload;
  await page.route(`**/tour/${code}/conditions`, async route => { payload = route.request().postDataJSON(); const tour = await page.evaluate(code => sharedTourStore.find(code).tour, code); await route.fulfill({ json: { ...tour, revision: tour.revision + 1, approvalRequired: payload.approvalRequired } }); });
  await page.getByRole('button', { name: 'Spara villkor' }).click();
  await expect(page.locator('#sharedTourEditApproval')).toHaveCount(0); expect(payload.approvalRequired).toBe(true);
});
