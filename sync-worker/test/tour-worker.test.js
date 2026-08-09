import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth.js';
import { PROTOCOL_VERSION } from '../src/validation.js';
import { TOUR_SCHEMA_VERSION } from '../src/tour-validation.js';

function headers(token) {
  const result = { 'Content-Type': 'application/json', 'X-Golf-Protocol': String(PROTOCOL_VERSION) };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

beforeAll(async () => {
  await env.ACCOUNTS_DB.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,last_login_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,session_id TEXT,device_name TEXT,device_type TEXT);
    CREATE TABLE IF NOT EXISTS account_tours (user_id TEXT NOT NULL,tour_code TEXT NOT NULL,role TEXT NOT NULL,member_id TEXT,joined_at INTEGER NOT NULL,PRIMARY KEY(user_id,tour_code));
    CREATE TABLE IF NOT EXISTS account_profiles (user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,player_profile_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_security_events (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,event_type TEXT NOT NULL,created_at INTEGER NOT NULL,device_name TEXT,details TEXT);
    CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,preferences TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
  `);
});

async function accountSession(label, displayName = null) {
  const userId = crypto.randomUUID();
  const token = `${label}`.repeat(43).slice(0, 43);
  const now = Date.now();
  await env.ACCOUNTS_DB.batch([
    env.ACCOUNTS_DB.prepare('INSERT INTO users (id,email,created_at,last_login_at) VALUES (?,?,?,?)')
      .bind(userId, `${userId}@example.com`, now, now),
    env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)')
      .bind(await hashToken(token), userId, now + 60_000, now, now),
    ...(displayName ? [env.ACCOUNTS_DB.prepare('INSERT INTO account_profiles (user_id,display_name,player_profile_json,updated_at) VALUES (?,?,?,?)')
      .bind(userId, displayName, '{}', now)] : []),
  ]);
  return { userId, token };
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
  it('binds organizer and participant permissions to accounts across sessions', async () => {
    const organizer = await accountSession('o');
    const createResponse = await SELF.fetch('https://worker.test/tour', {
      method: 'POST', headers: { ...headers(organizer.token), 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify(configuration()),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/manage`, { headers: headers(organizer.token) })).status).toBe(200);

    const participant = await accountSession('q');
    const memberId = created.tour.members[0].id;
    const joined = await SELF.fetch(`https://worker.test/tour/${created.code}/join`, {
      method: 'POST', headers: headers(participant.token), body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
        invitationToken: created.invitationToken, deviceLabel: 'Ada', memberId,
      }),
    });
    expect(joined.status).toBe(200);
    const access = await SELF.fetch(`https://worker.test/tour/${created.code}/access`, { headers: headers(participant.token) });
    expect(await access.json()).toMatchObject({ role: 'contributor', memberId });
    const tours = await SELF.fetch('https://worker.test/account/tours', { headers: headers(participant.token) });
    expect(await tours.json()).toMatchObject({ tours: [{ code: created.code, role: 'contributor', memberId }] });

    const secondToken = 's'.repeat(43);
    const now = Date.now();
    await env.ACCOUNTS_DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?)')
      .bind(await hashToken(secondToken), participant.userId, now + 60_000, now, now).run();
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/access`, { headers: headers(secondToken) })).status).toBe(200);
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(secondToken), body: JSON.stringify(submission(created)),
    })).status).toBe(201);
  });

  it('manages named memberships and transfers account ownership', async () => {
    const organizer = await accountSession('m', 'Maja');
    const createResponse = await SELF.fetch('https://worker.test/tour', {
      method: 'POST', headers: { ...headers(organizer.token), 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify(configuration()),
    });
    const created = await createResponse.json();
    const participant = await accountSession('p', 'Petter');
    const firstMember = created.tour.members[0].id;
    const secondMember = created.tour.members[1].id;
    const joinedResponse = await SELF.fetch(`https://worker.test/tour/${created.code}/join`, {
      method: 'POST', headers: headers(participant.token), body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
        invitationToken: created.invitationToken, deviceLabel: 'Petters telefon', memberId: firstMember,
      }),
    });
    const joined = await joinedResponse.json();

    const managed = await (await SELF.fetch(`https://worker.test/tour/${created.code}/manage`, { headers: headers(organizer.token) })).json();
    expect(managed.organizer).toEqual({ displayName: 'Maja', accountLinked: true });
    expect(managed.contributors[0]).toMatchObject({
      id: joined.contributorId, displayName: 'Petter', accountLinked: true, role: 'player', memberId: firstMember,
    });

    const membershipBody = (extra = {}) => JSON.stringify({
      protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, ...extra,
    });
    const relinked = await SELF.fetch(`https://worker.test/tour/${created.code}/membership`, {
      method: 'PATCH', headers: headers(participant.token), body: membershipBody({ memberId: secondMember }),
    });
    expect(await relinked.json()).toMatchObject({ memberId: secondMember, membershipRole: 'player' });

    const madeScorekeeper = await SELF.fetch(`https://worker.test/tour/${created.code}/contributors/${joined.contributorId}/membership`, {
      method: 'PATCH', headers: headers(organizer.token), body: membershipBody({ role: 'scorekeeper', memberId: null }),
    });
    expect(madeScorekeeper.status).toBe(200);
    expect(await (await SELF.fetch('https://worker.test/account/tours', { headers: headers(participant.token) })).json())
      .toMatchObject({ tours: [{ code: created.code, role: 'contributor', memberId: null }] });

    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/contributors/${joined.contributorId}/revoke`, {
      method: 'POST', headers: headers(organizer.token), body: membershipBody(),
    })).status).toBe(200);
    expect((await (await SELF.fetch('https://worker.test/account/tours', { headers: headers(participant.token) })).json()).tours).toEqual([]);
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/contributors/${joined.contributorId}/restore`, {
      method: 'POST', headers: headers(organizer.token), body: membershipBody(),
    })).status).toBe(200);

    const transferred = await SELF.fetch(`https://worker.test/tour/${created.code}/transfer-ownership`, {
      method: 'POST', headers: headers(organizer.token), body: membershipBody({ contributorId: joined.contributorId }),
    });
    expect(transferred.status).toBe(200);
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/manage`, { headers: headers(participant.token) })).status).toBe(200);
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/manage`, { headers: headers(organizer.token) })).status).toBe(403);
    expect(await (await SELF.fetch(`https://worker.test/tour/${created.code}/access`, { headers: headers(organizer.token) })).json())
      .toMatchObject({ role: 'contributor', membershipRole: 'scorekeeper' });
    const activity = await (await SELF.fetch(`https://worker.test/tour/${created.code}/activity`, { headers: headers(participant.token) })).json();
    expect(activity.activity.map(item => item.type)).toEqual(expect.arrayContaining([
      'member_joined', 'membership_updated', 'member_removed', 'member_restored', 'ownership_transferred',
    ]));
    expect(activity.activity[0]).toMatchObject({ type: 'ownership_transferred', actorName: 'Maja' });
  });

  it('lists active account sessions without exposing token hashes', async () => {
    const account = await accountSession('d', 'Dashboard');
    const response = await SELF.fetch('https://worker.test/account/sessions', { headers: headers(account.token) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessions[0]).toMatchObject({ current: true });
    expect(JSON.stringify(body)).not.toContain('tokenHash');
  });
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

  it('lets only the organizer cancel and permanently delete a shared tour', async () => {
    const created = await createTour();
    const joined = await joinTour(created);
    const body = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION });
    const deniedCancel = await SELF.fetch(`https://worker.test/tour/${created.code}/cancel`, {
      method: 'POST', headers: headers(joined.body.contributorToken), body,
    });
    expect(deniedCancel.status).toBe(403);

    const cancelled = await SELF.fetch(`https://worker.test/tour/${created.code}/cancel`, {
      method: 'POST', headers: headers(created.organizerToken), body,
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ status: 'cancelled', completedReason: 'cancelled' });
    const rejectedRound = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(joined.body.contributorToken), body: JSON.stringify(submission(created)),
    });
    expect(rejectedRound.status).toBe(400);

    const deniedDelete = await SELF.fetch(`https://worker.test/tour/${created.code}`, {
      method: 'DELETE', headers: headers(joined.body.contributorToken), body,
    });
    expect(deniedDelete.status).toBe(403);
    const deleted = await SELF.fetch(`https://worker.test/tour/${created.code}`, {
      method: 'DELETE', headers: headers(created.organizerToken), body,
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}`)).status).toBe(404);
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

  it('streams live state and lets an appointed administrator announce and audit a round correction', async () => {
    const owner = await accountSession(`o${crypto.randomUUID()}`, 'Owner');
    const member = await accountSession(`m${crypto.randomUUID()}`, 'Ada');
    const createResponse = await SELF.fetch('https://worker.test/tour', {
      method: 'POST', headers: { ...headers(owner.token), 'CF-Connecting-IP': crypto.randomUUID() }, body: JSON.stringify(configuration()),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    const joinResponse = await SELF.fetch(`https://worker.test/tour/${created.code}/join`, {
      method: 'POST', headers: headers(member.token), body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
        invitationToken: created.invitationToken, deviceLabel: 'Adas dator', memberId: created.tour.members[0].id,
      }),
    });
    const joined = await joinResponse.json();
    const promoted = await SELF.fetch(`https://worker.test/tour/${created.code}/contributors/${joined.contributorId}/administrator`, {
      method: 'PATCH', headers: headers(owner.token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, isAdmin: true }),
    });
    expect(promoted.status).toBe(200);
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/access`, { headers: headers(member.token) }).then(response => response.json())).role).toBe('administrator');

    const announcement = await SELF.fetch(`https://worker.test/tour/${created.code}/announcements`, {
      method: 'POST', headers: headers(member.token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, message: 'Samling 09:00' }),
    });
    expect(announcement.status).toBe(201);
    expect((await announcement.json()).tour.announcements[0].message).toBe('Samling 09:00');

    const submitted = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(member.token), body: JSON.stringify(submission(created)),
    });
    const submittedBody = await submitted.json();
    const corrected = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds/${submittedBody.round.id}`, {
      method: 'PATCH', headers: headers(member.token), body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRevision: submittedBody.tour.revision,
        playedDate: '2026-07-11', reason: 'Fel datum vid registrering',
      }),
    });
    expect(corrected.status).toBe(200);
    expect((await corrected.json()).correction).toMatchObject({ before: { playedDate: '2026-07-10' }, after: { playedDate: '2026-07-11' } });

    const spoofedSocket = await SELF.fetch(`https://worker.test/tour/${created.code}/live`, {
      headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `golf-v2, ${'z'.repeat(43)}`, 'X-Account-User': member.userId },
    });
    expect(spoofedSocket.status).toBe(401);
    const socketResponse = await SELF.fetch(`https://worker.test/tour/${created.code}/live`, {
      headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `golf-v2, ${member.token}` },
    });
    expect(socketResponse.status).toBe(101);
    socketResponse.webSocket.accept();
    const firstMessage = await new Promise(resolve => socketResponse.webSocket.addEventListener('message', event => resolve(JSON.parse(event.data)), { once: true }));
    expect(firstMessage.tour.announcements[0].message).toBe('Samling 09:00');
    socketResponse.webSocket.close(1000, 'done');
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
