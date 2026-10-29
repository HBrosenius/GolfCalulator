const {test}=require('node:test');
const assert=require('node:assert/strict');
const Insights=require('../src/course-insights.js');
const player={id:1,name:'Ada'};
function round(id, options={}) {
  return {id,date:`2026-10-${String(id).padStart(2,'0')}`,courseName:'Testbanan',tee:'Gul',holes:9,gameMode:'individual',subjects:[{playerId:1,name:'Ada',rows:Array.from({length:9},(_,i)=>({h:i+1,par:i===0?3:i===8?5:4,score:i===0?3:5,skipped:false}))}],...options};
}
test('course insights compare gross against each hole par and preserve samples and chronological recent five',()=>{
  const rounds=[6,2,4,1,3,5].map(id=>round(id));
  const key=Insights.groups(rounds,player)[0].key;
  const data=Insights.summarize(rounds,player,{key});
  assert.equal(data.count,6);assert.equal(data.scoredHoles,54);
  assert.deepEqual(data.strongest.map(x=>x.hole),[1,9]);assert.equal(data.toughest.length,7);
  assert.equal(data.holes[1].average,1);assert.equal(data.holes[1].count,6);
  assert.equal(data.splits.length,1);assert.equal(data.pars[0].count,6);
  assert.deepEqual(data.recent.map(x=>x.id),[6,5,4,3,2]);assert.equal(data.recent[0].toPar,7);
  assert.equal(Insights.summarize(rounds,player,{key,from:'2026-10-02',to:'2026-10-04'}).count,3);
});
test('team modes, other identities and unfinished drafts do not enter individual comparisons',()=>{
  const rounds=[round(1),round(2,{gameMode:'fourball'}),round(3,{gameMode:'match'}),round(4,{gameMode:'scramble'}),round(5,{lifecycle:'draft'}),round(6,{subjects:[{playerId:2,name:'Ada',rows:round(1).subjects[0].rows}]})];
  assert.equal(Insights.groups(rounds,player)[0].count,1);
});
test('tee, rating, hole count and changed par layout are distinct groups',()=>{
  const changed=round(5);changed.subjects[0].rows[0].par=4;
  const long=round(6,{holes:18});long.subjects[0].rows=Array.from({length:18},(_,i)=>({h:i+1,par:4,score:4}));
  const rounds=[round(1),round(2,{tee:'Röd'}),round(3,{cr:36,slope:113}),round(4,{cr:37,slope:113}),changed,long];
  assert.equal(Insights.groups(rounds,player).length,6);
  const key=Insights.groups([long],player)[0].key;assert.equal(Insights.summarize([long],player,{key}).splits.length,2);
});
test('practice, pickup and missing scores remain separate with absent holes excluded from averages',()=>{
  const partial=round(2);partial.subjects[0].rows[0].score='';partial.subjects[0].rows[1].skipped=true;
  const rounds=[round(1),partial,round(3,{roundKind:'practice'})];const key=Insights.groups(rounds,player)[0].key;
  assert.equal(Insights.summarize(rounds,player,{key}).count,1);
  assert.equal(Insights.summarize(rounds,player,{key,kind:'practice'}).count,1);
  const data=Insights.summarize(rounds,player,{key,completion:'incomplete'});
  assert.equal(data.scoredHoles,7);assert.equal(data.holes[0].average,null);assert.equal(data.holes[1].count,0);assert.equal(data.recent[0].complete,false);
});
