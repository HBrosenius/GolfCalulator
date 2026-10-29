const {test,expect}=require('@playwright/test');
async function setup(page){await page.goto('/index.html');await page.evaluate(()=>{localStorage.clear();playersSave([{id:1,name:'Ada',hi:10}]);});await page.reload();await page.locator('#courseSearchInput').fill('Binga Golf');await page.locator('.cg-tee-btn').filter({hasText:'Gul'}).first().click();await page.locator('#step2 button',{hasText:'Nästa'}).click();await page.locator('#ppicker_0').selectOption('1');await page.locator('#step3 button',{hasText:'Nästa'}).click();}
async function change(page,id,value){await page.locator(id).fill(value);await page.locator(id).press('Tab');}
test('optional stats survive drafts, completion, backup and editing and feed course insights',async({page})=>{
  await setup(page);expect(await page.locator('#holeStatsEditor').evaluate(e=>e.open)).toBe(false);await page.locator('#holeStatsEditor summary').click();await change(page,'#statsPutts','3');await change(page,'#statsPenalties','0');await page.locator('#statsGir').selectOption('no');await page.locator('#statsFairway').selectOption('left');
  await page.locator('#score_0_0').fill('5');await page.evaluate(()=>checkpointDrafts());await page.reload();await page.getByRole('button',{name:/Fortsätt rundan/}).click();await page.locator('#holeStatsEditor summary').click();await expect(page.locator('#statsPutts')).toHaveValue('3');await expect(page.locator('#statsGir')).toHaveValue('no');
  const par3=await page.evaluate(()=>state.hpar.indexOf(3));await page.locator('#statsHole').selectOption(String(par3));await expect(page.locator('#statsFairway')).toBeDisabled();await page.locator('#statsHole').selectOption('1');await expect(page.locator('#statsPutts')).toHaveValue('');
  for(let h=0;h<9;h++)await page.locator(`#score_0_${h}`).fill('5');await page.locator('#step4 button',{hasText:'Beräkna'}).click();await expect(page.locator('#step5')).toContainText('1 treputtar');
  const stored=await page.evaluate(()=>({round:roundsLoad()[0],valid:GolfValidation.isBackupPayload(_buildDataPayload(true,true,true,true))}));expect(stored.valid).toBe(true);expect(stored.round.subjects[0].rows[0].stats).toEqual({putts:3,penalties:0,gir:false,fairway:'left'});expect(stored.round.subjects[0].rows[1].stats).toBeUndefined();
  await page.evaluate(id=>editRound(id),stored.round.id);if(!await page.locator('#holeStatsEditor').evaluate(e=>e.open))await page.locator('#holeStatsEditor summary').click();await page.locator('#statsHole').selectOption('0');await expect(page.locator('#statsPutts')).toHaveValue('3');await change(page,'#statsPutts','0');await page.locator('#step4 button',{hasText:'Beräkna'}).click();
  await page.evaluate(()=>openCourseInsights(1));await expect(page.locator('#courseInsightsContent')).toContainText('0.0 per registrerat hål');await expect(page.locator('#courseInsightsContent')).toContainText('0% (0/1 registrerade hål)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('stats do not change score and respect live-seat ownership',async({page})=>{
  await setup(page);await page.locator('#holeStatsEditor summary').click();await change(page,'#statsPutts','2');await expect(page.locator('#score_0_0')).toHaveValue('');
  await page.evaluate(()=>{state.liveRoomCode='ABCD';state.liveSeat=1;renderHoleStatsEditorValues();});await expect(page.locator('#statsPutts')).toBeDisabled();await expect(page.locator('#clearHoleStats')).toBeDisabled();
});
test('stats-only drafts require confirmation before a roster change clears annotations',async({page})=>{
  await setup(page);await page.locator('#holeStatsEditor summary').click();await change(page,'#statsPutts','2');await page.locator('#step4 button',{hasText:'Tillbaka'}).click();await page.locator('#pname_0').fill('Other player');
  let prompted=false;page.once('dialog',dialog=>{prompted=dialog.message().includes('hålstatistik');dialog.dismiss();});await page.locator('#step3 button',{hasText:'Nästa'}).click();expect(prompted).toBe(true);await expect(page.locator('#step3')).toBeVisible();expect(await page.evaluate(()=>state.holeStats[0][0].putts)).toBe(2);
});
