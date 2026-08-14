#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validCourse } = require('../src/course-catalog.js');

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function validateVerifiedCourses(courses) {
  if (!Array.isArray(courses) || courses.length === 0) throw new Error('Dataset must contain at least one course');
  const ids = new Set();
  for (const course of courses) {
    if (!validCourse(course)) throw new Error(`Invalid course: ${course?.id || '(missing id)'}`);
    if (course.verificationStatus !== 'verified' || !course.source || !course.verifiedAt)
      throw new Error(`Verified source metadata missing: ${course.id}`);
    if (ids.has(course.id)) throw new Error(`Duplicate course id: ${course.id}`);
    ids.add(course.id);
  }
  return courses;
}

export function buildMigrationSql(courses) {
  validateVerifiedCourses(courses);
  const statements = courses.map(course => {
    const { source, verifiedAt, verificationStatus, ...payload } = course;
    const values = [
      course.id, course.name, `${course.name} ${course.region}`.toLocaleLowerCase('sv-SE'), course.region,
      course.country || 'SE', course.holes, course.version || 1, course.updatedAt, 1, JSON.stringify(payload),
      source.url, source.title, verifiedAt, verificationStatus,
    ].map((value, index) => [5, 6, 7, 8, 12].includes(index) ? String(value) : sqlString(value));
    return `INSERT OR REPLACE INTO course_catalog\n  (id,name,search_name,region,country,holes,version,updated_at,published,payload,source_url,source_title,verified_at,verification_status)\nVALUES (${values.join(',')});`;
  });
  return `${statements.join('\n\n')}\n`;
}

function main(paths) {
  if (!paths.length) throw new Error('Usage: node scripts/build-course-catalog-migration.mjs <dataset.json> [...]');
  const courses = paths.flatMap(path => JSON.parse(fs.readFileSync(path, 'utf8')));
  process.stdout.write(buildMigrationSql(courses));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
