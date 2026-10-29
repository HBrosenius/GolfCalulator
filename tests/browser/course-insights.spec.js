const {test,expect}=require('@playwright/test');
test('personal course insights filter comparable rounds and expose incomplete samples',async({page})=>{
  await page.goto('/index.html');
  await page.evaluate(()=>{
    localStorage.clear();playersSave([{id:1,name:'Ada',hi:12},{id:2,name:'Bo',hi:8}]);
    const make=(id,extra={})=>({id,date:`2026-10-0${id}`,courseName:'Testbanan',tee:'Gul',holes:9,gameMode:'individual',subjects:[{playerId:1,name:'Ada',totalPoints:18,totalBrutto:45,hi:12,rows:Array.from({length:9},(_,i)=>({h:i+1,par:4,score:5,strokes:1,pts:2,skipped:false}))}],...extra});
    const partial=make(3);partial.subjects[0].rows[0].skipped=true;
    roundsSave([make(1),make(2,{roundKind:'practice'}),partial,make(4,{gameMode:'fourball'})]);
    openStatisticsView();
  });
  await page.getByRole('button',{name:/Mina baninsikter/}).click();
  const content=page.locator('#courseInsightsContent');await expect(content).toContainText('1 rundor · 9 hålresultat');await expect(content).toContainText('+1.0');await expect(content).toContainText('2026-10-01');await expect(content).not.toContainText('2026-10-04');
  await page.locator('#insightsKind').selectOption('practice');await expect(content).toContainText('2026-10-02');
  await page.locator('#insightsKind').selectOption('competitive');await page.locator('#insightsCompletion').selectOption('incomplete');await expect(content).toContainText('8 hålresultat');await expect(content).toContainText('8/9 registrerade hål');await expect(content.locator('tbody tr').first()).toContainText('–');
  await page.locator('#insightsFrom').fill('2026-10-04');await expect(content).toContainText('Inga rundor matchar');
  await page.locator('#insightsTo').fill('2026-10-01');await expect(content).toContainText('Från datum måste');
  await page.locator('#insightsPlayer').selectOption('1');await expect(content).toContainText('Inga individuella scorekort');
  await page.evaluate(()=>openPlayerHistory(1));await page.getByRole('button',{name:'⛳ Mina baninsikter',exact:true}).click();await expect(page.locator('#courseInsightsView')).toBeVisible();await expect(content).toContainText('9 hålresultat');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
