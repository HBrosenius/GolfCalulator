const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const code = 'ABCD2345';
async function setup(page, role = 'organizer') {
  await page.goto('/index.html');
  await page.evaluate(({ code, role }) => {
    localStorage.clear();
    const tour = { revision: 1, scheduleRevision: 0, name: 'Helgtour', status: 'open', startDate: '2026-01-01', endDate: '2026-12-31', bestOfN: null, duplicateCourseRule: 'best', members: [{ id: 'ada', name: 'Ada', hi: 12 }, { id: 'bo', name: 'Bo', hi: 8 }], courses: [{ id: 'course', name: 'Tourbanan', holes: 9, maxRounds: 3, tees: [{ name: 'Gul', slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17] }] }], rounds: [], announcements: [] };
    sharedTourStore.upsert({ code, role, token: 'A'.repeat(43), memberLinks: { 'local-bo': 'bo' }, tour, events: [], eventsRevision: 0, contributors: [], activity: [], pendingSubmissions: [] });
    _tourViewMode = 'shared'; _tourViewActiveId = code; renderSharedTourDetail(code); showPrimaryView('tour', 'tourView');
  }, { code, role });
  const server = { tour: await page.evaluate(code => sharedTourStore.find(code).tour, code), events: [] };
  await page.route(`**/tour/${code}/events`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { events: server.events, scheduleRevision: server.tour.scheduleRevision } });
    const body = route.request().postDataJSON(), event = { ...body.event, id: 'event-1', revision: 1, createdAt: Date.UTC(2026, 7, 1), updatedAt: Date.UTC(2026, 7, 1) };
    server.events = [event]; server.tour.revision++; server.tour.scheduleRevision++;
    await route.fulfill({ status: 201, json: { event, tour: server.tour } });
  });
  await page.route(`**/tour/${code}/events/*`, async route => {
    const body = route.request().postDataJSON(), event = { ...body.event, id: 'event-1', revision: server.events[0].revision + 1, createdAt: server.events[0].createdAt, updatedAt: Date.UTC(2026, 7, 2) };
    server.events = [event]; server.tour.revision++; server.tour.scheduleRevision++; await route.fulfill({ json: { event, tour: server.tour } });
  });
  await page.route(`**/tour/${code}/manage`, route => route.fulfill({ json: { tour: server.tour, contributors: [], activity: [] } }));
  await page.route(`**/tour/${code}/round-starts`, route => route.fulfill({ json: { tour: server.tour } }));
  return server;
}
async function createEvent(page) {
  await page.getByRole('button', { name: 'Ny speldag', exact: true }).click();
  const dialog = page.locator('#tourRoundDialog');
  await dialog.getByLabel('Speldagens namn', { exact: true }).fill('Lördagsgolf');
  await dialog.getByLabel('Speldatum', { exact: true }).fill('2026-08-01');
  await dialog.getByLabel('Tidszon', { exact: true }).fill('Europe/Stockholm');
  const group = dialog.locator('fieldset').first();
  await group.getByLabel('Gruppnamn').fill('Tidig grupp'); await group.getByLabel('Starttid').fill('09:10'); await group.getByLabel('Spelare 1').selectOption('bo');
  await dialog.getByLabel('Information till spelarna').fill('<img src=x onerror=alert(1)> Samling 08:45');
  await dialog.getByRole('button', { name: 'Spara speldag', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.locator('#sharedTourEvents')).toContainText('09:10');
}

test('organizer schedules groups, personal starts and safe calendar export; cancellation retains IDs', async ({ page }) => {
  const server = await setup(page); await createEvent(page);
  expect(server.events[0].groups[0].memberIds).toEqual(['bo']); const groupId = server.events[0].groups[0].id;
  await page.getByLabel('Visa mina starter för').selectOption('bo'); await expect(page.locator('#tourMyStarts')).toContainText('Lördagsgolf · 2026-08-01 09:10');
  await page.getByLabel('Visa mina starter för').selectOption('ada'); await expect(page.locator('#tourMyStarts')).toContainText('ingen tilldelad');
  await expect(page.locator('#sharedTourEvents img')).toHaveCount(0);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Kalender (.ics)', exact: true }).click();
  const file = await download, text = await fs.readFile(await file.path(), 'utf8'); expect(text).toContain('DTSTART:20260801T071000Z'); expect(text).not.toContain('A'.repeat(43)); expect(text).toContain('#shared_tour=ABCD2345');
  await page.getByRole('button', { name: 'Redigera speldag', exact: true }).click();
  const dialog = page.locator('#tourRoundDialog'); await dialog.getByLabel('Schemastatus').selectOption('cancelled'); await dialog.getByRole('button', { name: 'Spara speldag', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('#sharedTourEvents')).toContainText('Inställd'); expect(server.events[0].groups[0].id).toBe(groupId);
  await expect(page.getByRole('button', { name: 'Starta gruppens scorekort', exact: true })).toHaveCount(0);
});

test('group scorecard preselects the scheduled course, players and date while retaining another draft', async ({ page }) => {
  await setup(page); await createEvent(page);
  await page.evaluate(async () => {
    state = { courseName: 'Äldre runda', teeColor: 'Gul', holes: 9, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17], gameMode: 'individual', numPlayers: 1, players: [{ name: 'Ada', hi: 12, playingHandicap: 6 }], scores: [['6', ...Array(8).fill('')]], draftName: 'Bevara mig' };
    inprogressSave(); await checkpointDrafts();
  });
  await page.getByRole('button', { name: 'Starta gruppens scorekort', exact: true }).click();
  await expect(page.locator('#tournamentSetupCourse')).toBeDisabled();
  await expect(page.locator('#tournamentSetupMembers input:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fortsätt till scorekortet' }).click();
  await expect(page.locator('#step3')).toBeVisible(); await expect(page.locator('#pname_0')).toHaveValue('Bo'); await expect(page.locator('#roundPlayedDate')).toHaveValue('2026-08-01');
  await page.locator('#step3').getByRole('button', { name: 'Nästa →', exact: true }).click(); await expect(page.locator('#step4')).toBeVisible();
  const result = await page.evaluate(async () => ({ name: state.courseName, date: state.playedDate, zone: state.tourContext.eventTimeZone, drafts: (await recoveryStore.list(recoveryScope())).drafts }));
  expect(result).toMatchObject({ name: 'Tourbanan', date: '2026-08-01', zone: 'Europe/Stockholm' }); expect(result.drafts.some(draft => draft.name === 'Bevara mig' && draft.state.scores[0][0] === '6')).toBe(true);
});

test('duplicate players and stale updates retain the editor; contributors cannot edit schedules', async ({ page }) => {
  await setup(page); await createEvent(page);
  await page.getByRole('button', { name: 'Redigera speldag', exact: true }).click(); const dialog = page.locator('#tourRoundDialog');
  await dialog.getByRole('button', { name: 'Lägg till grupp', exact: true }).click(); await dialog.locator('fieldset').nth(1).getByLabel('Spelare 1').selectOption('bo');
  await dialog.getByRole('button', { name: 'Spara speldag', exact: true }).click(); await expect(dialog.getByRole('status')).toContainText('endast finnas i en grupp');
  await dialog.locator('fieldset').nth(1).getByRole('button', { name: 'Ta bort grupp', exact: true }).click();
  await page.route(`**/tour/${code}/events/*`, route => route.fulfill({ status: 409, json: { error: 'Schedule changed' } }));
  await dialog.getByLabel('Speldagens namn', { exact: true }).fill('Min ändring'); await dialog.getByRole('button', { name: 'Spara speldag', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Spelschemat har ändrats'); await expect(dialog.getByLabel('Speldagens namn', { exact: true })).toHaveValue('Min ändring');
  await dialog.getByRole('button', { name: 'Stäng', exact: true }).click();
  await page.evaluate(code => { const record = sharedTourStore.find(code); sharedTourStore.upsert({ ...record, role: 'contributor' }); renderSharedTourDetail(code); }, code);
  await expect(page.getByRole('button', { name: 'Ny speldag', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Redigera speldag', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kalender (.ics)', exact: true })).toBeVisible();
});

test('an in-flight schedule save cannot write into a different account', async ({ page }) => {
  const server = await setup(page); let release, received;
  const held = new Promise(resolve => { release = resolve; }), request = new Promise(resolve => { received = resolve; });
  await page.route(`**/tour/${code}/events`, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { events: [], scheduleRevision: 0 } });
    const body = route.request().postDataJSON(); received(); await held;
    await route.fulfill({ status: 201, json: { tour: { ...server.tour, revision: 2, scheduleRevision: 1 }, event: { ...body.event, id: 'event-1', revision: 1, createdAt: Date.now(), updatedAt: Date.now() } } });
  });
  await page.getByRole('button', { name: 'Ny speldag', exact: true }).click(); const dialog = page.locator('#tourRoundDialog');
  await dialog.getByLabel('Speldagens namn', { exact: true }).fill('Account A'); await dialog.getByLabel('Speldatum', { exact: true }).fill('2026-08-01'); await dialog.getByLabel('Tidszon', { exact: true }).fill('Europe/Stockholm');
  await dialog.locator('fieldset').first().getByLabel('Spelare 1').selectOption('ada'); await dialog.getByRole('button', { name: 'Spara speldag', exact: true }).click(); await request;
  await page.evaluate(() => accountSessionSave({ apiBase: 'https://other.test', token: 'B'.repeat(43), user: { id: 'other-account' } })); release(); await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => sharedTourStore.load())).toEqual([]);
});

test('group setup rejects a schedule changed after opening and future starts stay disabled', async ({ page }) => {
  await setup(page); await createEvent(page);
  await page.getByRole('button', { name: 'Starta gruppens scorekort', exact: true }).click();
  await page.evaluate(code => { const record = sharedTourStore.find(code); record.events[0].revision++; sharedTourStore.upsert(record); }, code);
  let message; page.once('dialog', dialog => { message = dialog.message(); dialog.accept(); });
  await page.getByRole('button', { name: 'Fortsätt till scorekortet' }).click(); expect(message).toContain('Speldagen har ändrats'); await expect(page.locator('#tournamentSetup')).toBeVisible();
  await page.getByRole('button', { name: 'Avbryt', exact: true }).click();
  await page.evaluate(code => { const record = sharedTourStore.find(code); record.events[0].date = '2026-12-31'; sharedTourStore.upsert(record); renderSharedTourDetail(code); }, code);
  await expect(page.getByRole('button', { name: 'Starta gruppens scorekort', exact: true })).toBeDisabled();
});
