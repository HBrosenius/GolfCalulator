import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/validation.js';
import { TOUR_SCHEMA_VERSION } from '../src/tour-validation.js';

function headers(token) {
  const result = { 'Content-Type': 'application/json', 'X-Golf-Protocol': String(PROTOCOL_VERSION) };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

function configuration() {
  return {
    protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
    name: 'Delad tour', startDate: '2026-06-01', endDate: '2026-08-31',
    bestOfN: 2, duplicateCourseRule: 'best',
    members: [{ name: 'Ada', hi: 12 }, { name: 'Bo', hi: 8 }],
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

async function createTour(config = configuration()) {
  const response = await SELF.fetch('https://worker.test/tour', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
    body: JSON.stringify(config),
  });
  expect(response.status).toBe(201);
  return response.json();
}

function updatePayload(tour, overrides = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRevision: tour.revision,
    name: tour.name, startDate: tour.startDate, endDate: tour.endDate, bestOfN: tour.bestOfN,
    duplicateCourseRule: tour.duplicateCourseRule,
    courseLimits: tour.courses.map(course => ({ courseId: course.id, maxRounds: course.maxRounds })),
    ...overrides,
  };
}

async function joinTour(created, invitationToken = created.invitationToken) {
  const response = await SELF.fetch(`https://worker.test/tour/${created.code}/join`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
      invitationToken, deviceLabel: 'Bos telefon',
    }),
  });
  return { response, body: await response.json() };
}

function submission(created, overrides = {}) {
  const member = created.tour.members[0];
  const course = created.tour.courses[0];
  const rows = course.tees[0].hpar.map((par, index) => ({
    h: index + 1, par, si: course.tees[0].si[index], strokes: 1,
    score: par + 1, netto: par, pts: 2, skipped: false,
  }));
  return {
    protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
    clientRoundId: crypto.randomUUID(), playedDate: '2026-07-10',
    courseId: course.id, gameMode: 'individual',
    subjects: [{ memberId: member.id, teeName: course.tees[0].name, totalPoints: 18, totalBrutto: rows.reduce((sum, row) => sum + row.score, 0), rows, teamId: null }],
    ...overrides,
  };
}

function liveRound(tourCode) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    courseName: 'Testbanan', teeColor: 'Gul', holes: 9,
    slope: 113, cr: 36, par: 36,
    hpar: [4, 3, 4, 4, 5, 3, 4, 4, 5], si: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    gameMode: 'individual', players: [{ name: 'Ada', hi: 12, ph: 6, tee: 'Gul' }],
    teams: null, seatCount: 1, tourRef: { code: tourCode },
  };
}

describe('shared tour authorization', () => {
  it('creates durable public state without leaking credentials', async () => {
    const created = await createTour();
    expect(created.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(created.organizerToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
    expect(created.invitationToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
    expect(created.tour.members).toHaveLength(2);
    expect(created.tour.members[0].id).toBeTruthy();
    expect(created.tour.courses[0].id).toBeTruthy();

    const response = await SELF.fetch(`https://worker.test/tour/${created.code}`);
    expect(response.status).toBe(200);
    const publicState = await response.json();
    expect(publicState.name).toBe('Delad tour');
    expect(publicState.rounds).toEqual([]);
    expect(JSON.stringify(publicState)).not.toMatch(/token|hash|invitation|organizer/i);
  });

  it('exchanges the invitation for a device-specific contributor token', async () => {
    const created = await createTour();
    const first = await joinTour(created);
    const second = await joinTour(created);
    expect(first.response.status).toBe(200);
    expect(first.body.contributorToken).toMatch(/^[A-Za-z0-9_-]{40,64}$/);
    expect(first.body.contributorId).not.toBe(second.body.contributorId);
    expect(first.body.contributorToken).not.toBe(second.body.contributorToken);
    expect(second.body.tour.contributorCount).toBe(2);

    const access = await SELF.fetch(`https://worker.test/tour/${created.code}/access`, {
      headers: headers(first.body.contributorToken),
    });
    expect(access.status).toBe(200);
    expect(await access.json()).toEqual({ role: 'contributor', contributorId: first.body.contributorId });
  });

  it('rejects an invalid invitation secret', async () => {
    const created = await createTour();
    const joined = await joinTour(created, 'A'.repeat(43));
    expect(joined.response.status).toBe(403);
    expect(joined.body).toEqual({ error: 'Invitation rejected' });
  });

  it('lets only the organizer revoke a contributor', async () => {
    const created = await createTour();
    const joined = await joinTour(created);
    const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION });
    const denied = await SELF.fetch(`https://worker.test/tour/${created.code}/contributors/${joined.body.contributorId}/revoke`, {
      method: 'POST', headers: headers(joined.body.contributorToken), body,
    });
    expect(denied.status).toBe(403);

    const revoked = await SELF.fetch(`https://worker.test/tour/${created.code}/contributors/${joined.body.contributorId}/revoke`, {
      method: 'POST', headers: headers(created.organizerToken), body,
    });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).contributorCount).toBe(0);

    const access = await SELF.fetch(`https://worker.test/tour/${created.code}/access`, {
      headers: headers(joined.body.contributorToken),
    });
    expect(access.status).toBe(403);
  });

  it('lets the organizer manage contributors, rotate invitations, and complete the tour', async () => {
    const created = await createTour();
    const joined = await joinTour(created);
    const denied = await SELF.fetch(`https://worker.test/tour/${created.code}/manage`, {
      headers: headers(joined.body.contributorToken),
    });
    expect(denied.status).toBe(403);

    const managed = await SELF.fetch(`https://worker.test/tour/${created.code}/manage`, {
      headers: headers(created.organizerToken),
    });
    expect(managed.status).toBe(200);
    const managedBody = await managed.json();
    expect(managedBody.contributors[0]).toMatchObject({ id: joined.body.contributorId, deviceLabel: 'Bos telefon', revokedAt: null });
    expect(JSON.stringify(managedBody)).not.toContain(joined.body.contributorToken);

    const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION });
    const rotated = await SELF.fetch(`https://worker.test/tour/${created.code}/rotate-invitation`, {
      method: 'POST', headers: headers(created.organizerToken), body,
    });
    expect(rotated.status).toBe(200);
    const rotatedBody = await rotated.json();
    expect(rotatedBody.invitationToken).not.toBe(created.invitationToken);
    expect((await joinTour(created)).response.status).toBe(403);
    expect((await joinTour(created, rotatedBody.invitationToken)).response.status).toBe(200);

    const completed = await SELF.fetch(`https://worker.test/tour/${created.code}/complete`, {
      method: 'POST', headers: headers(created.organizerToken), body,
    });
    expect(completed.status).toBe(200);
    expect((await completed.json()).status).toBe('completed');
    const rejectedRound = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(joined.body.contributorToken), body: JSON.stringify(submission(created)),
    });
    expect(rejectedRound.status).toBe(400);
  });

  it('automatically completes a tour after its end date', async () => {
    const created = await createTour({ ...configuration(), startDate: '2025-06-01', endDate: '2025-08-31' });
    const response = await SELF.fetch(`https://worker.test/tour/${created.code}`);
    expect(response.status).toBe(200);
    const tour = await response.json();
    expect(tour.status).toBe('completed');
    expect(tour.completedReason).toBe('expired');
    expect(tour.revision).toBe(created.tour.revision + 1);
  });

  it('lets only the organizer edit published conditions with revision protection', async () => {
    const created = await createTour();
    const joined = await joinTour(created);
    const payload = updatePayload(joined.body.tour, {
      name: 'Uppdaterad tour', endDate: '2026-09-30', bestOfN: null,
      duplicateCourseRule: 'first',
      courseLimits: joined.body.tour.courses.map(course => ({ courseId: course.id, maxRounds: 4 })),
    });
    const denied = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, {
      method: 'PATCH', headers: headers(joined.body.contributorToken), body: JSON.stringify(payload),
    });
    expect(denied.status).toBe(403);

    const updated = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, {
      method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(payload),
    });
    expect(updated.status).toBe(200);
    const tour = await updated.json();
    expect(tour).toMatchObject({ name: 'Uppdaterad tour', endDate: '2026-09-30', bestOfN: null, duplicateCourseRule: 'first' });
    expect(tour.courses[0].maxRounds).toBe(4);

    const conflict = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, {
      method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(payload),
    });
    expect(conflict.status).toBe(409);
  });

  it('reopens an automatically expired tour when the organizer extends its dates', async () => {
    const created = await createTour({ ...configuration(), startDate: '2025-06-01', endDate: '2025-08-31' });
    const expired = await (await SELF.fetch(`https://worker.test/tour/${created.code}`)).json();
    const response = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, {
      method: 'PATCH', headers: headers(created.organizerToken),
      body: JSON.stringify(updatePayload(expired, { endDate: '2027-08-31' })),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'open', completedReason: null, endDate: '2027-08-31' });
  });

  it('allows contributors to submit validated rounds idempotently', async () => {
    const created = await createTour();
    const joined = await joinTour(created);
    const payload = submission(created);
    const first = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(joined.body.contributorToken), body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.duplicate).toBe(false);
    expect(firstBody.round.subjects[0].name).toBe('Ada');

    const retry = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(joined.body.contributorToken), body: JSON.stringify(payload),
    });
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.duplicate).toBe(true);
    expect(retryBody.round.id).toBe(firstBody.round.id);
    expect(retryBody.tour.rounds).toHaveLength(1);
  });

  it('rejects unauthorized, ineligible, and internally inconsistent rounds', async () => {
    const created = await createTour();
    const payload = submission(created);
    const unauthorized = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(), body: JSON.stringify(payload),
    });
    expect(unauthorized.status).toBe(403);

    const joined = await joinTour(created);
    const badPoints = submission(created);
    badPoints.subjects[0].totalPoints = 19;
    const invalid = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(joined.body.contributorToken), body: JSON.stringify(badPoints),
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatch(/points/i);

    const outside = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(joined.body.contributorToken),
      body: JSON.stringify(submission(created, { playedDate: '2026-09-01' })),
    });
    expect(outside.status).toBe(400);
  });

  it('requires tour access before creating a tour-linked live room', async () => {
    const created = await createTour();
    const joined = await joinTour(created);
    const denied = await SELF.fetch('https://worker.test/room', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify(liveRound(created.code)),
    });
    expect(denied.status).toBe(403);

    const allowed = await SELF.fetch('https://worker.test/room', {
      method: 'POST', headers: { ...headers(joined.body.contributorToken), 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify(liveRound(created.code)),
    });
    expect(allowed.status).toBe(201);
    expect((await allowed.json()).room.tourRef).toEqual({ code: created.code });
  });
});
