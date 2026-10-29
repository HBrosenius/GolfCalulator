const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const Catalog = require('../src/course-catalog.js');
const course={id:'test-course',name:'Test GK',region:'Test',country:'SE',holes:9,version:1,updatedAt:100,verificationStatus:'verified',verifiedAt:100,source:{url:'https://example.com/scorekort',title:'Scorekort'},tees:[{name:'Gul',slope:113,cr:36,par:36,hpar:Array(9).fill(4),si:[1,3,5,7,9,11,13,15,17]}]};
test('review migrations publish a new immutable version and stop stale approvals',async()=>{
 const {buildMigrationSql}=await import('../scripts/build-course-catalog-migration.mjs');
 const {buildReviewMigration}=await import('../scripts/review-course-report.mjs');
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync('sync-worker/migrations/0006_course_catalog.sql','utf8'));
 db.exec(fs.readFileSync('sync-worker/migrations/0007_course_catalog_provenance.sql','utf8'));
 db.exec('CREATE TABLE users(id TEXT PRIMARY KEY)');
 db.exec('DELETE FROM course_catalog');db.exec(buildMigrationSql([course]));db.exec(fs.readFileSync('sync-worker/migrations/0014_course_review_versions.sql','utf8'));
 db.exec("INSERT INTO users VALUES('reporter'); INSERT INTO course_correction_reports(id,course_id,user_id,client_id,observed_version,request_json,created_at) VALUES('report','test-course','reporter','client',1,'{}',100)");
 const input={report:{id:'report',course_id:course.id,status:'open'},current:course,approved:{...course,version:2,updatedAt:200,tees:[{...course.tees[0],slope:120}]},decision:'accepted',reason:"Checked club's scorecard",reviewedAt:200};
 db.exec(buildReviewMigration(input));
 assert.equal(db.prepare('SELECT version FROM course_catalog').get().version,2);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_catalog_versions').get().n,2);
 assert.equal(db.prepare('SELECT status FROM course_correction_reports').get().status,'accepted');
 assert.throws(()=>db.exec(buildReviewMigration(input)),/CHECK constraint/);
 assert.throws(()=>db.exec('UPDATE course_catalog_versions SET payload=\'{}\''),/immutable/);
 assert.throws(()=>buildReviewMigration({...input,approved:{...input.approved,version:1}}),/next version/);
 // Staging can publish the same independently reviewed data without production user reports.
 db.exec("DELETE FROM course_correction_reports; INSERT INTO course_correction_reports(id,course_id,user_id,client_id,observed_version,request_json,created_at) VALUES('other','test-course','reporter','other',2,'{}',200)");
 const next={...input,current:input.approved,approved:{...input.approved,version:3,updatedAt:300}};
 db.exec(buildReviewMigration(next));assert.equal(db.prepare('SELECT version FROM course_catalog').get().version,3);
 db.close();
});
test('catalogue previews include per-hole changes and preserve category identity',()=>{
 const before=Catalog.localEntries(course)[0];const newer=structuredClone(course);newer.tees[0].si.reverse();newer.tees[0].slope=120;newer.version=2;
 const after=Catalog.candidate(before,newer);const changes=Catalog.changes(before,after);
 assert(changes.some(row=>row.field==='slope'&&row.before===113&&row.after===120));
 assert(changes.some(row=>row.field==='si:1'&&row.before===1&&row.after===17));
 assert.equal(Catalog.candidate({...before,ratingCategory:'women'},newer),null);
 assert.equal(before.si[0],1);
});
