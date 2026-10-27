const { test, expect } = require('@playwright/test');
const api = 'https://golfcalc-sync.golfcalc-sync.workers.dev';
const session = (id, token = id) => ({ apiBase: api, token, user: { id, email: `${id}@example.com` } });

async function openClean(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function cloud(page, getSnapshot, putSnapshot = () => {}) {
  await page.route(`${api}/account/**`, async route => {
    if (new URL(route.request().url()).pathname !== '/account/snapshot') return route.fulfill({ status: 200, json: { tours: [] } });
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, json: { version: 1, data: getSnapshot() } });
    putSnapshot(route.request().postDataJSON().data);
    return route.fulfill({ status: 200, json: { version: 2 } });
  });
}

test('unchanged second device downloads edits and a competing edit requires a choice', async ({ page, browser }) => {
  const other = await browser.newContext();
  const second = await other.newPage();
  let snapshot = { players: [{ id: 1, name: 'Old', hi: 20 }] };
  for (const device of [page, second]) {
    await cloud(device, () => snapshot, data => { snapshot = data; });
    await openClean(device);
    await device.evaluate(s => accountSessionSave(s), session('same'));
    await device.evaluate(() => syncAccountNow({ silent: true }));
  }
  await page.evaluate(async () => { playersSave([{ id: 1, name: 'Updated', hi: 8 }]); await syncAccountNow({ silent: true }); });
  await second.evaluate(() => syncAccountNow({ silent: true }));
  expect(await second.evaluate(() => playersLoad())).toEqual([{ id: 1, name: 'Updated', hi: 8 }]);
  await page.evaluate(async () => { playersSave([{ id: 1, name: 'A edit', hi: 7 }]); await syncAccountNow({ silent: true }); });
  await second.evaluate(async () => { playersSave([{ id: 1, name: 'B edit', hi: 6 }]); await syncAccountNow({ silent: true }); });
  expect(await second.evaluate(() => accountSyncMeta().status)).toBe('conflict');
  expect(snapshot.players[0].name).toBe('A edit');
  await other.close();
});

test('account switch isolates collections and discards an old in-flight download', async ({ page }) => {
  await openClean(page);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`${api}/account/snapshot`, async route => {
    await gate;
    return route.fulfill({ status: 200, json: { version: 1, data: { players: [{ id: 1, name: 'Private A', hi: 8 }] } } });
  });
  await page.evaluate(s => { accountSessionSave(s); playersSave([{ id: 1, name: 'Private A', hi: 8 }]); }, session('a'));
  const pending = page.evaluate(() => syncAccountNow({ silent: true }));
  await page.waitForRequest(`${api}/account/snapshot`);
  await page.evaluate(s => { accountSessionSave(s); playersSave([{ id: 2, name: 'Private B', hi: 10 }]); }, session('b'));
  release(); await pending;
  expect(await page.evaluate(() => playersLoad())).toEqual([{ id: 2, name: 'Private B', hi: 10 }]);
  await page.evaluate(() => logoutAccount());
  expect(await page.evaluate(() => playersLoad())).toEqual([]);
  await page.evaluate(s => accountSessionSave(s), session('a'));
  expect(await page.evaluate(() => playersLoad()[0].name)).toBe('Private A');
});

test('quota failure during a download rolls back and does not report success', async ({ page }) => {
  await cloud(page, () => ({ courses: [{ id: 'remote-course', name: 'Remote' }], players: [{ id: 1, name: 'Remote player', hi: 8 }] }));
  await openClean(page);
  await page.evaluate(s => {
    accountSessionSave(s);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.includes('golf_players_db') && value.includes('Remote player')) throw new DOMException('Quota full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, session('quota'));
  await page.evaluate(() => syncAccountNow({ silent: true }));
  expect(await page.evaluate(() => accountSyncMeta().status)).toBe('error');
  expect(await page.evaluate(() => playersLoad())).toEqual([]);
  expect(await page.evaluate(() => dbLoad())).toEqual([]);
  expect(await page.evaluate(() => window._recoverableAccountSnapshot.players[0].name)).toBe('Remote player');
});

test('saved courses, named score fields, single-hole mode and explicit pickups work', async ({ page }) => {
  await openClean(page);
  await expect(page.locator('.course-group').first()).toBeVisible();
  await page.locator('#courseSearchInput').fill('Binga Golf');
  await page.locator('.cg-tee-btn').filter({ hasText: 'Gul' }).first().click();
  await page.locator('#step2 button', { hasText: 'Nästa' }).click();
  await page.getByLabel('Namn', { exact: true }).fill('Plus golfer');
  await page.locator('#phi_0').fill('-2');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Plus golfer, hål 1, slag' })).toBeVisible();
  await page.getByRole('button', { name: 'Ett hål i taget' }).click();
  await expect(page.locator('#score_0_1')).toBeHidden();
  await page.getByRole('button', { name: 'Nästa hål', exact: true }).click();
  await expect(page.locator('#score_0_1')).toBeVisible();
  await page.getByRole('button', { name: 'Plocka upp, Plus golfer, hål 2', exact: true }).click();
  expect(await page.evaluate(() => state.scores[0][1])).toBe(0);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#step4 button', { hasText: 'Beräkna' }).click();
  await expect(page.locator('#step4')).toBeVisible();
  expect(await page.evaluate(() => roundsLoad())).toHaveLength(0);
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toContain('maximum-scale');
});

test('plus-handicap round goes from browser setup and serialization to Worker validation', async ({ page }) => {
  await openClean(page);
  await page.locator('#courseSearchInput').fill('Binga Golf');
  await page.locator('.cg-tee-btn').filter({ hasText: 'Gul' }).first().click();
  await page.locator('#step2 button', { hasText: 'Nästa' }).click();
  await page.locator('#pname_0').fill('Plus golfer');
  await page.locator('#phi_0').fill('-2');
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  for (let h = 0; h < 9; h++) await page.locator(`#score_0_${h}`).fill('4');
  await page.locator('#step4 button', { hasText: 'Beräkna' }).click();
  const { payload, tour } = await page.evaluate(() => {
    const round = roundsLoad()[0]; round.subjects[0].memberId = 'plus';
    const tour = { status: 'open', startDate: '2026-01-01', endDate: '2026-12-31', members: [{ id: 'plus', name: 'Plus golfer', hi: -2 }],
      courses: [{ id: 'course', name: state.courseName, holes: 9, tees: [{ name: state.teeColor, slope: state.slope, cr: state.cr, par: state.par, hpar: state.hpar, si: state.si }] }] };
    return { payload: GolfTourRules.buildRoundSubmission(round, { tour }), tour };
  });
  const { validateTourRoundSubmission } = await import('../../sync-worker/src/tour-validation.js');
  expect(validateTourRoundSubmission(payload, tour)).toBeNull();
});
