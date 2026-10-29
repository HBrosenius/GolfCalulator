const {test,expect}=require('@playwright/test');
async function setup(page) {
  await page.goto('/index.html');await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.locator('#courseSearchInput').fill('Binga Golf');await page.locator('.cg-tee-btn').filter({hasText:'Gul'}).first().click();await page.locator('#step2 button',{hasText:'Nästa'}).click();await page.locator('#pname_0').fill('Ada');await page.locator('#phi_0').fill('10');
}
test('offline setup check persists course and draft and distinguishes local storage from cloud',async({page,context})=>{
  await setup(page);await page.getByRole('button',{name:'Spara och kontrollera offline'}).click();
  await expect(page.locator('#offlineSetupStatus')).toContainText('Utkast och bandata sparade');await expect(page.locator('#offlineSetupStatus')).toContainText('App offline: kunde inte verifieras');
  expect(await page.evaluate(async()=>(await recoveryStore.list(recoveryScope())).drafts[0].state.hpar.length)).toBe(9);
  await page.locator('#step3 button',{hasText:'Nästa'}).click();await page.locator('#score_0_0').fill('4');await expect(page.locator('#offlineScoreStatus')).toContainText('Utkast och bandata sparade');
  await context.setOffline(true);await expect(page.locator('#offlineScoreStatus')).toContainText('Offline: scoresparande');await expect(page.locator('#offlineScoreStatus')).toContainText('utkast överförs inte mellan enheter');
  await page.locator('#score_0_1').fill('5');await page.evaluate(()=>checkpointDrafts());
  expect(await page.evaluate(async()=>(await recoveryStore.list(recoveryScope())).drafts[0].state.scores[0].slice(0,2))).toEqual([4,5]);
  await context.setOffline(false);
});
test('failed local writes remain visible and retry confirms a new vault save',async({page})=>{
  await setup(page);await page.locator('#step3 button',{hasText:'Nästa'}).click();await page.evaluate(()=>checkpointDrafts());
  await page.evaluate(()=>{window.originalOfflinePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new Error('Disk full');};});
  await page.locator('#score_0_0').fill('4');await expect(page.locator('#offlineScoreStatus')).toContainText('Utkastet kunde inte sparas');
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalOfflinePut;});await page.locator('#step4 .retry-round-save').click();
  await expect(page.locator('#offlineScoreStatus')).toContainText('Utkast och bandata sparade');await expect(page.locator('#step4 .retry-round-save')).toBeHidden();
});
test('live score upload failure stays pending until an acknowledged retry',async({page})=>{
  await setup(page);await page.locator('#step3 button',{hasText:'Nästa'}).click();let fail=true;
  await page.route('**/room/ABCD',route=>route.fulfill({status:fail?503:200,json:{}}));
  await page.evaluate(()=>{state.liveRoomCode='ABCD';state.liveSeat=0;state.liveSeatToken='token';liveSyncPush();});
  await expect(page.locator('#offlineScoreStatus')).toContainText('Livescore kunde inte laddas upp');await expect(page.locator('#offlineScoreStatus')).toContainText('1 scorekort väntar');
  fail=false;await page.locator('#step4 .retry-round-upload').click();await expect(page.locator('#offlineScoreStatus')).toContainText('senast uppladdat');await expect(page.locator('#offlineScoreStatus')).toContainText('inga väntande ändringar');
  fail=true;await page.evaluate(()=>liveSyncPush());await expect(page.locator('#offlineScoreStatus')).toContainText('Livescore kunde inte laddas upp');await expect(page.locator('#offlineScoreStatus')).toContainText('senast uppladdat');
});
test.describe('verified offline shell',()=>{
  test.use({serviceWorkers:'allow'});
  test('readiness requires cached resources and the saved draft resumes after an offline reload',async({page,context,browserName})=>{
    test.skip(browserName==='webkit','Playwright WebKit cannot navigate offline under a service worker; physical iOS validation remains necessary.');
    await page.goto('/index.html');await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));await setup(page);
    await page.getByRole('button',{name:'Spara och kontrollera offline'}).click();await expect(page.locator('#offlineSetupStatus')).toContainText('App offline: verifierad');
    await page.locator('#step3 button',{hasText:'Nästa'}).click();await page.locator('#score_0_0').fill('4');await page.evaluate(()=>checkpointDrafts());
    await context.setOffline(true);await page.reload();await page.getByRole('button',{name:/Fortsätt rundan/}).click();await expect(page.locator('#score_0_0')).toHaveValue('4');await expect(page.locator('#offlineScoreStatus')).toContainText('App offline: verifierad');
    await page.evaluate(async()=>{const meta=await caches.open('golf-cache-meta');const pointer=await meta.match(new URL('./__golf_cache__/current',location.href).href);const cache=await caches.open(await pointer.text());await cache.delete(new URL('src/scoring.js?v=20260809-2',location.href).href);});
    await page.getByRole('button',{name:'Kontrollera offline',exact:true}).click();await expect(page.locator('#offlineScoreStatus')).toContainText('App offline: kunde inte verifieras');
    await context.setOffline(false);
  });
});
test('tour retry keeps local evidence until the server acknowledges the queued result',async({page})=>{
  await setup(page);await page.locator('#step3 button',{hasText:'Nästa'}).click();
  await page.evaluate(()=>{
    const round={id:'local-1',date:'2026-10-29',courseName:state.courseName,tee:state.teeColor,holes:9,gameMode:'individual',subjects:[],tourRef:{code:'ABCD2345',syncStatus:'pending'}};
    roundsSave([round]);sharedTourStore.upsert({code:'ABCD2345',role:'member',token:'A'.repeat(43),tour:{name:'Weekend',status:'open',revision:1,courses:[],members:[],rounds:[]},pendingSubmissions:[{payload:{clientRoundId:'local-1'},attempts:1,lastError:'Nätverksfel'}]});
    state.editingId='local-1';goToStep(5);
  });
  const status=page.locator('#offlineResultStatus');await expect(status).toContainText('väntar på uppladdning');await expect(status).toContainText('Nätverksfel');
  let fail=true;await page.route('**/tour/ABCD2345/rounds',route=>route.fulfill({status:fail?503:200,json:fail?{error:'Try later'}:{tour:{name:'Weekend',status:'open',revision:2,courses:[],members:[],rounds:[]},round:{id:'server-1'}}}));
  await page.locator('#step5 .retry-round-upload').click();await expect(status).toContainText('Try later');expect(await page.evaluate(()=>roundsLoad().length)).toBe(1);
  fail=false;await page.locator('#step5 .retry-round-upload').click();await expect(status).toContainText('mottaget av touren');await expect(status).toContainText('senast uppladdat');await expect(page.locator('#step5 .retry-round-upload')).toBeHidden();expect(await page.evaluate(()=>sharedTourStore.find('ABCD2345').pendingSubmissions.length)).toBe(0);
});
test('account sync is labelled separately from draft storage and scoped after switching accounts',async({page})=>{
  await setup(page);await page.locator('#step3 button',{hasText:'Nästa'}).click();await page.evaluate(()=>checkpointDrafts());
  await page.evaluate(()=>{accountSessionSave({token:'first',user:{id:'first',email:'ada@example.com'}});saveAccountSyncMeta({status:'error',error:'Servern svarar inte',lastSyncedAt:1});});
  await expect(page.locator('#offlineScoreStatus')).toContainText('Konto (sparade rundor och banor): Servern svarar inte');await expect(page.locator('#offlineScoreStatus')).not.toContainText('Utkast och bandata sparade');
  await page.evaluate(()=>{accountSessionSave({token:'second',user:{id:'second',email:'bo@example.com'}});renderRoundReadiness();});await expect(page.locator('#offlineScoreStatus')).not.toContainText('Servern svarar inte');
});
