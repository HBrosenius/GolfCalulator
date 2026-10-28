const { test, expect } = require('@playwright/test');
const code='ABCD2345';
async function setup(page) {
  await page.goto('/index.html');
  await page.evaluate(code=>{
    localStorage.clear(); playersSave([{id:1,name:'Ada',hi:12},{id:2,name:'Bo',hi:8}]);
    const tour={revision:1,rulesRevision:1,rulesLocked:false,name:'Tävlingshelg',status:'open',startDate:'2026-01-01',endDate:'2026-12-31',bestOfN:null,duplicateCourseRule:'best',approvalRequired:false,competition:{format:'stableford',tieBreak:'handicap'},members:[{id:'ada',name:'Ada',hi:12},{id:'bo',name:'Bo',hi:8}],courses:[{id:'c1',name:'Testbanan',holes:9,maxRounds:3,tees:[{name:'Gul',slope:113,cr:36,par:36,hpar:Array(9).fill(4),si:[1,3,5,7,9,11,13,15,17]}]}],rounds:[],announcements:[]};
    sharedTourStore.upsert({code,role:'organizer',token:'A'.repeat(43),memberLinks:{1:'ada',2:'bo'},tour,events:[],eventsRevision:0,activity:[],contributors:[],pendingSubmissions:[]}); _tourViewMode='shared';_tourViewActiveId=code;renderSharedTourDetail(code);showPrimaryView('tour','tourView');
  },code);
  await page.route(`**/tour/${code}/events`,route=>route.fulfill({json:{events:[],scheduleRevision:0}}));
  await page.route(`**/tour/${code}/activity`,route=>route.fulfill({json:{activity:[]}}));
}
test('organizer selects net stroke play and incomplete rounds remain drafts', async ({page})=>{
  await setup(page); let settings, submitted;
  await page.route(`**/tour/${code}/conditions`,async route=>{settings=route.request().postDataJSON(); const tour=await page.evaluate(code=>sharedTourStore.find(code).tour,code);await route.fulfill({json:{...tour,...settings,revision:2,rulesRevision:2}});});
  await page.route(`**/tour/${code}/manage`,async route=>route.fulfill({json:{tour:await page.evaluate(code=>sharedTourStore.find(code).tour,code),activity:[],contributors:[]}}));
  await page.getByRole('button',{name:'✎ Redigera villkor'}).click();await page.locator('#sharedTourEditFormat').selectOption('net');await page.locator('#sharedTourEditTie').selectOption('shared');await page.locator('#sharedTourEditBest').fill('1');await page.getByRole('button',{name:'Spara villkor',exact:true}).click();
  await expect(page.locator('#sharedTourEditFormat')).toHaveCount(0);expect(settings.competition).toEqual({format:'net',tieBreak:'shared'});
  await page.route(`**/tour/${code}/round-starts`,async route=>{const body=route.request().postDataJSON();expect(body.rulesRevision).toBe(2);const record=await page.evaluate(code=>sharedTourStore.find(code),code);await route.fulfill({json:{...record.tour,revision:3,rulesLocked:true}});});
  await page.route(`**/tour/${code}/rounds`,async route=>{submitted=route.request().postDataJSON();const tour=await page.evaluate(code=>sharedTourStore.find(code).tour,code);const round={...submitted,id:'server-1',courseName:'Testbanan',holes:9,approvalStatus:'confirmed',resultStatus:'active',subjects:submitted.subjects.map(subject=>({...subject,name:tour.members.find(member=>member.id===subject.memberId).name}))};await route.fulfill({status:201,json:{tour:{...tour,revision:4,rulesLocked:true,rounds:[],competitionRounds:[round]},round}});});
  await page.getByRole('button',{name:'+ Ny tourrunda',exact:true}).click();await page.getByRole('button',{name:'Fortsätt till scorekortet'}).click();await expect(page.locator('#step3')).toBeVisible();
  await expect(page.locator('#btnModeScramble')).toBeDisabled();await page.locator('#step3').getByRole('button',{name:'Nästa →',exact:true}).click();await expect(page.locator('#step4')).toBeVisible();
  await page.locator('#score_0_0').fill('5');let message;page.once('dialog',dialog=>{message=dialog.message();dialog.accept();});await page.locator('#step4 button',{hasText:'Beräkna'}).click();expect(message).toContain('slag på alla hål');await expect(page.locator('#step4')).toBeVisible();
  for(let p=0;p<2;p++)for(let h=0;h<9;h++)await page.locator(`#score_${p}_${h}`).fill('5');await page.locator('#step4 button',{hasText:'Beräkna'}).click();await expect(page.locator('#step5')).toBeVisible();
  await expect.poll(()=>submitted?.rulesRevision).toBe(2);expect(await page.evaluate(()=>roundsLoad()[0].tourRef.rulesRevision)).toBe(2);await expect(page.locator('#step5')).toContainText('Nettoslagspel');
});

test('counting explanations, incomplete series and shared places match spectator results',async({page})=>{
  await setup(page);await page.evaluate(code=>{
    const record=sharedTourStore.find(code),tour=record.tour;tour.competition={format:'net',tieBreak:'shared'};tour.bestOfN=2;tour.rulesLocked=true;tour.courses[0].maxRounds=2;tour.members.push({id:'cy',name:'Cy',hi:20});
    const make=(id,memberId,score)=>({id,playedDate:'2026-08-01',courseName:'Testbanan',courseId:'c1',holes:9,gameMode:'individual',approvalStatus:'confirmed',resultStatus:'active',subjects:[{memberId,name:tour.members.find(member=>member.id===memberId).name,totalPoints:18,totalBrutto:score*9,rows:Array.from({length:9},(_,h)=>({h:h+1,score,strokes:0,pts:2,skipped:false}))}]});
    tour.rounds=[];tour.competitionRounds=[make('a1','ada',4),make('a2','ada',5),make('a3','ada',6),make('b1','bo',5),make('b2','bo',4),make('c1','cy',3)];sharedTourStore.upsert(record);renderSharedTourDetail(code);
  },code);
  const places=page.locator('.tour-standing-place');await expect(places.nth(0)).toContainText('#1 delad');await expect(places.nth(1)).toContainText('#1 delad');await expect(places.nth(2)).toHaveText('—');
  await expect(page.locator('.tour-standing-score').first()).toContainText('81');await expect(page.locator('.tour-standing-score').first()).toContainText('slag');await expect(page.locator('.tour-standing-row').nth(2)).toContainText('Ofullständig serie');
  await page.getByText('Vilka rundor räknas?',{exact:true}).first().click();await expect(page.locator('.tour-count-explanation').first()).toContainText('utanför banans maxgräns');
  await page.getByRole('button',{name:'✎ Redigera villkor'}).click();await expect(page.locator('#sharedTourEditFormat')).toBeDisabled();await expect(page.locator('#sharedTourEditTie')).toBeDisabled();await expect(page.locator('#sharedTourEditBest')).toBeDisabled();
  await page.evaluate(code=>{_spectatorTour=sharedTourStore.find(code).tour;_tourViewMode='spectator';renderSpectatorTourDetail(code);},code);
  await expect(page.locator('.tour-standing-place').nth(0)).toContainText('#1 delad');await expect(page.locator('.tour-standing-place').nth(2)).toHaveText('—');await expect(page.locator('.tour-standing-score').first()).toContainText('slag');
});
