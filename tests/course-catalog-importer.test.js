'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('verified catalogue datasets produce escaped, provenance-aware D1 migrations', async () => {
  const { buildMigrationSql, validateVerifiedCourses } = await import('../scripts/build-course-catalog-migration.mjs');
  const courses = JSON.parse(fs.readFileSync('catalog/verified/ekerum.json', 'utf8'));
  assert.equal(validateVerifiedCourses(courses).length, 2);
  const sql = buildMigrationSql(courses);
  assert.match(sql, /ekerum-lange-jan-18/);
  assert.match(sql, /Ekerums officiella slope och banguide/);
  assert.match(sql, /'verified'\);/);
  assert.equal(fs.readFileSync('sync-worker/migrations/0008_verified_ekerum_courses.sql', 'utf8').trim(), sql.trim());
});

test('Kalmar verified dataset matches its checked-in D1 migration', async () => {
  const { buildMigrationSql, validateVerifiedCourses } = await import('../scripts/build-course-catalog-migration.mjs');
  const courses = JSON.parse(fs.readFileSync('catalog/verified/kalmar.json', 'utf8'));
  assert.equal(validateVerifiedCourses(courses).length, 2);
  assert.equal(courses.flatMap(course => course.tees.flatMap(tee => tee.ratings)).length, 15);
  const sql = buildMigrationSql(courses);
  assert.match(sql, /kalmar-gamla-banan-18/);
  assert.match(sql, /kalmar-nya-banan-18/);
  assert.equal(fs.readFileSync('sync-worker/migrations/0009_verified_kalmar_courses.sql', 'utf8').trim(), sql.trim());
  const cleanup = fs.readFileSync('sync-worker/migrations/0010_unpublish_superseded_kalmar_courses.sql', 'utf8');
  assert.match(cleanup, /SET published = 0/);
  assert.match(cleanup, /kalmar-gk-gamla-18/);
  assert.match(cleanup, /kalmar-gk-nya-18/);
});

test('Jönköping, Värnamo and Vetlanda dataset matches its checked-in D1 migration', async () => {
  const { buildMigrationSql, validateVerifiedCourses } = await import('../scripts/build-course-catalog-migration.mjs');
  const courses = JSON.parse(fs.readFileSync('catalog/verified/jonkoping-varnamo-vetlanda.json', 'utf8'));
  assert.equal(validateVerifiedCourses(courses).length, 3);
  assert.equal(courses.flatMap(course => course.tees.flatMap(tee => tee.ratings)).length, 23);
  const sql = buildMigrationSql(courses);
  assert.equal(fs.readFileSync('sync-worker/migrations/0011_verified_jonkoping_varnamo_vetlanda.sql', 'utf8').trim(), sql.trim());
});

test('catalogue importer rejects unverified and duplicate records', async () => {
  const { validateVerifiedCourses } = await import('../scripts/build-course-catalog-migration.mjs');
  const courses = JSON.parse(fs.readFileSync('catalog/verified/ekerum.json', 'utf8'));
  assert.throws(() => validateVerifiedCourses([{ ...courses[0], verificationStatus: 'needs-review' }]), /metadata missing/);
  assert.throws(() => validateVerifiedCourses([courses[0], courses[0]]), /Duplicate/);
});
