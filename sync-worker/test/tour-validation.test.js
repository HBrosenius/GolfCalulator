import { describe, expect, it } from 'vitest';
import { TOUR_SCHEMA_VERSION, validateTourCreate, validateTourRoundSubmission } from '../src/tour-validation.js';
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
      h: index + 1, par, si: config.courses[0].tees[0].si[index], strokes: 1,
      score: par + 1, netto: par, pts: 2, skipped: false,
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
