const test=require('node:test');const assert=require('node:assert/strict');
const Layout=require('../src/course-layout.js');const Scoring=require('../src/scoring.js');const Validation=require('../src/validation.js');const Setup=require('../src/round-setup.js');
const full={id:'source-id',name:'Test GK',tee:'Gul',holes:18,slope:140,cr:74,par:72,hpar:Array(18).fill(4),si:Array.from({length:18},(_,i)=>i+1)};
test('a selected nine preserves physical holes and ranks only its stroke indices',()=>{
 const back=Layout.nine(full,'back',130,37.4);assert.deepEqual(back.layout.holeNumbers,[10,11,12,13,14,15,16,17,18]);assert.deepEqual(back.si,[1,3,5,7,9,11,13,15,17]);assert.equal(back.par,36);assert.equal(back.cr,37.4);assert.equal(back.ratingHoles,9);assert.equal(back.id,undefined);assert(Validation.isCourse(back));assert.equal(full.holes,18);assert.throws(()=>Layout.nine(full,'back',undefined,undefined));
 assert.equal(Layout.valid({...back.layout,holeNumbers:[1,2,3,4,5,6,7,8,18]},9),false);assert.equal(Layout.valid({...back.layout,startHole:1},9),false);
});
test('starting order rotates indices without moving physical-hole data',()=>{
 const layout={...Layout.standard(18),startHole:10};assert.deepEqual(Layout.order(layout,18),[9,10,11,12,13,14,15,16,17,0,1,2,3,4,5,6,7,8]);assert.equal(Layout.physical(layout,9),10);
 const back=Layout.nine(full,'back',130,37.4);back.layout.startHole=12;assert.deepEqual(Layout.order(back.layout,9),[2,3,4,5,6,7,8,0,1]);assert.equal(Setup.freshState({courses:[back],players:[{name:'Ada',hi:18,tee:'Gul',team:'A'}],gameMode:'individual'}).layout.startHole,12);
});
test('explicit nine-hole ratings use half-index and their complete CR-minus-par term',()=>{
 assert.equal(Scoring.calculatePlayingHandicap(18,130,37.4,36,9,9),12);
 assert.equal(Scoring.calculatePlayingHandicap(17.3,113,36,36,9,9),9);
 assert.equal(Scoring.calculatePlayingHandicap(-3,113,36,36,9,9),-1);
 assert.equal(Scoring.calculatePlayingHandicap(17.2,113,72,72,9),9);
 assert.throws(()=>Scoring.calculatePlayingHandicap(18,130,37.4,36,18,9),/Nine-hole/);
});
test('insights keep the back-nine hole numbers and separate them from ordinary nine-hole cards',()=>{
 const Insights=require('../src/course-insights.js'),rows=Array.from({length:9},(_,i)=>({h:i+1,courseHole:i+10,par:4,score:5,pts:1,skipped:false}));
 const round={id:1,date:'2026-10-29',courseName:'Test',tee:'Gul',holes:9,subjects:[{playerId:1,name:'Ada',rows}]};
 const player={id:1,name:'Ada'},entries=Insights.entries([round,{...round,id:2,subjects:[{...round.subjects[0],rows:rows.map(({courseHole,...row})=>row)}]}],player);assert.equal(entries.length,2);assert.notEqual(entries[0].key,entries[1].key);const summary=Insights.summarize([round],player,{key:entries[0].key});assert.equal(summary.holes[0].hole,10);assert.equal(summary.holes[8].hole,18);assert.equal(summary.splits[0].label,'Hål 10–18');
});
