import '../../src/scoring.js';
const Scoring = globalThis.GolfScoring;
import { describe, expect, it } from 'vitest';
import { TOUR_SCHEMA_VERSION, validateTourCreate, validateTourRoundSubmission, validateTourUpdate } from '../src/tour-validation.js';
import { PROTOCOL_VERSION } from '../src/validation.js';

function validTour() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: TOUR_SCHEMA_VERSION,
    name: 'Sommar-touren', startDate: '2026-06-01', endDate: '2026-08-31',
    bestOfN: 4, duplicateCourseRule: 'best',
    members: [{ name: 'Ada', hi: 12.4 }, { name: 'Bo', hi: 8 }],
    courses: [{
      name: 'Testbanan', holes: 9, maxRounds: 2,
      tees: [{
        name: 'Gul', slope: 113, cr: 36, par: 36,
        hpar: [4, 3, 4, 4, 5, 3, 4, 4, 5],
        si: [1, 3, 5, 7, 9, 11, 13, 15, 17],
      }],
    }],
  };
}

describe('shared tour creation contract', () => {
  it('accepts a complete versioned configuration', () => {
    expect(validateTourCreate(validTour())).toBeNull();
  });

  it('rejects unsupported versions and unknown fields', () => {
    expect(validateTourCreate({ ...validTour(), protocolVersion: 999 })).toMatch(/protocol/i);
    expect(validateTourCreate({ ...validTour(), schemaVersion: 999 })).toMatch(/schema/i);
    expect(validateTourCreate({ ...validTour(), organizerToken: 'must-not-be-client-controlled' })).toMatch(/configuration/i);
  });

  it('rejects impossible date windows and duplicate member names', () => {
    expect(validateTourCreate({ ...validTour(), endDate: '2026-05-31' })).toMatch(/dates/i);
    expect(validateTourCreate({ ...validTour(), members: [{ name: 'Ada', hi: 1 }, { name: ' ada ', hi: 2 }] })).toMatch(/unique/i);
  });

  it('requires complete course and tee snapshots', () => {
    const missingHole = validTour();
    missingHole.courses[0].tees[0].hpar.pop();
    expect(validateTourCreate(missingHole)).toMatch(/courses/i);

    const duplicateTee = validTour();
    duplicateTee.courses[0].tees.push({ ...duplicateTee.courses[0].tees[0], name: 'gul' });
    expect(validateTourCreate(duplicateTee)).toMatch(/courses/i);
  });
});

describe('shared tour round contract', () => {
  it('recomputes Stableford and gross totals from hole rows', () => {
    const config = validTour();
    const tour = {
      ...config, status: 'open',
      members: [{ id: 'm1', name: 'Ada', hi: 12 }, { id: 'm2', name: 'Bo', hi: 8 }],
      courses: [{ id: 'c1', ...config.courses[0] }],
    };
    const rows = config.courses[0].tees[0].hpar.map((par, index) => ({
      h: index + 1, par, si: config.courses[0].tees[0].si[index], strokes: Scoring.strokesOnHole(6, config.courses[0].tees[0].si[index], 9),
      score: par + Scoring.strokesOnHole(6, config.courses[0].tees[0].si[index], 9), netto: par, pts: 2, skipped: false,
    }));
    const body = {
      protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
      clientRoundId: 'round-1', playedDate: '2026-07-01', courseId: 'c1', gameMode: 'individual',
      subjects: [{ memberId: 'm1', teeName: 'Gul', totalPoints: 18, totalBrutto: rows.reduce((sum, row) => sum + row.score, 0), rows }],
    };
    expect(validateTourRoundSubmission(body, tour)).toBeNull();
    body.subjects[0].rows[0].pts = 8;
    expect(validateTourRoundSubmission(body, tour)).toMatch(/subjects|points/i);
  });
});

describe('shared tour update contract', () => {
  it('accepts editable conditions while requiring exact course coverage', () => {
    const config = validTour();
    const tour = { courses: [{ id: 'c1', ...config.courses[0] }], rounds: [] };
    const update = {
      protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRevision: 1,
      name: 'Hösttouren', startDate: '2026-06-01', endDate: '2026-09-30', bestOfN: null,
      duplicateCourseRule: 'first', courseLimits: [{ courseId: 'c1', maxRounds: 4 }],
    };
    expect(validateTourUpdate(update, tour)).toBeNull();
    expect(validateTourUpdate({ ...update, courseLimits: [] }, tour)).toMatch(/limits/i);
    expect(validateTourUpdate({ ...update, members: [] }, tour)).toMatch(/update/i);
  });

  it('does not allow edited dates to exclude an existing round', () => {
    const config = validTour();
    const tour = { courses: [{ id: 'c1', ...config.courses[0] }], rounds: [{ playedDate: '2026-07-10' }] };
    const update = {
      protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRevision: 2,
      name: 'Tour', startDate: '2026-07-11', endDate: '2026-08-31', bestOfN: 2,
      duplicateCourseRule: 'best', courseLimits: [{ courseId: 'c1', maxRounds: 2 }],
    };
    expect(validateTourUpdate(update, tour)).toMatch(/existing rounds/i);
  });
});

describe('server scoring authority', () => {
  function setup(mode = 'individual') {
    const config = validTour();
    const tour = { ...config, status: 'open', members: [{ id: 'm1', name: 'Ada', hi: 0 }, { id: 'm2', name: 'Bo', hi: 0 }], courses: [{ id: 'c1', ...config.courses[0] }] };
    const rows = tour.courses[0].tees[0].hpar.map((par, h) => ({ h: h + 1, par, si: h * 2 + 1, strokes: 0, score: par, netto: par, pts: 2, skipped: false }));
    const body = { protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, clientRoundId: 'authority', playedDate: '2026-07-01', courseId: 'c1', gameMode: mode,
      subjects: [{ memberId: 'm1', teeName: 'Gul', totalPoints: 18, totalBrutto: 36, rows }] };
    return { tour, body };
  }

  it('rejects internally consistent inflated par, stroke index and handicap allocations', () => {
    const { tour, body } = setup();
    body.subjects[0].rows.forEach(row => Object.assign(row, { par: 6, strokes: 4, score: 4, netto: 0, pts: 8 }));
    body.subjects[0].totalPoints = 72;
    expect(validateTourRoundSubmission(body, tour)).toMatch(/stored course|handicap|points/);
    const changedIndex = setup(); changedIndex.body.subjects[0].rows[0].si = 18;
    expect(validateTourRoundSubmission(changedIndex.body, changedIndex.tour)).toMatch(/stored course/);
  });

  it('round-trips actual fourball serialization with different teammate contributions', async () => {
    await import('../../src/tour-rules.js');
    const { tour, body } = setup('fourball');
    const second = structuredClone(body.subjects[0]);
    second.memberId = 'm2';
    second.rows.forEach(row => Object.assign(row, { score: row.par + 1, netto: row.par + 1, pts: 1 }));
    second.totalBrutto = 45;
    body.subjects[0].teamId = second.teamId = 'A';
    body.subjects.push(second);
    const round = { id: 'fourball', date: body.playedDate, courseName: tour.courses[0].name, holes: 9, tee: 'Gul', gameMode: 'fourball',
      subjects: body.subjects.map(subject => ({ ...subject, tee: 'Gul' })) };
    const payload = globalThis.GolfTourRules.buildRoundSubmission(round, { tour });
    expect(validateTourRoundSubmission(payload, tour)).toBeNull();
    payload.subjects[0].totalPoints = 19;
    expect(validateTourRoundSubmission(payload, tour)).toMatch(/points/);
  });

  it('validates each team mode and rejects incomplete or inconsistent teams', () => {
    for (const mode of ['scramble', 'foursome', 'fourball']) {
      const { tour, body } = setup(mode);
      body.subjects[0].teamId = 'A';
      expect(validateTourRoundSubmission(body, tour)).toMatch(/two distinct members/);
      body.subjects.push({ ...structuredClone(body.subjects[0]), memberId: 'm2' });
      expect(validateTourRoundSubmission(body, tour)).toBeNull();
      if (mode !== 'fourball') {
        body.subjects[1].rows[0] = { ...body.subjects[1].rows[0], score: 5, netto: 5, pts: 1 };
        body.subjects[1].totalBrutto++;
        expect(validateTourRoundSubmission(body, tour)).toMatch(/Shared team rows/);
      }
    }
  });

  it('accepts a signed plus handicap using the stored member and tee', () => {
    const { tour, body } = setup();
    tour.members[0].hi = -2;
    body.subjects[0].rows[8] = { ...body.subjects[0].rows[8], strokes: -1, netto: 6, pts: 1 };
    body.subjects[0].totalPoints = 17;
    expect(validateTourRoundSubmission(body, tour)).toBeNull();
  });
});
