import { SELF, env } from 'cloudflare:test';import { expect,it,beforeAll } from 'vitest';
import '../../src/scoring.js';
beforeAll(async()=>{await env.ACCOUNTS_DB.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,created_at INTEGER); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER,last_seen_at INTEGER);")});
const layout={sourceHoles:18,holeNumbers:[10,11,12,13,14,15,16,17,18],startHole:10};
const tee={name:'Gul',slope:130,cr:37.4,par:36,hpar:Array(9).fill(4),si:[1,3,5,7,9,11,13,15,17],ratingHoles:9};
const headers=token=>({'Content-Type':'application/json','X-Golf-Protocol':'2','X-Golf-Layout':'1','CF-Connecting-IP':crypto.randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})});
it('live rooms retain nine-hole ratings, physical holes, start and mixed-tee ratings',async()=>{
 const body={protocolVersion:2,courseName:'Test back nine',teeColor:'Gul',holes:9,layout:{...layout,startHole:12},ratingHoles:9,slope:130,cr:37.4,par:36,hpar:tee.hpar,si:tee.si,gameMode:'individual',players:[{name:'Ada',hi:18,ph:12,tee:'Gul',slope:130,cr:37.4,par:36},{name:'Bo',hi:10,ph:4,tee:'Röd',slope:110,cr:35,par:36}],seatCount:2};
 const response=await SELF.fetch('https://worker.test/room',{method:'POST',headers:headers(),body:JSON.stringify(body)});expect(response.status).toBe(201);const created=await response.json();
 expect((await SELF.fetch(`https://worker.test/room/${created.code}`,{headers:{Authorization:`Bearer ${created.seatToken}`}})).status).toBe(426);
 const room=await (await SELF.fetch(`https://worker.test/room/${created.code}`,{headers:headers(created.seatToken)})).json();expect(room.layout).toEqual(body.layout);expect(room.ratingHoles).toBe(9);expect(room.players[1]).toMatchObject({slope:110,cr:35,par:36});
 const invalid=await SELF.fetch('https://worker.test/room',{method:'POST',headers:headers(),body:JSON.stringify({...body,layout:{...layout,startHole:1}})});expect(invalid.status).toBe(400);
});
it('tour submissions enforce frozen physical-hole mapping and true nine-hole ratings',async()=>{
 const date=new Date().toISOString().slice(0,10);const config={protocolVersion:2,schemaVersion:1,name:'Back nine',startDate:date,endDate:date,bestOfN:1,duplicateCourseRule:'best',members:[{name:'Ada',hi:18},{name:'Bo',hi:10}],courses:[{name:'Test back nine',holes:9,maxRounds:1,layout,tees:[tee]}]};
 const response=await SELF.fetch('https://worker.test/tour',{method:'POST',headers:headers(),body:JSON.stringify(config)});expect(response.status).toBe(201);const created=await response.json();const course=created.tour.courses[0];expect(course.layout).toEqual(layout);
 const ph=12;const rows=tee.hpar.map((par,h)=>{const strokes=globalThis.GolfScoring.strokesOnHole(ph,tee.si[h],9),score=par+strokes;return {h:h+1,courseHole:layout.holeNumbers[h],par,si:tee.si[h],strokes,score,netto:par,pts:2,skipped:false};});
 const body={protocolVersion:2,schemaVersion:1,rulesRevision:1,clientRoundId:'nine-round',playedDate:date,courseId:course.id,gameMode:'individual',startHole:12,subjects:[{memberId:created.tour.members[0].id,teeName:'Gul',totalPoints:18,totalBrutto:rows.reduce((sum,row)=>sum+row.score,0),rows}]};
 const forged=structuredClone(body);forged.subjects[0].rows[0].courseHole=1;expect((await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`,{method:'POST',headers:headers(created.organizerToken),body:JSON.stringify(forged)})).status).toBe(400);
 const submitted=await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`,{method:'POST',headers:headers(created.organizerToken),body:JSON.stringify(body)});expect(submitted.status).toBe(201);const data=await submitted.json();expect(data.round.layout.startHole).toBe(12);expect(data.round.subjects[0].rows[0].courseHole).toBe(10);expect(data.round.scoringSnapshot.course.tees[0].ratingHoles).toBe(9);
 const teamRows=tee.hpar.map((par,h)=>{const strokes=globalThis.GolfScoring.strokesOnHole(6,tee.si[h],9);return {...rows[h],strokes,score:par+strokes,netto:par};});
 const teamBody={...body,clientRoundId:'nine-scramble',gameMode:'scramble',subjects:created.tour.members.map(member=>({memberId:member.id,teeName:'Gul',teamId:'A',totalPoints:18,totalBrutto:42,rows:teamRows}))};
 const teamResponse=await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`,{method:'POST',headers:headers(created.organizerToken),body:JSON.stringify(teamBody)});expect(teamResponse.status).toBe(201);expect((await teamResponse.json()).round.subjects[0].rows.reduce((sum,row)=>sum+row.strokes,0)).toBe(6);

});
it('a starting hole on an older tour still returns canonical physical-hole metadata',async()=>{
 const date=new Date().toISOString().slice(0,10),legacyTee={...tee,cr:72,par:72};delete legacyTee.ratingHoles;
 const response=await SELF.fetch('https://worker.test/tour',{method:'POST',headers:headers(),body:JSON.stringify({protocolVersion:2,schemaVersion:1,name:'Legacy tour',startDate:date,endDate:date,bestOfN:1,duplicateCourseRule:'best',members:[{name:'Ada',hi:18},{name:'Bo',hi:10}],courses:[{name:'Legacy course',holes:9,maxRounds:1,tees:[legacyTee]}]})});expect(response.status).toBe(201);const created=await response.json();
 const ph=globalThis.GolfScoring.calculatePlayingHandicap(18,130,72,72,9),rows=tee.hpar.map((par,h)=>{const strokes=globalThis.GolfScoring.strokesOnHole(ph,tee.si[h],9);return {h:h+1,courseHole:h+1,par,si:tee.si[h],strokes,score:par+strokes,netto:par,pts:2,skipped:false};});
 const recorded=await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`,{method:'POST',headers:headers(created.organizerToken),body:JSON.stringify({protocolVersion:2,schemaVersion:1,rulesRevision:1,clientRoundId:'legacy-start',playedDate:date,courseId:created.tour.courses[0].id,gameMode:'individual',startHole:3,subjects:[{memberId:created.tour.members[0].id,teeName:'Gul',totalPoints:18,totalBrutto:rows.reduce((sum,row)=>sum+row.score,0),rows}]})});expect(recorded.status).toBe(201);const result=await recorded.json();expect(result.round.layout.startHole).toBe(3);expect(result.round.subjects[0].rows[0].courseHole).toBe(1);
});
