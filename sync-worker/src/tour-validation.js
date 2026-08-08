import { PROTOCOL_VERSION } from './validation.js';

export const TOUR_SCHEMA_VERSION = 1;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DUPLICATE_RULES = new Set(['first', 'best']);

function hasOnlyKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.has(key));
}

function isText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateTee(tee, holes) {
  const allowed = new Set(['name', 'slope', 'cr', 'par', 'hpar', 'si']);
  return hasOnlyKeys(tee, allowed) && isText(tee.name, 20) &&
    isNumber(tee.slope, 55, 155) && isNumber(tee.cr, 25, 85) && isInteger(tee.par, 27, 90) &&
    Array.isArray(tee.hpar) && tee.hpar.length === holes && tee.hpar.every(value => isInteger(value, 3, 6)) &&
    Array.isArray(tee.si) && tee.si.length === holes && tee.si.every(value => isInteger(value, 1, 18)) &&
    new Set(tee.si).size === tee.si.length;
}

function validateCourse(course) {
  const allowed = new Set(['name', 'holes', 'maxRounds', 'tees']);
  return hasOnlyKeys(course, allowed) && isText(course.name, 80) &&
    (course.holes === 9 || course.holes === 18) && isInteger(course.maxRounds, 1, 50) &&
    Array.isArray(course.tees) && course.tees.length >= 1 && course.tees.length <= 12 &&
    course.tees.every(tee => validateTee(tee, course.holes)) &&
    new Set(course.tees.map(tee => tee.name.toLocaleLowerCase('sv-SE'))).size === course.tees.length;
}

function validateMember(member) {
  const allowed = new Set(['name', 'hi']);
  return hasOnlyKeys(member, allowed) && isText(member.name, 50) && isNumber(member.hi, 0, 54);
}

export function validateTourCreate(body) {
  const allowed = new Set([
    'protocolVersion', 'schemaVersion', 'name', 'startDate', 'endDate',
    'bestOfN', 'duplicateCourseRule', 'members', 'courses',
  ]);
  if (!body || body.protocolVersion !== PROTOCOL_VERSION) return 'Unsupported protocol version';
  if (body.schemaVersion !== TOUR_SCHEMA_VERSION) return 'Unsupported tour schema version';
  if (!hasOnlyKeys(body, allowed) || !isText(body.name, 80)) return 'Invalid tour configuration';
  if (!isDate(body.startDate) || !isDate(body.endDate) || body.endDate < body.startDate) return 'Invalid tour dates';
  if (body.bestOfN !== null && !isInteger(body.bestOfN, 1, 100)) return 'Invalid best-of value';
  if (!DUPLICATE_RULES.has(body.duplicateCourseRule)) return 'Invalid duplicate-course rule';
  if (!Array.isArray(body.members) || body.members.length < 2 || body.members.length > 100 || !body.members.every(validateMember)) {
    return 'Invalid tour members';
  }
  const memberNames = body.members.map(member => member.name.trim().toLocaleLowerCase('sv-SE'));
  if (new Set(memberNames).size !== memberNames.length) return 'Tour member names must be unique';
  if (!Array.isArray(body.courses) || body.courses.length < 1 || body.courses.length > 50 || !body.courses.every(validateCourse)) {
    return 'Invalid tour courses';
  }
  const courseKeys = body.courses.map(course => `${course.name.trim().toLocaleLowerCase('sv-SE')}\u0000${course.holes}`);
  if (new Set(courseKeys).size !== courseKeys.length) return 'Tour courses must be unique';
  return null;
}

export function validateTourUpdate(body, tour) {
  const allowed = new Set([
    'protocolVersion', 'schemaVersion', 'expectedRevision', 'name', 'startDate', 'endDate',
    'bestOfN', 'duplicateCourseRule', 'courseLimits',
  ]);
  if (!body || body.protocolVersion !== PROTOCOL_VERSION) return 'Unsupported protocol version';
  if (body.schemaVersion !== TOUR_SCHEMA_VERSION) return 'Unsupported tour schema version';
  if (!hasOnlyKeys(body, allowed) || !isInteger(body.expectedRevision, 1, Number.MAX_SAFE_INTEGER) || !isText(body.name, 80)) {
    return 'Invalid tour update';
  }
  if (!isDate(body.startDate) || !isDate(body.endDate) || body.endDate < body.startDate) return 'Invalid tour dates';
  if (body.bestOfN !== null && !isInteger(body.bestOfN, 1, 100)) return 'Invalid best-of value';
  if (!DUPLICATE_RULES.has(body.duplicateCourseRule)) return 'Invalid duplicate-course rule';
  if (!Array.isArray(body.courseLimits) || body.courseLimits.length !== tour.courses.length) return 'Invalid course limits';
  const limits = new Map();
  for (const limit of body.courseLimits) {
    if (!hasOnlyKeys(limit, new Set(['courseId', 'maxRounds'])) || !isText(limit.courseId, 80) ||
      !isInteger(limit.maxRounds, 1, 50) || limits.has(limit.courseId)) return 'Invalid course limits';
    limits.set(limit.courseId, limit.maxRounds);
  }
  if (tour.courses.some(course => !limits.has(course.id))) return 'Invalid course limits';
  if (tour.rounds.some(round => round.playedDate < body.startDate || round.playedDate > body.endDate)) {
    return 'Tour dates must include existing rounds';
  }
  return null;
}

function validateResultRow(row, expectedHole) {
  const allowed = new Set(['h', 'par', 'si', 'strokes', 'score', 'netto', 'pts', 'skipped']);
  if (!hasOnlyKeys(row, allowed) || row.h !== expectedHole || !isInteger(row.par, 3, 6) ||
    !isInteger(row.si, 1, 18) || !isInteger(row.strokes, -5, 10) || typeof row.skipped !== 'boolean') return false;
  if (row.skipped) return row.score === '–' && row.netto === '–' && row.pts === 0;
  return isInteger(row.score, 1, 20) && row.netto === row.score - row.strokes &&
    row.pts === Math.max(0, row.par + 2 - row.netto);
}

export function validateTourRoundSubmission(body, tour) {
  const allowed = new Set([
    'protocolVersion', 'schemaVersion', 'clientRoundId', 'playedDate', 'courseId',
    'gameMode', 'subjects', 'liveRoomCode',
  ]);
  if (!body || body.protocolVersion !== PROTOCOL_VERSION) return 'Unsupported protocol version';
  if (body.schemaVersion !== TOUR_SCHEMA_VERSION) return 'Unsupported tour schema version';
  if (!hasOnlyKeys(body, allowed) || !isText(body.clientRoundId, 80) || !isDate(body.playedDate)) return 'Invalid round submission';
  if (tour.status !== 'open' || body.playedDate < tour.startDate || body.playedDate > tour.endDate) return 'Round is outside the open tour';
  if (!['individual', 'fourball', 'match'].includes(body.gameMode)) return 'Unsupported tour game mode';
  if (body.liveRoomCode !== undefined && !/^[A-HJ-KM-NP-Z2-9]{4}$/.test(body.liveRoomCode)) return 'Invalid live room code';
  const course = tour.courses.find(item => item.id === body.courseId);
  if (!course) return 'Round course is not in the tour';
  if (!Array.isArray(body.subjects) || body.subjects.length < 1 || body.subjects.length > tour.members.length) return 'Invalid round subjects';
  const memberIds = new Set(tour.members.map(member => member.id));
  const seen = new Set();
  for (const subject of body.subjects) {
    const subjectKeys = new Set(['memberId', 'teeName', 'totalPoints', 'totalBrutto', 'rows', 'teamId']);
    if (!hasOnlyKeys(subject, subjectKeys) || !memberIds.has(subject.memberId) || seen.has(subject.memberId) ||
      !course.tees.some(tee => tee.name === subject.teeName) ||
      !isInteger(subject.totalPoints, 0, course.holes * 8) || !isInteger(subject.totalBrutto, 0, course.holes * 20) ||
      (subject.teamId !== null && subject.teamId !== undefined && !isText(subject.teamId, 30)) ||
      !Array.isArray(subject.rows) || subject.rows.length !== course.holes ||
      !subject.rows.every((row, index) => validateResultRow(row, index + 1))) return 'Invalid round subjects';
    if (subject.rows.reduce((sum, row) => sum + row.pts, 0) !== subject.totalPoints) return 'Round points do not match hole results';
    const gross = subject.rows.reduce((sum, row) => sum + (row.skipped ? 0 : row.score), 0);
    if (gross !== subject.totalBrutto) return 'Round gross score does not match hole results';
    seen.add(subject.memberId);
  }
  return null;
}
