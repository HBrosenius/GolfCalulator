const { test, expect } = require('@playwright/test');
const course={id:'review-test',name:'Versionsbanan',region:'Test',country:'SE',holes:9,version:1,updatedAt:100,verificationStatus:'verified',verifiedAt:100,source:{url:'https://example.com/scorekort',title:'Officiellt scorekort'},tees:[{name:'Gul',slope:113,cr:36,par:36,hpar:Array(9).fill(4),si:[1,3,5,7,9,11,13,15,17]},{name:'Röd',slope:110,cr:35,par:36,hpar:Array(9).fill(4),si:[1,3,5,7,9,11,13,15,17]}]};
const updated=()=>({...structuredClone(course),version:2,updatedAt:200,tees:course.tees.map(tee=>({...structuredClone(tee),slope:tee.slope+7,si:[17,15,13,11,9,7,5,3,1]}))});
async function seed(page){await page.goto('/index.html');await page.evaluate(course=>{localStorage.clear();dbSave(GolfCourseCatalog.localEntries(course));renderSavedCourses();},course);}
test('saved-course updates require a preview and freeze existing scorecards',async({page})=>{
 await seed(page);const next=updated();await page.route('**/courses/review-test',route=>route.fulfill({json:{course:next}}));
 await page.evaluate(async()=>{await loadSavedCourseAndAdvance(dbLoad()[0]);state.playerTees=['Röd'];});
 await page.evaluate(()=>previewCourseUpdate(dbLoad()[0]));
 const dialog=page.locator('#courseReviewDialog');await expect(dialog).toContainText('Slope');await expect(dialog).toContainText('Index hål 1');
 expect(await page.evaluate(()=>dbLoad()[0].catalogVersion)).toBe(1);
 await dialog.getByRole('button',{name:'Använd granskad version för framtida spel'}).click();
 await expect(dialog).toContainText('Den granskade versionen är sparad');
 expect(await page.evaluate(()=>({saved:dbLoad()[1].slope,active:teeData('Röd').slope,si:teeData('Röd').si[0]}))).toEqual({saved:117,active:110,si:1});
 await dialog.getByRole('button',{name:'Stäng',exact:true}).click();
 await page.evaluate(async()=>{await loadSavedCourseAndAdvance(dbLoad()[0]);});
 expect(await page.evaluate(()=>teeData('Röd').slope)).toBe(117);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('stale previews and unreviewed catalogue data cannot replace saved tees',async({page})=>{
 await seed(page);let next=updated();await page.route('**/courses/review-test',route=>route.fulfill({json:{course:next}}));
 await page.locator('[data-review]').first().click();const dialog=page.locator('#courseReviewDialog');
 await expect(dialog).toContainText('version 2');next={...next,version:3,updatedAt:300};
 await dialog.getByRole('button',{name:'Använd granskad version för framtida spel'}).click();await expect(dialog).toContainText('ändrats sedan förhandsvisningen');
 expect(await page.evaluate(()=>dbLoad()[0].catalogVersion)).toBe(1);await dialog.getByRole('button',{name:'Stäng',exact:true}).click();
 next.verificationStatus='needs-review';await page.locator('[data-review]').first().click();await expect(page.locator('#courseReviewDialog')).toContainText('måste vara verifierad');
});
test('historical mixed tees retain their own ratings after the library changes',async({page})=>{
 await seed(page);await page.evaluate(()=>{
 const rows=Array.from({length:9},(_,i)=>({h:i+1,par:4,si:i+1,score:4,strokes:0,pts:2,skipped:false}));
 roundsSave([{id:123,date:'2026-10-01',courseName:'Versionsbanan',tee:'Gul',holes:9,slope:113,cr:36,par:36,gameMode:'individual',subjects:[{name:'Ada',hi:10,ph:5,tee:'Röd',slope:110,cr:35,par:36,totalPoints:18,totalBrutto:36,rows}]}]);
 dbSave(dbLoad().map(entry=>({...entry,slope:140,si:entry.si.slice().reverse()})));editRound(123);
 });
 expect(await page.evaluate(()=>({slope:teeData('Röd').slope,si:teeData('Röd').si[0],ph:state.players[0].playingHandicap}))).toEqual({slope:110,si:1,ph:5});
});
test('correction reports require login and retry the exact same submission',async({page})=>{
 await seed(page);await page.locator('[data-report]').first().click();await expect(page.locator('#courseReviewDialog')).toContainText('Logga in');await page.getByRole('button',{name:'Stäng',exact:true}).click();
 await page.evaluate(()=>storageDb.save('golf_account_session',{token:'r'.repeat(43),user:{id:'test-user'},apiBase:'https://catalog.test'}));
 const sent=[];await page.route('https://catalog.test/courses/review-test',route=>route.fulfill({json:{course}}));
 await page.route('https://catalog.test/courses/review-test/reports',async route=>{
 if(route.request().method()==='GET')return route.fulfill({json:{reports:[{status:'rejected',observedVersion:1,request:{description:'Tidigare rapport'},reviewNote:'Kontrollerad mot klubben'}]}});
 sent.push(route.request().postDataJSON());return sent.length===1?route.fulfill({status:503,json:{error:'Tillfälligt fel'}}):route.fulfill({status:201,json:{report:{id:'receipt-123',status:'open'}}});
 });
 await page.locator('[data-report]').first().click();const dialog=page.locator('#courseReviewDialog');await expect(dialog).toContainText('Kontrollerad mot klubben');
 await dialog.locator('[name=description]').fill('Slope på röd tee verkar fel.');await dialog.getByRole('button',{name:'Skicka för granskning'}).click();await expect(dialog).toContainText('Tillfälligt fel');
 await expect(dialog.locator('[name=description]')).toBeDisabled();await dialog.getByRole('button',{name:'Försök skicka samma rapport igen'}).click();await expect(dialog).toContainText('Rapport mottagen · receipt-123');expect(sent[1]).toEqual(sent[0]);await page.evaluate(()=>accountSessionSave(null));await expect(dialog).toHaveCount(0);
});
test('completed rounds and resumed drafts preserve catalogue snapshots in backups',async({page})=>{
 await seed(page);await page.evaluate(()=>loadSavedCourseAndAdvance(dbLoad()[0]));
 await page.locator('#step2 button',{hasText:'Nästa'}).click();await page.locator('#pname_0').fill('Ada');await page.locator('#phi_0').fill('10');await page.locator('#step3 button',{hasText:'Nästa'}).click();
 await page.evaluate(()=>checkpointDrafts());
 const draft=await page.evaluate(async()=>{const draft=(await recoveryStore.list(recoveryScope())).drafts[0];dbSave(dbLoad().map(entry=>({...entry,slope:140,catalogVersion:2})));return draft;});
 expect(draft.state.setupCourses[0].catalogVersion).toBe(1);
 await page.reload();await page.evaluate(()=>resumeRecoveryDraft(inprogressLoad().state.draftId));
 for(let h=0;h<9;h++)await page.locator(`#score_0_${h}`).fill('4');await page.locator('#step4 button',{hasText:'Beräkna'}).click();await expect(page.locator('#step5')).toBeVisible();
 const result=await page.evaluate(()=>({round:roundsLoad()[0],backup:GolfValidation.isBackupPayload(_buildDataPayload(true,true,true,true)),replay:GolfRoundSetup.fromRound(roundsLoad()[0]).courses}));
 expect(result.round.courseSnapshot[0]).toMatchObject({catalogVersion:1,slope:113});expect(result.backup).toBe(true);expect(result.replay[0].catalogVersion).toBe(1);
});
test('renamed catalogue entries are added explicitly while older saved tees remain',async({page})=>{
 await seed(page);const next={...updated(),name:'Nya Versionsbanan'};
 await page.route('**/courses/review-test',route=>route.fulfill({json:{course:next}}));await page.locator('[data-review]').first().click();const dialog=page.locator('#courseReviewDialog');
 await expect(dialog).toContainText('Äldre banor/tees behålls separat');await expect(dialog).toContainText('Nya tees');
 await dialog.getByRole('button',{name:'Använd granskad version för framtida spel'}).click();await expect(dialog).toContainText('Den granskade versionen är sparad');
 const entries=await page.evaluate(()=>dbLoad());expect(entries).toHaveLength(4);expect(entries.find(entry=>entry.name==='Versionsbanan').catalogVersion).toBe(1);expect(entries.find(entry=>entry.name==='Nya Versionsbanan').catalogVersion).toBe(2);
});
