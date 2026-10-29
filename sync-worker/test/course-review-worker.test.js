import { SELF, env } from 'cloudflare:test';
import { beforeAll, expect, it } from 'vitest';
import { hashToken } from '../src/auth.js';
import migration from '../migrations/0014_course_review_versions.sql?raw';
const course = {id:'review-test',name:'Test GK',region:'Test',country:'SE',holes:9,version:1,updatedAt:100,tees:[{name:'Gul',slope:113,cr:36,par:36,hpar:Array(9).fill(4),si:[1,3,5,7,9,11,13,15,17]}]};
const headers = {Authorization:'Bearer rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr','Content-Type':'application/json'};
const body = {clientId:'report-1',observedVersion:1,teeName:'Gul',ratingCategory:'all',field:'rating',description:'Kontrollera slope mot officiellt scorekort.'};
beforeAll(async()=>{
  await env.ACCOUNTS_DB.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,created_at INTEGER);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER,last_seen_at INTEGER);
CREATE TABLE course_catalog(id TEXT PRIMARY KEY,name TEXT,search_name TEXT,region TEXT,country TEXT,holes INTEGER,version INTEGER,updated_at INTEGER,published INTEGER,payload TEXT,source_url TEXT,source_title TEXT,verified_at INTEGER,verification_status TEXT NOT NULL DEFAULT 'legacy');`);
  await env.ACCOUNTS_DB.prepare('INSERT INTO course_catalog VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(course.id,course.name,'test gk','Test','SE',9,1,100,1,JSON.stringify(course),null,null,null,'legacy').run();
  await env.ACCOUNTS_DB.exec(migration.replaceAll('\n',' '));
  await env.ACCOUNTS_DB.prepare('INSERT INTO users VALUES(?,?,?)').bind('reporter','test@example.com',Date.now()).run();
  await env.ACCOUNTS_DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr'),'reporter',Date.now()+600000,Date.now()).run();
});
const post=payload=>SELF.fetch('https://worker.test/courses/review-test/reports',{method:'POST',headers,body:JSON.stringify(payload)});
it('archives the original course and keeps history immutable',async()=>{
  expect((await (await SELF.fetch('https://worker.test/courses/review-test/versions/1')).json()).course.version).toBe(1);
  await expect(env.ACCOUNTS_DB.prepare('UPDATE course_catalog SET payload=? WHERE id=?').bind('{}',course.id).run()).rejects.toThrow('new version');
  await expect(env.ACCOUNTS_DB.exec('DELETE FROM course_catalog_versions')).rejects.toThrow('immutable');
  const updated={...course,version:2,updatedAt:200,tees:[{...course.tees[0],slope:120}]};
  await env.ACCOUNTS_DB.prepare('UPDATE course_catalog SET version=2,updated_at=200,payload=? WHERE id=?').bind(JSON.stringify(updated),course.id).run();
  expect((await (await SELF.fetch('https://worker.test/courses/review-test')).json()).course.tees[0].slope).toBe(120);
  expect((await (await SELF.fetch('https://worker.test/courses/review-test/versions/1')).json()).course.tees[0].slope).toBe(113);
});
it('requires authentication and validates the observed tee and version',async()=>{
  expect((await SELF.fetch('https://worker.test/courses/review-test/reports',{method:'POST',body:JSON.stringify(body)})).status).toBe(401);
  for(const patch of [{teeName:'Missing'},{observedVersion:999},{field:'publish'},{sourceUrl:'javascript:alert(1)'},{hole:10}]) expect((await post({...body,...patch})).status).toBe(400);
});
it('accepts idempotent reports without publishing submitted claims',async()=>{
  const before=await (await SELF.fetch('https://worker.test/courses/review-test')).json();
  const response=await post(body);expect(response.status).toBe(201);
  const receipt=await response.json();expect(receipt.report.status).toBe('open');
  const retry=await post(body);expect(retry.status).toBe(200);expect((await retry.json()).report.id).toBe(receipt.report.id);
  expect((await post({...body,description:'Changed retry'})).status).toBe(409);
  const list=await SELF.fetch('https://worker.test/courses/review-test/reports',{headers});expect(list.headers.get('Cache-Control')).toBe('no-store');
  expect((await list.json()).reports).toHaveLength(1);
  expect(await (await SELF.fetch('https://worker.test/courses/review-test')).json()).toEqual(before);
});
it('does not expose another account’s reports',async()=>{
  await post(body);
  await env.ACCOUNTS_DB.prepare('INSERT INTO users VALUES(?,?,?)').bind('other','other@example.com',Date.now()).run();
  await env.ACCOUNTS_DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken('ooooooooooooooooooooooooooooooooooooooooooo'),'other',Date.now()+600000,Date.now()).run();
  const response=await SELF.fetch('https://worker.test/courses/review-test/reports',{headers:{Authorization:'Bearer ooooooooooooooooooooooooooooooooooooooooooo'}});
  expect((await response.json()).reports).toEqual([]);
});
it('removes personal report contents when the account is deleted',async()=>{
  await env.ACCOUNTS_DB.prepare('INSERT INTO users VALUES(?,?,?)').bind('deleted','deleted@example.com',Date.now()).run();
  await env.ACCOUNTS_DB.prepare('INSERT INTO course_correction_reports(id,course_id,user_id,client_id,observed_version,request_json,created_at) VALUES(?,?,?,?,?,?,?)').bind('delete-report',course.id,'deleted','delete-client',1,JSON.stringify(body),Date.now()).run();
  await env.ACCOUNTS_DB.prepare('DELETE FROM users WHERE id=?').bind('deleted').run();
  expect(await env.ACCOUNTS_DB.prepare('SELECT id FROM course_correction_reports WHERE id=?').bind('delete-report').first()).toBeNull();
});
