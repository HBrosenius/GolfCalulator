import { DurableObject } from 'cloudflare:workers';
import { generateToken, hashToken, tokenMatches } from './auth.js';
import { PROTOCOL_VERSION } from './validation.js';
import { TOUR_SCHEMA_VERSION } from './tour-validation.js';
import { validateTourRoundSubmission, validateTourUpdate } from './tour-validation.js';

const TOUR_KEY = 'tour';
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const result = (status, data = {}) => ({ status, ...data });

function publicTour(tour) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: TOUR_SCHEMA_VERSION,
    revision: tour.revision,
    createdAt: tour.createdAt,
    updatedAt: tour.updatedAt,
    retentionUntil: tour.retentionUntil,
    name: tour.name,
    startDate: tour.startDate,
    endDate: tour.endDate,
    status: tour.status,
    completedReason: tour.completedReason || null,
    bestOfN: tour.bestOfN,
    duplicateCourseRule: tour.duplicateCourseRule,
    members: tour.members,
    courses: tour.courses,
    rounds: tour.rounds,
    contributorCount: tour.contributors.filter(item => !item.revokedAt).length,
  };
}

export class Tour extends DurableObject {
  completionAt(tour) {
    return new Date(`${tour.endDate}T23:59:59.999Z`).getTime() + 1;
  }

  async scheduleLifecycle(tour) {
    const next = tour.status === 'open' ? Math.min(this.completionAt(tour), tour.retentionUntil) : tour.retentionUntil;
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
  }

  async ensureLifecycle(tour) {
    const today = new Date().toISOString().slice(0, 10);
    if (tour.status === 'open' && tour.endDate < today) {
      tour.status = 'completed';
      tour.completedReason = 'expired';
      tour.updatedAt = Date.now();
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
      await this.scheduleLifecycle(tour);
    }
    return tour;
  }

  async actorForToken(tour, token, accountUserId = null) {
    if (accountUserId && tour.organizerAccountUserId === accountUserId) return { role: 'organizer', id: 'organizer', accountUserId };
    if (accountUserId) {
      const contributor = tour.contributors.find(item => !item.revokedAt && item.accountUserId === accountUserId);
      if (contributor) return { role: 'contributor', id: contributor.id, accountUserId, memberId: contributor.memberId || null };
    }
    if (await tokenMatches(token, tour.organizerTokenHash)) return { role: 'organizer', id: 'organizer' };
    for (const contributor of tour.contributors) {
      if (!contributor.revokedAt && await tokenMatches(token, contributor.tokenHash)) {
        return { role: 'contributor', id: contributor.id };
      }
    }
    return null;
  }

  async create(config, organizerTokenHash, invitationTokenHash) {
    if (await this.ctx.storage.get(TOUR_KEY)) return result(409, { error: 'Tour unavailable' });
    const now = Date.now();
    const retentionUntil = new Date(`${config.endDate}T23:59:59.999Z`).getTime() + RETENTION_MS;
    const tour = {
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: TOUR_SCHEMA_VERSION,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      retentionUntil,
      name: config.name,
      startDate: config.startDate,
      endDate: config.endDate,
      status: 'open',
      completedReason: null,
      bestOfN: config.bestOfN,
      duplicateCourseRule: config.duplicateCourseRule,
      members: config.members.map(member => ({ id: crypto.randomUUID(), name: member.name.trim(), hi: member.hi })),
      courses: config.courses.map(course => ({ id: crypto.randomUUID(), ...course })),
      rounds: [],
      organizerTokenHash,
      invitationTokenHash,
      contributors: [],
      organizerAccountUserId: null,
    };
    await this.ctx.storage.put(TOUR_KEY, tour);
    await this.scheduleLifecycle(tour);
    return result(201, { tour: publicTour(tour) });
  }

  async bindOrganizerAccount(accountUserId) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (!tour.organizerAccountUserId) {
      tour.organizerAccountUserId = accountUserId;
      tour.updatedAt = Date.now();
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
    }
    return result(tour.organizerAccountUserId === accountUserId ? 200 : 409, { tour: publicTour(tour) });
  }

  async getPublicState() {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    return tour ? result(200, { tour: publicTour(tour) }) : result(404, { error: 'Tour not found' });
  }

  async join(body, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION ||
      typeof body.invitationToken !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(body.invitationToken) ||
      (body.deviceLabel !== undefined && (typeof body.deviceLabel !== 'string' || body.deviceLabel.length > 50)) ||
      (body.memberId !== undefined && (typeof body.memberId !== 'string' || !tour.members.some(member => member.id === body.memberId))) ||
      Object.keys(body || {}).some(key => !['protocolVersion', 'schemaVersion', 'invitationToken', 'deviceLabel', 'memberId'].includes(key))) {
      return result(400, { error: 'Invalid request' });
    }
    if (!await tokenMatches(body.invitationToken, tour.invitationTokenHash)) return result(403, { error: 'Invitation rejected' });
    if (accountUserId) {
      const existing = tour.contributors.find(item => !item.revokedAt && item.accountUserId === accountUserId);
      if (existing) return result(200, { tour: publicTour(tour), contributorId: existing.id, memberId: existing.memberId || null });
      if (body.memberId && tour.contributors.some(item => !item.revokedAt && item.memberId === body.memberId && item.accountUserId !== accountUserId)) {
        return result(409, { error: 'Tour player is already linked to another account' });
      }
    }
    const contributorToken = generateToken();
    const contributor = {
      id: crypto.randomUUID(),
      tokenHash: await hashToken(contributorToken),
      deviceLabel: (body.deviceLabel || '').trim(),
      createdAt: Date.now(),
      revokedAt: null,
      accountUserId: accountUserId || null,
      memberId: body.memberId || null,
    };
    tour.contributors.push(contributor);
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(200, { tour: publicTour(tour), contributorId: contributor.id, contributorToken, memberId: contributor.memberId });
  }

  async access(token, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (actor?.role === 'organizer') return result(200, { role: 'organizer' });
    if (actor) return result(200, {
      role: 'contributor', contributorId: actor.id, ...(actor.memberId ? { memberId: actor.memberId } : {}),
    });
    return result(403, { error: 'Not authorized' });
  }

  async manage(token, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (actor?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    return result(200, {
      tour: publicTour(tour),
      contributors: tour.contributors.map(item => ({
        id: item.id, deviceLabel: item.deviceLabel, createdAt: item.createdAt, revokedAt: item.revokedAt,
        accountLinked: !!item.accountUserId, memberId: item.memberId || null,
      })),
    });
  }

  async rotateInvitation(token, body, accountUserId = null) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    if ((await this.actorForToken(tour, token, accountUserId))?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    const invitationToken = generateToken();
    tour.invitationTokenHash = await hashToken(invitationToken);
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(200, { tour: publicTour(tour), invitationToken });
  }

  async update(token, body, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    if ((await this.actorForToken(tour, token, accountUserId))?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    const invalid = validateTourUpdate(body, tour);
    if (invalid) return result(invalid.startsWith('Unsupported') ? 426 : 400, { error: invalid });
    if (body.expectedRevision !== tour.revision) return result(409, { error: 'Tour changed; refresh and try again' });
    tour.name = body.name.trim();
    tour.startDate = body.startDate;
    tour.endDate = body.endDate;
    tour.bestOfN = body.bestOfN;
    tour.duplicateCourseRule = body.duplicateCourseRule;
    const limits = new Map(body.courseLimits.map(item => [item.courseId, item.maxRounds]));
    tour.courses.forEach(course => { course.maxRounds = limits.get(course.id); });
    tour.retentionUntil = this.completionAt(tour) + RETENTION_MS;
    const today = new Date().toISOString().slice(0, 10);
    if (tour.completedReason === 'expired' || tour.status === 'open') {
      tour.status = tour.endDate < today ? 'completed' : 'open';
      tour.completedReason = tour.status === 'completed' ? 'expired' : null;
    }
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    await this.scheduleLifecycle(tour);
    return result(200, { tour: publicTour(tour) });
  }

  async complete(token, body, accountUserId = null) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    if ((await this.actorForToken(tour, token, accountUserId))?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    if (tour.status !== 'completed') {
      tour.status = 'completed';
      tour.completedReason = 'manual';
      tour.updatedAt = Date.now();
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
    }
    return result(200, { tour: publicTour(tour) });
  }

  async cancel(token, body, accountUserId = null) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    if ((await this.actorForToken(tour, token, accountUserId))?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    if (tour.status === 'open') {
      tour.status = 'cancelled';
      tour.completedReason = 'cancelled';
      tour.updatedAt = Date.now();
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
      await this.scheduleLifecycle(tour);
    }
    return result(200, { tour: publicTour(tour) });
  }

  async delete(token, body, accountUserId = null) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    if ((await this.actorForToken(tour, token, accountUserId))?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    await this.ctx.storage.deleteAll();
    return result(200, { deleted: true });
  }

  async submitRound(body, token, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!actor) return result(403, { error: 'Not authorized' });
    const invalid = validateTourRoundSubmission(body, tour);
    if (invalid) return result(invalid.startsWith('Unsupported') ? 426 : 400, { error: invalid });
    const existing = tour.rounds.find(round => round.clientRoundId === body.clientRoundId);
    if (existing) return result(200, { tour: publicTour(tour), round: existing, duplicate: true });
    const course = tour.courses.find(item => item.id === body.courseId);
    const memberById = new Map(tour.members.map(member => [member.id, member]));
    const submittedAt = Date.now();
    const round = {
      id: crypto.randomUUID(),
      clientRoundId: body.clientRoundId,
      playedDate: body.playedDate,
      courseId: course.id,
      courseName: course.name,
      holes: course.holes,
      gameMode: body.gameMode,
      liveRoomCode: body.liveRoomCode || null,
      submittedAt,
      submittedBy: actor.id,
      subjects: body.subjects.map(subject => ({
        ...subject,
        name: memberById.get(subject.memberId).name,
        rows: subject.rows.map(row => ({ ...row })),
      })),
    };
    tour.rounds.push(round);
    tour.updatedAt = submittedAt;
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(201, { tour: publicTour(tour), round, duplicate: false });
  }

  async revokeContributor(contributorId, token, body, accountUserId = null) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    if ((await this.actorForToken(tour, token, accountUserId))?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    const contributor = tour.contributors.find(item => item.id === contributorId);
    if (!contributor) return result(404, { error: 'Contributor not found' });
    if (!contributor.revokedAt) {
      contributor.revokedAt = Date.now();
      tour.updatedAt = contributor.revokedAt;
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
    }
    return result(200, { tour: publicTour(tour) });
  }

  async alarm() {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return;
    if (Date.now() >= tour.retentionUntil) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ensureLifecycle(tour);
    await this.scheduleLifecycle(tour);
  }
}
