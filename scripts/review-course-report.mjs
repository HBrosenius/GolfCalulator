#!/usr/bin/env node
import fs from 'node:fs';
import { buildMigrationSql, validateVerifiedCourses } from './build-course-catalog-migration.mjs';
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export function buildReviewMigration({ report, current, approved, decision, reason, reviewedAt }) {
  if (!report || report.status !== 'open' || !report.id || report.course_id !== current?.id || !Number.isSafeInteger(current.version)) throw new Error('An open report and its current course are required');
  if (!['accepted', 'rejected'].includes(decision) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000 || !Number.isSafeInteger(reviewedAt) || reviewedAt < 1) throw new Error('A decision, review note and timestamp are required');
  let publish = '';
  if (decision === 'accepted') {
    validateVerifiedCourses([approved]);
    if (approved.id !== current.id || approved.version !== current.version + 1 || approved.updatedAt <= current.updatedAt) throw new Error('Approval requires the next version and a newer timestamp');
    publish = buildMigrationSql([approved]);
  }
  return `INSERT INTO course_review_checks SELECT CASE WHEN EXISTS(SELECT 1 FROM course_catalog WHERE id=${quote(current.id)} AND version=${current.version}) AND NOT EXISTS(SELECT 1 FROM course_correction_reports WHERE id=${quote(report.id)} AND (course_id<>${quote(current.id)} OR status<>'open')) THEN 1 ELSE 0 END;\n${publish}UPDATE course_correction_reports SET status=${quote(decision)},review_note=${quote(reason.trim())},reviewed_at=${reviewedAt},applied_version=${decision === 'accepted' ? approved.version : 'NULL'} WHERE id=${quote(report.id)};\nDELETE FROM course_review_checks;\n`;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(buildReviewMigration(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
