const {test,expect}=require('@playwright/test');
async function setup(page){await page.goto('/index.html');await page.evaluate(()=>{localStorage.clear();playersSave([{id:1,name:'Ada',hi:12},{id:2,name:'Bo',hi:8}]);const round={id:1,date:'2026-07-01',courseName:'Testbanan',tee:'Gul',holes:9,slope:113,cr:36,par:36,gameMode:'individual',subjects:[{playerId:1,name:'Ada',totalPoints:18,totalBrutto:45,hi:12,ph:9,rows:Array.from({length:9},(_,h)=>({h:h+1,par:4,si:h+1,strokes:1,score:5,netto:4,pts:2,skipped:false, ...(h===0?{stats:{putts:3,gir:false,penalties:0,fairway:'left'}}:{})}))}]};roundsSave([round]);openStatisticsView();});await page.getByRole('button',{name:/Mina mål och årskort/}).click();}
test('personal round and score goals track matching history, survive reload and export a recap PNG',async({page})=>{
  await setup(page);await expect(page.locator('#personalRecap')).toContainText('1 fullständiga rundor');await page.locator('#goalEditor summary').click();await page.locator('#goalTarget').fill('2');await page.getByRole('button',{name:'Spara mål',exact:true}).click();await expect(page.locator('#personalGoalsList')).toContainText('1/2 rundor');
  await page.getByRole('button',{name:'Ändra mål',exact:true}).click();await page.locator('#goalTarget').fill('1');await page.getByRole('button',{name:'Spara mål',exact:true}).click();await expect(page.locator('#personalGoalsList')).toContainText('Uppnått');
  await page.locator('#goalType').selectOption('score');await page.locator('#goalTarget').fill('45');await page.getByRole('button',{name:'Spara mål',exact:true}).click();await expect(page.locator('#personalGoalsList')).toContainText('Bästa score 45 slag');
  expect(await page.evaluate(()=>GolfValidation.isBackupPayload(_buildDataPayload(true,true,true,true)))).toBe(true);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Ladda ner årskort (PNG)'}).click();expect((await download).suggestedFilename()).toBe('poangbogey-arskort.png');
  await page.reload();await page.evaluate(()=>openGoalsView(1));await expect(page.locator('.personal-goal')).toHaveCount(2);await page.locator('#recapKind').selectOption('practice');await expect(page.locator('#personalRecap')).toContainText('0 fullständiga rundor');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('deleting goals preserves tombstones through backups and account switches isolate goals',async({page})=>{
  await setup(page);await page.locator('#goalEditor summary').click();await page.locator('#goalTarget').fill('3');await page.getByRole('button',{name:'Spara mål',exact:true}).click();
  const backup=await page.evaluate(()=>_buildDataPayload(true,true,true,true));page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Radera mål',exact:true}).click();expect(await page.evaluate(()=>storageDb.load(GOAL_DELETIONS_KEY,[]).length)).toBe(1);await page.evaluate(backup=>_applyImportPayload(backup),backup);expect(await page.evaluate(()=>goalsLoad().length)).toBe(0);
  await page.evaluate(()=>{accountSessionSave({token:'new-account',user:{id:'new-account',email:'bo@example.com'}});});expect(await page.evaluate(()=>goalsLoad())).toEqual([]);
});
test('a stale goal editor retains user input and refuses to overwrite a remote change',async({page})=>{
  await setup(page);await page.locator('#goalEditor summary').click();await page.locator('#goalTarget').fill('3');await page.getByRole('button',{name:'Spara mål',exact:true}).click();await page.getByRole('button',{name:'Ändra mål',exact:true}).click();await page.locator('#goalTarget').fill('5');
  await page.evaluate(()=>storageDb.save(GOALS_KEY,goalsLoad().map(goal=>({...goal,target:4})),true));await page.getByRole('button',{name:'Spara mål',exact:true}).click();await expect(page.locator('#goalFormStatus')).toContainText('Målet ändrades på en annan enhet');await expect(page.locator('#goalTarget')).toHaveValue('5');expect(await page.evaluate(()=>goalsLoad()[0].target)).toBe(4);
});
test('goal definitions upload to the account and return on a fresh local snapshot',async({page})=>{
  await setup(page);let remote={version:0,data:{courses:[],rounds:[],players:[{id:1,name:'Ada',hi:12}],tours:[],goals:[]}},uploaded;
  await page.route('**/account/snapshot',async route=>{if(route.request().method()==='PUT'){const body=route.request().postDataJSON();uploaded=body.data;remote={version:remote.version+1,data:body.data};await route.fulfill({json:{version:remote.version}});}else await route.fulfill({json:remote});});
  await page.route('**/account/tours',route=>route.fulfill({json:{tours:[]}}));
  await page.evaluate(()=>{accountSessionSave({token:'goals-account',user:{id:'goals-account',email:'ada@example.com'}});playersSave([{id:1,name:'Ada',hi:12}]);openGoalsView(1);});
  await page.locator('#goalEditor summary').click();await page.locator('#goalTarget').fill('4');await page.getByRole('button',{name:'Spara mål',exact:true}).click();await page.evaluate(()=>syncAccountNow({silent:true}));expect(uploaded.goals[0].target).toBe(4);
  await page.evaluate(()=>{storageDb.save(GOALS_KEY,[]);storageDb.save('golf_account_baseline',null);});await page.evaluate(()=>syncAccountNow({silent:true}));expect(await page.evaluate(()=>goalsLoad()[0].target)).toBe(4);await expect(page.locator('#personalGoalsList')).toContainText('0/4 rundor');
});
