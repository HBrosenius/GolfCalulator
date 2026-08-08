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

async function createTour() {
  const response = await SELF.fetch('https://worker.test/tour', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
    body: JSON.stringify(configuration()),
  });
  expect(response.status).toBe(201);
  return response.json();
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
});
