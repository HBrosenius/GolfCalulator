import '../../src/scoring.js';
const Scoring = globalThis.GolfScoring;
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth.js';
import { PROTOCOL_VERSION } from '../src/validation.js';
import { TOUR_SCHEMA_VERSION } from '../src/tour-validation.js';

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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
    name: 'Delad tour', startDate: daysAgo(10), endDate: daysFromNow(100),
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
    h: index + 1, par, si: course.tees[0].si[index], strokes: Scoring.strokesOnHole(Scoring.calculatePlayingHandicap(member.hi, course.tees[0].slope, course.tees[0].cr, course.tees[0].par, course.holes), course.tees[0].si[index], course.holes),
    score: par + Scoring.strokesOnHole(Scoring.calculatePlayingHandicap(member.hi, course.tees[0].slope, course.tees[0].cr, course.tees[0].par, course.holes), course.tees[0].si[index], course.holes), netto: par, pts: 2, skipped: false,
  }));
  return {
    protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
    clientRoundId: crypto.randomUUID(), playedDate: daysFromNow(20),
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
    const created = await createTour({ ...configuration(), startDate: daysAgo(90), endDate: daysAgo(10) });
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
      name: 'Uppdaterad tour', endDate: daysFromNow(150), bestOfN: null,
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
    expect(tour).toMatchObject({ name: 'Uppdaterad tour', endDate: daysFromNow(150), bestOfN: null, duplicateCourseRule: 'first' });
    expect(tour.courses[0].maxRounds).toBe(4);

    const conflict = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, {
      method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(payload),
    });
    expect(conflict.status).toBe(409);
  });

  it('reopens an automatically expired tour when the organizer extends its dates', async () => {
    const created = await createTour({ ...configuration(), startDate: daysAgo(90), endDate: daysAgo(10) });
    const expired = await (await SELF.fetch(`https://worker.test/tour/${created.code}`)).json();
    const response = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, {
      method: 'PATCH', headers: headers(created.organizerToken),
      body: JSON.stringify(updatePayload(expired, { endDate: daysFromNow(120) })),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'open', completedReason: null, endDate: daysFromNow(120) });
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

    const started = await SELF.fetch(`https://worker.test/tour/${created.code}/round-starts`, {
      method: 'POST', headers: headers(member.token), body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
        courseId: created.tour.courses[0].id, memberIds: [created.tour.members[0].id],
      }),
    });
    expect(started.status).toBe(201);
    const activity = await SELF.fetch(`https://worker.test/tour/${created.code}/activity`, { headers: headers(member.token) }).then(response => response.json());
    expect(activity.activity.some(event => event.type === 'round_started')).toBe(true);

    const submitted = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(member.token), body: JSON.stringify(submission(created)),
    });
    const submittedBody = await submitted.json();
    const corrected = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds/${submittedBody.round.id}`, {
      method: 'PATCH', headers: headers(member.token), body: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRevision: submittedBody.tour.revision,
        playedDate: daysFromNow(21), reason: 'Fel datum vid registrering',
      }),
    });
    expect(corrected.status).toBe(200);
    expect((await corrected.json()).correction).toMatchObject({ before: { playedDate: daysFromNow(20) }, after: { playedDate: daysFromNow(21) } });

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

    const spectatorResponse = await SELF.fetch(`https://worker.test/tour/${created.code}/live`, {
      headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'golf-spectator-v1' },
    });
    expect(spectatorResponse.status).toBe(101);
    spectatorResponse.webSocket.accept();
    const spectatorMessage = await new Promise(resolve => spectatorResponse.webSocket.addEventListener('message', event => resolve(JSON.parse(event.data)), { once: true }));
    expect(spectatorMessage.access.role).toBe('spectator');
    expect(spectatorMessage.tour.rounds).toHaveLength(1);
    spectatorResponse.webSocket.close(1000, 'done');
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
      body: JSON.stringify(submission(created, { playedDate: daysFromNow(120) })),
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

it('round-trips real client submissions through the Worker for every game mode', async () => {
  await import('../../src/tour-rules.js');
  const created = await createTour();
  const course = created.tour.courses[0], tee = course.tees[0];
  const links = Object.fromEntries(created.tour.members.map((member, index) => [index + 1, member.id]));
  for (const gameMode of ['individual', 'match', 'scramble', 'foursome', 'fourball']) {
    const shared = ['scramble', 'foursome'].includes(gameMode);
    const phs = created.tour.members.map(member => Scoring.calculatePlayingHandicap(member.hi, tee.slope, tee.cr, tee.par, course.holes));
    const makeRows = (ph, player = 0) => tee.hpar.map((par, h) => {
      const strokes = Scoring.strokesOnHole(ph, tee.si[h], course.holes);
      const score = par + strokes + (gameMode === 'fourball' ? (h + player) % 2 : 0);
      return { h: h + 1, par, si: tee.si[h], strokes, score, netto: score - strokes, pts: Scoring.calculateStablefordPoints(score, par, strokes), skipped: false };
    });
    const teamPh = gameMode === 'scramble' ? Scoring.calculateScrambleHandicap(...created.tour.members.map(member => member.hi)) : Scoring.calculateFoursomeHandicap(...phs);
    const subjects = (shared ? [teamPh] : phs).map((ph, player) => {
      const rows = makeRows(ph, player);
      return { name: shared ? 'Team A' : created.tour.members[player].name, playerId: player + 1,
        memberIds: shared ? [1, 2] : undefined, tee: tee.name, teamId: gameMode === 'fourball' ? 'A' : null,
        rows, totalPoints: rows.reduce((sum, row) => sum + row.pts, 0), totalBrutto: rows.reduce((sum, row) => sum + row.score, 0) };
    });
    if (gameMode === 'fourball') {
      const total = Scoring.calculateFourballTeamPoints(subjects.map(subject => subject.rows.map(row => row.pts)));
      subjects.forEach(subject => { subject.totalPoints = total; });
    }
    const round = { id: crypto.randomUUID(), date: daysFromNow(20), courseName: course.name, tee: tee.name, holes: course.holes, gameMode, subjects };
    const body = globalThis.GolfTourRules.buildRoundSubmission(round, { tour: created.tour, memberLinks: links });
    const response = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, { method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify(body) });
    expect(response.status, gameMode).toBe(201);
    const saved = (await response.json()).round;
    expect(saved.subjects.map(subject => subject.totalPoints), gameMode).toEqual(body.subjects.map(subject => subject.totalPoints));
    const forged = structuredClone(body); forged.clientRoundId = crypto.randomUUID();
    forged.subjects.forEach(subject => {
      subject.rows.forEach(row => { row.par = 6; row.strokes = 4; row.score = 4; row.netto = 0; row.pts = 8; });
      subject.totalPoints = 72; subject.totalBrutto = 36;
    });
    const rejected = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, { method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify(forged) });
    expect(rejected.status, gameMode).toBe(400);
  }
});

describe('authoritative hole corrections', () => {
  async function recorded() {
    const created = await createTour();
    const response = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, {
      method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify(submission(created)),
    });
    expect(response.status).toBe(201);
    const saved = await response.json();
    const body = { protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION,
      mutationId: crypto.randomUUID(), expectedRoundRevision: 1, reason: 'Felregistrerat slag',
      changes: [{ memberId: saved.round.subjects[0].memberId, hole: 1, score: saved.round.subjects[0].rows[0].score + 1 }] };
    const patch = (payload = body, token = created.organizerToken) => SELF.fetch(`https://worker.test/tour/${created.code}/rounds/${saved.round.id}`, { method: 'PATCH', headers: headers(token), body: JSON.stringify(payload) });
    return { created, saved, body, patch };
  }
  it('recalculates, broadcasts, audits and retries without duplicate corrections', async () => {
    const { created, saved, body, patch } = await recorded();
    const live = await SELF.fetch(`https://worker.test/tour/${created.code}/live`, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `golf-v2, ${created.organizerToken}` } });
    const socket = live.webSocket; socket.accept();
    const update = new Promise(resolve => socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.type === 'round_corrected') resolve(data); }));
    const response = await patch(); expect(response.status).toBe(200);
    const corrected = await response.json();
    expect(corrected.tour.rounds[0]).toMatchObject({ revision: 2, subjects: [{ totalPoints: 17, totalBrutto: saved.round.subjects[0].totalBrutto + 1 }] });
    expect(corrected.tour.rounds[0].scoringSnapshot.members[0].hi).toBe(12);
    expect((await update).tour.rounds[0].subjects[0].totalPoints).toBe(17); socket.close();
    const retry = await patch(); expect(retry.status).toBe(200); expect((await retry.json()).duplicate).toBe(true);
    expect((await patch({ ...body, reason: 'Changed retry' })).status).toBe(409);
    const history = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds/${saved.round.id}/corrections`, { headers: headers(created.organizerToken) });
    expect(history.status).toBe(200); const audit = await history.json();
    expect(audit.corrections).toHaveLength(1);
    expect(audit.corrections[0]).toMatchObject({ reason: body.reason, before: { subjects: [{ totalPoints: 18, rows: [{ score: saved.round.subjects[0].rows[0].score }] }] }, after: { subjects: [{ totalPoints: 17, rows: [{ score: body.changes[0].score }] }] } });
  });
  it('retains every audit entry after the activity feed rolls over and paginates history', async () => {
    const { created, saved, body, patch } = await recorded();
    for (let i = 0; i < 101; i++) {
      const response = await patch({ ...body, expectedRoundRevision: i + 1, mutationId: `audit-${i}`, reason: `Correction ${i}`,
        changes: [{ ...body.changes[0], score: saved.round.subjects[0].rows[0].score + (i % 2 ? 0 : 1) }] });
      expect(response.status).toBe(200);
    }
    let after = '', entries = [];
    do {
      const response = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds/${saved.round.id}/corrections${after ? '?after=' + after : ''}`, { headers: headers(created.organizerToken) });
      expect(response.status).toBe(200); const page = await response.json(); entries.push(...page.corrections); after = page.nextCursor;
    } while (after);
    expect(entries).toHaveLength(101); expect(entries[0].reason).toBe('Correction 0'); expect(entries[100].revision).toBe(102);
    const activity = await SELF.fetch(`https://worker.test/tour/${created.code}/activity`, { headers: headers(created.organizerToken) }).then(response => response.json());
    expect(activity.activity).toHaveLength(100);
  });
  it('rejects unauthorized, stale, malformed and no-op corrections', async () => {
    const { created, saved, body, patch } = await recorded();
    const joined = await joinTour(created);
    expect((await patch(body, joined.body.contributorToken)).status).toBe(403);
    expect((await SELF.fetch(`https://worker.test/tour/${created.code}/rounds/${saved.round.id}/corrections`, { headers: headers('bad') })).status).toBe(403);
    for (const payload of [
      { ...body, reason: ' ' }, { ...body, changes: [{ ...body.changes[0], score: 0 }] },
      { ...body, changes: [{ ...body.changes[0], hole: 10 }] }, { ...body, changes: [] },
      { ...body, playedDate: '2026-02-30' }, { ...body, changes: [{ ...body.changes[0], pts: 8 }] },
    ]) expect((await patch(payload)).status).toBe(400);
    const competing = await Promise.all([patch(), patch({ ...body, mutationId: crypto.randomUUID() })]);
    expect(competing.map(item => item.status).sort()).toEqual([200, 409]);
    const pickup = await patch({ ...body, expectedRoundRevision: 2, mutationId: crypto.randomUUID(), changes: [{ ...body.changes[0], score: null }] });
    expect(pickup.status).toBe(200); expect((await pickup.json()).tour.rounds[0].subjects[0].rows[0]).toMatchObject({ skipped: true, score: '–', pts: 0 });
  });
});

describe('optional round approval', () => {
  it('defaults casual tours to confirmed and locks policy once play is recorded', async () => {
    const created = await createTour(); expect(created.tour.approvalRequired).toBe(false);
    const saved = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, { method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify(submission(created)) }).then(response => response.json());
    expect(saved.round.approvalStatus).toBe('confirmed');
    const change = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, { method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(updatePayload(saved.tour, { approvalRequired: true })) });
    expect(change.status).toBe(400);
    const legacyUpdate = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, { method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(updatePayload(saved.tour)) });
    expect(legacyUpdate.status).toBe(200);
    expect((await legacyUpdate.json()).approvalRequired).toBe(false);
  });
  it('allows an organizer to choose approval before the first submission', async () => {
    const created = await createTour(), joined = await joinTour(created);
    const update = updatePayload(joined.body.tour, { approvalRequired: true });
    const url = `https://worker.test/tour/${created.code}/conditions`;
    expect((await SELF.fetch(url, { method: 'PATCH', headers: headers(joined.body.contributorToken), body: JSON.stringify(update) })).status).toBe(403);
    const response = await SELF.fetch(url, { method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(update) });
    expect(response.status).toBe(200); expect((await response.json()).approvalRequired).toBe(true);
  });
  it('audits confirmation, invalidates approval on correction and rejects stale or unauthorized decisions', async () => {
    const created = await createTour({ ...configuration(), approvalRequired: true }), joined = await joinTour(created);
    const saved = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, { method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify(submission(created)) }).then(response => response.json());
    expect(saved.round.approvalStatus).toBe('provisional');
    expect(saved.tour.rounds).toHaveLength(0); expect(saved.tour.provisionalRounds).toHaveLength(1);
    const body = { protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRoundRevision: 1, mutationId: crypto.randomUUID(), approvalStatus: 'confirmed', reason: 'Scorekort granskat' };
    const url = `https://worker.test/tour/${created.code}/rounds/${saved.round.id}`;
    const patch = (payload, token = created.organizerToken) => SELF.fetch(url, { method: 'PATCH', headers: headers(token), body: JSON.stringify(payload) });
    expect((await patch(body, joined.body.contributorToken)).status).toBe(403);
    expect((await patch({ ...body, reason: '' })).status).toBe(400);
    const response = await patch(body); expect(response.status).toBe(200);
    const confirmed = await response.json(); expect(confirmed.tour.rounds[0]).toMatchObject({ revision: 2, approvalStatus: 'confirmed' });
    expect(confirmed.tour.rounds[0].correctedAt).toBeUndefined();
    expect(confirmed.correction).toMatchObject({ type: 'approval', before: { approvalStatus: 'provisional' }, after: { approvalStatus: 'confirmed' } });
    expect((await patch(body).then(response => response.json())).duplicate).toBe(true);
    const correction = { protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRoundRevision: 2, mutationId: crypto.randomUUID(), reason: 'Fel hålscore', changes: [{ memberId: saved.round.subjects[0].memberId, hole: 1, score: 6 }] };
    const corrected = await patch(correction); expect(corrected.status).toBe(200);
    expect((await corrected.json()).round).toMatchObject({ approvalStatus: 'provisional', revision: 3, approvedAt: null });
    expect((await patch({ ...body, expectedRoundRevision: 2, mutationId: crypto.randomUUID() })).status).toBe(409);
    expect((await patch({ ...body, expectedRoundRevision: 3, mutationId: crypto.randomUUID(), changes: correction.changes })).status).toBe(400);
    const reconfirm = await patch({ ...body, expectedRoundRevision: 3, mutationId: crypto.randomUUID() }); expect(reconfirm.status).toBe(200);
    const reopened = await patch({ ...body, expectedRoundRevision: 4, approvalStatus: 'provisional', mutationId: crypto.randomUUID(), reason: 'Behöver kontrolleras igen' }); expect(reopened.status).toBe(200);
    const reopening = await reopened.json(); expect(reopening.round.approvalStatus).toBe('provisional'); expect(reopening.tour.rounds).toHaveLength(0);
    const history = await SELF.fetch(url + '/corrections', { headers: headers(created.organizerToken) }).then(response => response.json());
    expect(history.corrections).toHaveLength(4);
  });
});

describe('withdrawal, disqualification and reinstatement', () => {
  for (const approvalRequired of [false, true]) {
    it(`preserves scores, audits decisions and reinstates safely (approval=${approvalRequired})`, async () => {
      const created = await createTour({ ...configuration(), approvalRequired }), joined = await joinTour(created);
      const saved = await SELF.fetch(`https://worker.test/tour/${created.code}/rounds`, { method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify(submission(created)) }).then(response => response.json());
      const url = `https://worker.test/tour/${created.code}/rounds/${saved.round.id}`;
      const patch = (body, token = created.organizerToken) => SELF.fetch(url, { method: 'PATCH', headers: headers(token), body: JSON.stringify(body) });
      const request = (round, resultStatus) => ({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRoundRevision: round.revision, mutationId: crypto.randomUUID(), resultStatus, reason: 'Resultat granskat av organisatör' });
      let current = saved.round;
      if (approvalRequired) current = (await (await patch({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRoundRevision: 1, mutationId: crypto.randomUUID(), approvalStatus: 'confirmed', reason: 'Granskat scorekort' })).json()).round;
      const withdrawn = request(current, 'withdrawn'), disqualified = request(current, 'disqualified');
      expect((await patch(withdrawn, joined.body.contributorToken)).status).toBe(403);
      for (const body of [{ ...withdrawn, reason: ' ' }, { ...withdrawn, resultStatus: 'invented' }, { ...withdrawn, mutationId: undefined }, { ...withdrawn, changes: [] }, { ...withdrawn, approvalStatus: 'confirmed' }]) expect((await patch(body)).status).toBe(400);
      const live = await SELF.fetch(`https://worker.test/tour/${created.code}/live`, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `golf-v2, ${created.organizerToken}` } });
      const socket = live.webSocket; socket.accept();
      const update = new Promise(resolve => socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (['round_withdrawn', 'round_disqualified'].includes(data.type)) resolve(data); }));
      const responses = await Promise.all([patch(withdrawn), patch(disqualified)]);
      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      const successIndex = responses.findIndex(response => response.status === 200), originalRequest = [withdrawn, disqualified][successIndex];
      const removed = await responses[successIndex].json(); current = removed.round;
      expect(removed.tour.rounds).toHaveLength(0); expect(removed.tour.provisionalRounds).toHaveLength(0); expect(removed.tour.excludedRounds).toHaveLength(1);
      expect(current.subjects).toEqual(saved.round.subjects); expect(current.correctedAt).toBeUndefined();
      expect((await update).tour.excludedRounds[0].id).toBe(current.id); socket.close();
      expect((await patch(request(current, current.resultStatus))).status).toBe(400);
      const edit = { protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, expectedRoundRevision: current.revision, mutationId: crypto.randomUUID(), reason: 'Edit excluded result', changes: [{ memberId: current.subjects[0].memberId, hole: 1, score: 5 }] };
      expect((await patch(edit)).status).toBe(400);
      if (approvalRequired) expect((await patch({ ...edit, changes: undefined, approvalStatus: 'confirmed' })).status).toBe(400);
      const switched = await patch(request(current, current.resultStatus === 'withdrawn' ? 'disqualified' : 'withdrawn'));
      expect(switched.status).toBe(200); current = (await switched.json()).round;
      const restored = await patch(request(current, 'active')); expect(restored.status).toBe(200); const restoration = await restored.json(); current = restoration.round;
      expect(current.subjects).toEqual(saved.round.subjects);
      expect(current.approvalStatus).toBe(approvalRequired ? 'provisional' : 'confirmed');
      expect(restoration.tour.rounds).toHaveLength(approvalRequired ? 0 : 1);
      expect(restoration.tour.provisionalRounds).toHaveLength(approvalRequired ? 1 : 0);
      expect(restoration.tour.excludedRounds).toHaveLength(0);
      const retry = await patch(originalRequest); expect(retry.status).toBe(200); expect((await retry.json()).duplicate).toBe(true);
      const audit = await SELF.fetch(url + '/corrections', { headers: headers(joined.body.contributorToken) }).then(response => response.json());
      const statuses = audit.corrections.filter(entry => entry.type === 'result_status'); expect(statuses).toHaveLength(3);
      expect(statuses[0].before.resultStatus).toBe('active'); expect(statuses[2].after.resultStatus).toBe('active');
      expect(statuses[0].before.subjects[0].rows).toEqual([]); expect(statuses[0].after.subjects[0].totalPoints).toBe(saved.round.subjects[0].totalPoints);
    });
  }
});

describe('scheduled events and start groups', () => {
  function eventPayload(tour) {
    return { name: 'Helggolf', date: daysFromNow(20), timeZone: 'Europe/Stockholm', courseId: tour.courses[0].id, status: 'scheduled', note: 'Samling vid klubbhuset', groups: [{ id: 'group-1', name: 'Första gruppen', teeTime: '09:10', memberIds: tour.members.map(member => member.id) }] };
  }
  it('keeps schedules private, supports organizers and rejects invalid assignments', async () => {
    const created = await createTour(), joined = await joinTour(created);
    const url = `https://worker.test/tour/${created.code}/events`;
    const body = { protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, mutationId: crypto.randomUUID(), expectedRevision: joined.body.tour.revision, event: eventPayload(created.tour) };
    const post = (payload, token = created.organizerToken) => SELF.fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify(payload) });
    expect((await SELF.fetch(url, { headers: headers('invalid') })).status).toBe(403);
    expect((await post(body, joined.body.contributorToken)).status).toBe(403);
    const duplicate = structuredClone(body); duplicate.event.groups.push({ ...duplicate.event.groups[0], id: 'other' }); expect((await post(duplicate)).status).toBe(400);
    const invalidZone = structuredClone(body); invalidZone.event.timeZone = 'No/such-zone'; expect((await post(invalidZone)).status).toBe(400);
    const response = await post(body); expect(response.status).toBe(201); const saved = await response.json();
    expect(saved.event).toMatchObject({ revision: 1, groups: [{ id: 'group-1', teeTime: '09:10' }] });
    expect(saved.tour.scheduleRevision).toBe(1); expect(saved.tour.events).toBeUndefined();
    const listed = await SELF.fetch(url, { headers: headers(joined.body.contributorToken) }).then(response => response.json()); expect(listed.events).toHaveLength(1); expect(listed.events[0].id).toBe(saved.event.id);
    const retry = await post(body); expect(retry.status).toBe(200); expect((await retry.json()).duplicate).toBe(true);
    expect((await post({ ...body, event: { ...body.event, name: 'Different retry' } })).status).toBe(409);
  });
  it('serializes competing schedule changes, broadcasts and keeps date changes within planned events', async () => {
    const created = await createTour(), url = `https://worker.test/tour/${created.code}/events`;
    const createdEvent = await SELF.fetch(url, { method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, mutationId: crypto.randomUUID(), expectedRevision: created.tour.revision, event: eventPayload(created.tour) }) }).then(response => response.json());
    const live = await SELF.fetch(`https://worker.test/tour/${created.code}/live`, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `golf-v2, ${created.organizerToken}` } }); const socket = live.webSocket; socket.accept();
    const update = new Promise(resolve => socket.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.type === 'event_cancelled') resolve(data); }));
    const body = { protocolVersion: PROTOCOL_VERSION, schemaVersion: TOUR_SCHEMA_VERSION, mutationId: crypto.randomUUID(), expectedEventRevision: 1, event: { ...eventPayload(created.tour), status: 'cancelled' } };
    const patch = payload => SELF.fetch(url + '/' + createdEvent.event.id, { method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(payload) });
    const responses = await Promise.all([patch(body), patch({ ...body, mutationId: crypto.randomUUID() })]); expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const cancelled = await responses.find(response => response.status === 200).json(); expect(cancelled.event.status).toBe('cancelled'); expect((await update).tour.scheduleRevision).toBe(2); socket.close();
    const restored = await patch({ ...body, expectedEventRevision: 2, mutationId: crypto.randomUUID(), event: eventPayload(created.tour) }); expect(restored.status).toBe(200); const scheduled = await restored.json(); expect(scheduled.event.revision).toBe(3);
    const shortened = await SELF.fetch(`https://worker.test/tour/${created.code}/conditions`, { method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(updatePayload(scheduled.tour, { endDate: daysFromNow(10) })) }); expect(shortened.status).toBe(400);
    const events = await SELF.fetch(url, { headers: headers(created.organizerToken) }).then(response => response.json()); expect(events.events[0].groups[0].id).toBe('group-1'); expect(events.scheduleRevision).toBe(3);
  });
});
