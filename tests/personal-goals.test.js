const {test}=require('node:test');const assert=require('node:assert/strict');const Goals=require('../src/personal-goals.js');const Insights=require('../src/course-insights.js');const Validation=require('../src/validation.js');const {mergeSnapshots}=require('../src/account-sync.js');const {createBackupPayload}=require('../src/storage.js');
const player={id:1,name:'Ada'},today='2026-10-29';
const goal={id:'g1',playerId:1,type:'rounds',startDate:'2026-01-01',endDate:'2026-12-31',target:2,holes:0,roundKind:'competitive',courseKey:null,courseLabel:null};
function round(id,extra={}){return{id,date:'2026-07-01',courseName:'Testbanan',tee:'Gul',holes:9,gameMode:'individual',subjects:[{playerId:1,name:'Ada',rows:Array.from({length:9},(_,h)=>({h:h+1,par:4,score:5}))}],...extra};}
test('round goals count complete individual matches once and exclude practice, pending and future records',()=>{
  const partial=round(2);partial.subjects[0].rows[0].skipped=true;
  const rounds=[round(1),partial,round(3,{gameMode:'fourball'}),round(4,{roundKind:'practice'}),round(5,{date:'2026-12-01'}),round(6,{tourRef:{approvalStatus:'provisional'}}),round(7,{tourRef:{resultStatus:'disqualified'}})];
  assert.deepEqual(Goals.progress(goal,rounds,player,today),{current:1,matches:1,achieved:false,status:'active'});
  assert.equal(Goals.progress({...goal,roundKind:'practice'},rounds,player,today).current,1);
});
test('target scores use gross hole scores within the exact course/tee/version and hole count',()=>{
  const first=round(1),red=round(2,{tee:'Röd'});red.subjects[0].rows.forEach(row=>row.score=3);const key=Insights.groups([first],player)[0].key;
  const target={...goal,type:'score',target:45,holes:9,courseKey:key,courseLabel:'Testbanan · Gul · 9 hål'};
  assert.equal(Goals.progress(target,[first,red],player,today).current,45);assert.equal(Goals.progress(target,[first,red],player,today).achieved,true);
  assert.equal(Goals.progress({...target,target:44},[first,red],player,today).achieved,false);
  assert.equal(Goals.progress({...goal,startDate:'2027-01-01',endDate:'2027-12-31'},[first],player,today).status,'future');assert.equal(Goals.progress({...goal,endDate:'2026-07-31'},[first],player,today).status,'ended');
});
test('recap keeps 9/18-hole course bests separate and statistical denominators reflect only recorded fields',()=>{
  const first=round(1),long=round(2,{holes:18});long.subjects[0].rows=Array.from({length:18},(_,h)=>({h:h+1,par:4,score:4}));first.subjects[0].rows[0].stats={putts:0,gir:false};
  const data=Goals.recap([first,long],player,'2026-01-01',today,'competitive',today);assert.equal(data.count,2);assert.equal(data.nine,1);assert.equal(data.eighteen,1);assert.equal(data.bests.length,2);assert.equal(data.stats.putts.count,1);assert.equal(data.stats.putts.total,0);
});
test('goal backup validation rejects malformed periods, unsafe fields and invalid targets',()=>{
  const backup=createBackupPayload({goals:[goal]});assert.equal(Validation.isBackupPayload(backup),true);
  for(const invalid of [{...goal,startDate:'2026-02-30'},{...goal,target:0},{...goal,onclick:'bad'},{...goal,type:'score',holes:0}])assert.equal(Validation.isPersonalGoal(invalid),false);
});
test('goal merge preserves old clients, rejects competing changes and retains deletion evidence',()=>{
  assert.deepEqual(mergeSnapshots({goals:[goal]}, {}, {goals:[goal]}).goals,[goal]);
  assert.throws(()=>mergeSnapshots({goals:[{...goal,target:3}]},{goals:[{...goal,target:4}]},{goals:[goal]}),{status:409});
  assert.deepEqual(mergeSnapshots({goals:[goal]},{goals:[],goalDeletions:[{id:goal.id,deletedAt:1}]}).goals,[]);
});
