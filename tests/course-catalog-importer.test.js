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

test('catalogue importer rejects unverified and duplicate records', async () => {
  const { validateVerifiedCourses } = await import('../scripts/build-course-catalog-migration.mjs');
  const courses = JSON.parse(fs.readFileSync('catalog/verified/ekerum.json', 'utf8'));
  assert.throws(() => validateVerifiedCourses([{ ...courses[0], verificationStatus: 'needs-review' }]), /metadata missing/);
  assert.throws(() => validateVerifiedCourses([courses[0], courses[0]]), /Duplicate/);
});
