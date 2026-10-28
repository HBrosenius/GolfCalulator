'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('../src/tour-events.js');
const tour = { name: 'Tour', startDate: '2026-01-01', endDate: '2026-12-31', members: [{ id: 'ada', name: 'Ada' }, { id: 'bo', name: 'Bo' }], courses: [{ id: 'course', name: 'Banan', holes: 9 }] };
const event = () => ({ name: 'Helggolf', date: '2026-07-11', timeZone: 'Europe/Stockholm', courseId: 'course', note: '', status: 'scheduled', groups: [{ id: 'g1', name: 'Grupp 1', teeTime: '09:00', memberIds: ['ada', 'bo'] }] });
test('event validation rejects invalid dates, memberships and duplicate assignments', () => {
  assert.equal(events.validateEvent(event(), tour), null);
  for (const change of [{ date: '2026-02-30' }, { date: '2027-01-01' }, { timeZone: 'No/such-zone' }, { courseId: 'unknown' }, { groups: [] }, { unexpected: true }]) assert.ok(events.validateEvent({ ...event(), ...change }, tour));
  const duplicate = event(); duplicate.groups.push({ ...duplicate.groups[0], id: 'g2' }); assert.ok(events.validateEvent(duplicate, tour));
  const unknown = event(); unknown.groups[0].memberIds = ['unknown']; assert.ok(events.validateEvent(unknown, tour));
});
test('tee times convert correctly across zones and reject missing or ambiguous DST times', () => {
  assert.equal(new Date(events.teeTimeInstant('2026-07-11', '09:00', 'Europe/Stockholm')).toISOString(), '2026-07-11T07:00:00.000Z');
  assert.equal(new Date(events.teeTimeInstant('2026-12-11', '09:00', 'Europe/Stockholm')).toISOString(), '2026-12-11T08:00:00.000Z');
  assert.equal(new Date(events.teeTimeInstant('2026-07-11', '09:00', 'Asia/Kathmandu')).toISOString(), '2026-07-11T03:15:00.000Z');
  assert.throws(() => events.teeTimeInstant('2026-03-29', '02:30', 'Europe/Stockholm'));
  assert.throws(() => events.teeTimeInstant('2026-10-25', '02:30', 'Europe/Stockholm'));
  assert.equal(events.todayInZone('Pacific/Kiritimati', new Date('2026-01-01T12:00:00Z')), '2026-01-02');
});
test('calendar files escape text, fold UTF-8 lines, retain stable identity and encode cancellation', () => {
  const scheduled = { ...event(), id: 'event-1', revision: 2, updatedAt: Date.UTC(2026, 6, 1) }; scheduled.name = 'Golf, test;\\' + 'å'.repeat(60); scheduled.note = 'Hej\nBEGIN:VEVENT\nInjected';
  const text = events.calendar(scheduled, scheduled.groups[0], tour, 'ABCD2345', 'https://app.test/index.html?token=secret#private');
  assert.match(text, /DTSTART:20260711T070000Z/); assert.match(text, /DTEND:20260711T093000Z/);
  assert.match(text, /UID:golf-ABCD2345-event-1-g1@golfcalc/); assert.match(text, /SEQUENCE:2/); assert.equal((text.match(/^BEGIN:VEVENT/gm) || []).length, 1);
  assert.equal(text.includes('secret'), false); assert.match(text, /Golf\\, test\\;/);
  text.split('\r\n').forEach(line => assert.ok(Buffer.byteLength(line) <= 75));
  const cancelled = events.calendar({ ...scheduled, revision: 3, status: 'cancelled' }, scheduled.groups[0], tour, 'ABCD2345', 'https://app.test/'); assert.match(cancelled, /STATUS:CANCELLED/); assert.match(cancelled, /SEQUENCE:3/);
});
test('personal starts omit cancelled or unassigned groups', () => {
  const first = { ...event(), id: 'first' }, cancelled = { ...event(), id: 'cancelled', status: 'cancelled' };
  assert.equal(events.myStarts([first, cancelled], 'ada').length, 1); assert.equal(events.myStarts([first], 'unknown').length, 0);
});
