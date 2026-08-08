import { DurableObject } from 'cloudflare:workers';
import { generateToken, hashToken, tokenMatches } from './auth.js';
import { PROTOCOL_VERSION } from './validation.js';
import { TOUR_SCHEMA_VERSION } from './tour-validation.js';

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
    bestOfN: tour.bestOfN,
    duplicateCourseRule: tour.duplicateCourseRule,
    members: tour.members,
    courses: tour.courses,
    rounds: tour.rounds,
    contributorCount: tour.contributors.filter(item => !item.revokedAt).length,
  };
}

export class Tour extends DurableObject {
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
      bestOfN: config.bestOfN,
      duplicateCourseRule: config.duplicateCourseRule,
      members: config.members.map(member => ({ id: crypto.randomUUID(), name: member.name.trim(), hi: member.hi })),
      courses: config.courses.map(course => ({ id: crypto.randomUUID(), ...course })),
      rounds: [],
      organizerTokenHash,
      invitationTokenHash,
      contributors: [],
    };
    await this.ctx.storage.put(TOUR_KEY, tour);
    await this.ctx.storage.setAlarm(retentionUntil);
    return result(201, { tour: publicTour(tour) });
  }

  async getPublicState() {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    return tour ? result(200, { tour: publicTour(tour) }) : result(404, { error: 'Tour not found' });
  }

  async join(body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION ||
      typeof body.invitationToken !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(body.invitationToken) ||
      (body.deviceLabel !== undefined && (typeof body.deviceLabel !== 'string' || body.deviceLabel.length > 50))) {
      return result(400, { error: 'Invalid request' });
    }
    if (!await tokenMatches(body.invitationToken, tour.invitationTokenHash)) return result(403, { error: 'Invitation rejected' });
    const contributorToken = generateToken();
    const contributor = {
      id: crypto.randomUUID(),
      tokenHash: await hashToken(contributorToken),
      deviceLabel: (body.deviceLabel || '').trim(),
      createdAt: Date.now(),
      revokedAt: null,
    };
    tour.contributors.push(contributor);
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(200, { tour: publicTour(tour), contributorId: contributor.id, contributorToken });
  }

  async access(token) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (await tokenMatches(token, tour.organizerTokenHash)) return result(200, { role: 'organizer' });
    for (const contributor of tour.contributors) {
      if (!contributor.revokedAt && await tokenMatches(token, contributor.tokenHash)) {
        return result(200, { role: 'contributor', contributorId: contributor.id });
      }
    }
    return result(403, { error: 'Not authorized' });
  }

  async revokeContributor(contributorId, token, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    if (!await tokenMatches(token, tour.organizerTokenHash)) return result(403, { error: 'Not authorized' });
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
    await this.ctx.storage.deleteAll();
  }
}
