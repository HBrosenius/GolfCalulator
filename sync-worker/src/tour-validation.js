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
