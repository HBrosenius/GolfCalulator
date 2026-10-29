const {test}=require('node:test');const assert=require('node:assert/strict');const Merge=require('../src/player-merge.js');const V=require('../src/validation.js');const {mergeSnapshots}=require('../src/account-sync.js');
const source={id:1,name:'Ada old',hi:18},target={id:2,name:'Ada',hi:12};
function data(){return{players:[source,target],rounds:[{id:11,date:'2026-07-01',courseName:'Test',tee:'Gul',holes:9,slope:113,cr:36,par:36,gameMode:'individual',subjects:[{playerId:1,name:'Ada old',hi:18,ph:9,totalPoints:18,totalBrutto:45,rows:Array.from({length:9},(_,h)=>({h:h+1,par:4,si:h+1,strokes:1,score:5,netto:4,pts:2,skipped:false}))}]}],goals:[{id:'g1',playerId:1,type:'rounds',startDate:'2026-01-01',endDate:'2026-12-31',target:10,holes:0,roundKind:'competitive',courseKey:null,courseLabel:null}],tours:[{id:55,name:'Local',startDate:'2026-01-01',endDate:'2026-12-31',status:'open',bestOfN:null,duplicateCourseRule:'best',roster:[1,2],courses:[{name:'Test',holes:9,maxRounds:3}]}],setups:[{id:'s1',name:'Group',createdAt:1,updatedAt:1,gameMode:'individual',minTeeShots:null,courses:[{name:'Test',tee:'Gul',holes:9,slope:113,cr:36,par:36,hpar:Array(9).fill(4),si:[1,2,3,4,5,6,7,8,9]}],players:[{playerId:1,name:'Ada old',hi:18,tee:'Gul',team:'A'}]}],playerMerges:[],playerDeletions:[]};}
test('merge rewrites stable identities while preserving scores, historical handicaps and the kept profile',()=>{
  const before=data(),{snapshot,operation}=Merge.prepare(before,1,2,'m1',100);assert.equal(V.isPlayerMerge(operation),true);assert.deepEqual(snapshot.players,[target]);assert.equal(snapshot.rounds[0].subjects[0].playerId,2);assert.equal(snapshot.rounds[0].subjects[0].hi,18);assert.equal(snapshot.rounds[0].subjects[0].totalPoints,18);assert.equal(snapshot.goals[0].playerId,2);assert.deepEqual(snapshot.tours[0].roster,[2]);assert.equal(snapshot.setups[0].players[0].playerId,2);assert.equal(before.rounds[0].subjects[0].playerId,1);
  const undone=Merge.undo(snapshot,'m1',200);assert.equal(undone.rounds[0].subjects[0].playerId,1);assert.equal(undone.goals[0].playerId,1);assert.equal(undone.players.length,2);assert.equal(undone.playerDeletions[0].id,'1');
});
test('same-card identities, shared role collisions and merge cycles are rejected',()=>{
  const before=data();before.rounds[0].subjects.push({...before.rounds[0].subjects[0],playerId:2});assert.throws(()=>Merge.prepare(before,1,2,'m1',100),/samma scorekort/);
  const history=data();history.rounds[0].tourRef={code:'ABCD2345'};history.rounds[0].subjects[0].memberId='a';const other=structuredClone(history.rounds[0]);other.id=12;other.subjects[0].playerId=2;other.subjects[0].memberId='b';history.rounds.push(other);assert.throws(()=>Merge.prepare(history,1,2,'m1',100),/Tourhistoriken/);
  const {snapshot}=Merge.prepare(data(),1,2,'m1',100);assert.throws(()=>Merge.links([{code:'ABCD',memberLinks:{1:'a',2:'b'}}],snapshot.playerMerges),/olika tourspelare/);
  assert.throws(()=>Merge.normalize({players:[],playerMerges:[...snapshot.playerMerges,{...snapshot.playerMerges[0],id:'m2',source:target,targetId:1}]}),/cirkel/);
});
test('undo refuses to overwrite changes made after the merge',()=>{
  const {snapshot}=Merge.prepare(data(),1,2,'m1',100);snapshot.rounds[0].note='new note';assert.throws(()=>Merge.undo(snapshot,'m1',200),/ändrats efter/);
});
test('stale data is canonicalized, old clients are stopped, and undo wins against an unchanged device',()=>{
  const {snapshot}=Merge.prepare(data(),1,2,'m1',100);const stale={...data(),playerMerges:snapshot.playerMerges};assert.equal(Merge.normalize(stale).rounds[0].subjects[0].playerId,2);assert.equal(Merge.normalize(stale).players.length,1);
  assert.throws(()=>mergeSnapshots(snapshot,{players:[]}),{status:426});const undone=Merge.undo(snapshot,'m1',200);const result=mergeSnapshots(undone,snapshot,snapshot);assert.equal(result.rounds[0].subjects[0].playerId,1);assert.equal(result.players.length,2);
});
test('undo evidence rejects score changes and redacted exports can preserve identity without leaking history',()=>{
  const {operation}=Merge.prepare(data(),1,2,'m1',100);const bad=structuredClone(operation);bad.changes[0].after.subjects[0].totalPoints=19;assert.equal(V.isPlayerMerge(bad),false);const {changes,...redacted}=operation;assert.equal(V.isPlayerMerge(redacted),true);assert.deepEqual(Merge.combine([redacted],[operation])[0].changes,changes);
});
test('a later deliberate deletion after undo is not resurrected',()=>{const {snapshot}=Merge.prepare(data(),1,2,'m1',100);const undone=Merge.undo(snapshot,'m1',200);undone.players=undone.players.filter(p=>p.id!==1);undone.playerDeletions=[{id:'1',deletedAt:300}];assert.equal(Merge.normalize(undone).players.length,1);});
