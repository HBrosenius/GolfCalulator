const {test}=require('node:test');const assert=require('node:assert/strict');const Stats=require('../src/hole-stats.js');
test('optional statistics distinguish zeros, misses, not applicable and missing values',()=>{
  assert.equal(Stats.valid({putts:0,penalties:0,gir:false},4,4),true);assert.deepEqual(Stats.clean({putts:null,gir:false}),{gir:false});
  for(const bad of [{putts:-1},{putts:1.5},{gir:'no'},{fairway:'forest'},{onclick:'bad'},{putts:8,penalties:1}])assert.equal(Stats.valid(bad,4,5),false);
  assert.equal(Stats.valid({fairway:'hit'},3,3),false);assert.equal(Stats.valid({fairway:'na'},3,3),true);
});
test('summary uses a separate recorded denominator for each stat and excludes pickups and par-3 fairways',()=>{
  const data=Stats.summarize([{par:4,score:5,stats:{putts:3,gir:false,penalties:0,fairway:'left'}},{par:4,score:4,stats:{putts:0,gir:true,penalties:1,fairway:'hit'}},{par:3,score:3,stats:{fairway:'na'}},{par:4,score:5},{par:4,score:'–',skipped:true,stats:{putts:2,penalties:2}}]);
  assert.deepEqual(data.putts,{count:2,total:3,threePutts:1});assert.deepEqual(data.penalties,{count:2,total:1});assert.deepEqual(data.gir,{count:2,hits:1});assert.deepEqual(data.fairway,{count:2,hits:1,left:1,right:0,other:0});
});
