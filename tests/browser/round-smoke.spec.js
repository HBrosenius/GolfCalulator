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
