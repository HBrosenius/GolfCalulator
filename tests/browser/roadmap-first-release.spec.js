const { test, expect } = require('@playwright/test');
const code = 'ABCD2345EFGH6789JKMN';

async function setupPlayers(page) {
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => playersSave([{ id: 1, name: 'Ada', hi: 10 }, { id: 2, name: 'Bo', hi: 20 }]));
  await page.locator('#courseSearchInput').fill('Binga Golf');
  await page.locator('.cg-tee-btn').filter({ hasText: 'Gul' }).first().click();
  await page.locator('#step2 button', { hasText: 'Nästa' }).click();
  await page.locator('#btnP2').click();
  await page.locator('#ppicker_0').selectOption('1');
  await page.locator('#ppicker_1').selectOption('2');
}

test('saved group survives reload and backup, refreshes handicaps and retains tee choices', async ({ page }) => {
  await setupPlayers(page);
  const secondTee = await page.locator('#ptee_1 option').last().getAttribute('value');
  await page.locator('#ptee_1').selectOption(secondTee);
  await page.locator('#savedSetupName').fill('Torsdagsgolf');
  await page.getByRole('button', { name: 'Spara spelgrupp', exact: true }).click();
  await expect(page.locator('#savedSetupStatus')).toContainText('är sparad');
  const id = await page.evaluate(() => setupsLoad()[0].id);
  const backup = await page.evaluate(() => _buildDataPayload(true, false, true));
  expect(backup.setups).toHaveLength(1);
  await page.evaluate(() => playersSave([{ id: 1, name: 'Nya Ada', hi: -2 }, { id: 2, name: 'Bo', hi: 18 }]));
  await page.reload();
  await page.locator('#savedSetupsList button').filter({ hasText: 'Torsdagsgolf' }).click();
  await expect(page.locator('#step3')).toBeVisible();
  await expect(page.locator('#phi_0')).toHaveValue('-2');
  await expect(page.locator('#pname_0')).toHaveValue('Nya Ada');
  await expect(page.locator('#ptee_1')).toHaveValue(secondTee);
  await expect(page.locator('#setupReviewNotice')).toContainText('Kontrollera dagens handicapindex');
  expect(await page.evaluate(() => state.scores)).toEqual([]);
  await page.locator('#step3 button', { hasText: 'Tillbaka' }).click();
  await page.evaluate(() => expandHoleData());
  await page.locator('#parbtn_0_3').click();
  const compensate = await page.evaluate(() => state.hpar.findIndex((par, index) => index > 0 && par === 3));
  await page.locator(`#parbtn_${compensate}_4`).click();
  await page.locator('#step2 button', { hasText: 'Nästa' }).click();
  expect(await page.evaluate(() => teeData(state.teeColor).hpar[0])).toBe(3);
  await page.evaluate(() => { storageDb.remove(SETUPS_KEY); _applyImportPayload(_buildDataPayload(true, false, true)); });
  await page.evaluate(backup => _applyImportPayload(backup), backup);
  expect(await page.evaluate(() => setupsLoad()[0].id)).toBe(id);
});

test('play again creates a fresh round while preserving the original and reviewing current handicap', async ({ page }) => {
  await setupPlayers(page);
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  for (let hole = 0; hole < 9; hole++) {
    await page.locator(`#score_0_${hole}`).fill('4');
    await page.locator(`#score_1_${hole}`).fill('5');
  }
  await page.locator('#step4 button', { hasText: 'Beräkna' }).click();
  const original = await page.evaluate(() => roundsLoad()[0]);
  await page.evaluate(() => { playersSave([{ id: 1, name: 'Ada', hi: 8 }, { id: 2, name: 'Bo', hi: 18 }]); openHistory(); });
  await page.getByRole('button', { name: /^Visa detaljer för/ }).click();
  await page.getByRole('button', { name: 'Spela igen med uppställningen' }).click();
  await expect(page.locator('#phi_0')).toHaveValue('8');
  expect(await page.evaluate(() => state.editingId || null)).toBeNull();
  expect(await page.evaluate(() => state.liveSeatToken)).toBeNull();
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  await expect(page.locator('#score_0_0')).toHaveValue('');
  expect(await page.evaluate(() => roundsLoad()[0])).toEqual(original);
});

test('points and playing handicap explanations are keyboard accessible and distinguish pickup', async ({ page }) => {
  await setupPlayers(page);
  await page.locator('#phi_0').fill('-2');
  await page.getByRole('button', { name: 'Förklara spelhandicap för spelare 1', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Handicapindex -2');
  await expect(dialog).toContainText('9 hål:');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Förklara spelhandicap för spelare 1', exact: true })).toBeFocused();
  await page.locator('#step3 button', { hasText: 'Nästa' }).click();
  const explain = page.getByRole('button', { name: 'Förklara poäng för Ada, hål 1', exact: true });
  await explain.focus(); await page.keyboard.press('Enter');
  await expect(dialog).toContainText('inte färdigspelat');
  await page.keyboard.press('Escape');
  await page.locator('#score_0_0').fill('4');
  await explain.click();
  await expect(dialog).toContainText('Bruttoscore 4');
  await expect(dialog).toContainText('Poängbogey: max');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Plocka upp, Ada, hål 1', exact: true }).click();
  await explain.click();
  await expect(dialog).toContainText('Hålet är upplockat');
});

test('host invitation creates a private QR/link and emits the Worker create contract', async ({ page }) => {
  const { validateCreate } = await import('../../sync-worker/src/validation.js');
  let createdPayload;
  await page.route('**/room', async route => {
    createdPayload = route.request().postDataJSON();
    const error = validateCreate(createdPayload);
    if (error) return route.fulfill({ status: 400, json: { error } });
    return route.fulfill({ status: 201, json: { code, hostToken: 'h'.repeat(43), seatToken: 's'.repeat(43) } });
  });
  await setupPlayers(page);
  await page.getByRole('button', { name: '📡 Starta som live-runda', exact: true }).click();
  await expect(page.locator('#liveCodeModal')).toBeVisible();
  await expect(page.locator('#liveInvitationQr svg')).toBeVisible();
  const url = await page.locator('#liveInvitationLink').inputValue();
  expect(url).toContain(`#live_join=${code}`);
  expect(url).not.toContain('h'.repeat(43));
  expect(url).not.toContain('s'.repeat(43));
  expect(createdPayload.players[0]).not.toHaveProperty('playerId');
  expect(validateCreate(createdPayload)).toBeNull();
});

test('invitation link opens a safe preview, paste accepts the link, and a seat still needs claiming', async ({ page }) => {
  let claims = 0;
  const room = { protocolVersion: 2, courseName: 'Friendly course', holes: 9, gameMode: 'individual',
    players: [{ name: 'Host Ada' }, { name: 'Bo' }], seats: [{ claimed: true }, { claimed: false }], teams: null };
  await page.route(`**/room/${code}`, route => route.fulfill({ status: 200, json: room }));
  await page.route(`**/room/${code}/claim`, route => { claims++; return route.fulfill({ status: 409, json: { error: 'Seat unavailable' } }); });
  await page.goto(`/index.html#live_join=${code}`);
  await expect(page.locator('#joinLiveSeatStep')).toBeVisible();
  await expect(page.locator('#liveJoinPreview')).toContainText('Friendly course');
  await expect(page.locator('#liveJoinPreview')).toContainText('Host Ada');
  await expect(page.locator('#liveJoinPreview')).toContainText('1 lediga platser');
  expect(new URL(page.url()).hash).toBe('');
  expect(claims).toBe(0);
  await page.getByRole('button', { name: '← Ändra kod', exact: true }).click();
  await page.locator('#joinLiveCodeInput').fill(`https://example.test/app/#live_join=${code}`);
  await page.getByRole('button', { name: 'Hämta runda', exact: true }).click();
  await expect(page.locator('#joinLiveSeatStep')).toBeVisible();
  expect(claims).toBe(0);
  await page.locator('#joinLiveSeatList button').filter({ hasText: 'Bo' }).click();
  await expect.poll(() => claims).toBe(1);
  await expect(page.locator('#joinLiveError')).toBeVisible();
});
