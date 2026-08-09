import { DurableObject } from 'cloudflare:workers';
import { generateToken, hashToken, tokenMatches } from './auth.js';
import { PROTOCOL_VERSION } from './validation.js';
import { TOUR_SCHEMA_VERSION } from './tour-validation.js';
import { validateTourRoundSubmission, validateTourUpdate } from './tour-validation.js';
import { notifyUsers } from './push.js';

const TOUR_KEY = 'tour';
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const result = (status, data = {}) => ({ status, ...data });
const MEMBERSHIP_ROLES = new Set(['player', 'scorekeeper']);
const MAX_ACTIVITY_EVENTS = 100;
const MAX_ANNOUNCEMENTS = 50;

function normalizeMembership(tour) {
  tour.contributors = (tour.contributors || []).map(item => ({
    role: item.memberId ? 'player' : 'scorekeeper',
    displayName: null,
    leftAt: null,
    removedAt: item.revokedAt || null,
    ...item,
  }));
  tour.organizerAccountUserId ??= null;
  tour.organizerDisplayName ??= null;
  tour.invitationRevision ??= 1;
  tour.invitationRotatedAt ??= null;
  tour.activity ??= [];
  tour.announcements ??= [];
  tour.roundHistory ??= [];
  tour.contributors.forEach(item => { item.isAdmin ??= false; });
  return tour;
}

function actorName(tour, actor) {
  if (actor?.role === 'organizer') return tour.organizerDisplayName || 'Organisatör';
  const contributor = tour.contributors.find(item => item.id === actor?.id);
  const member = contributor?.memberId && tour.members.find(item => item.id === contributor.memberId);
  return contributor?.displayName || member?.name || contributor?.deviceLabel || 'Deltagare';
}

function addActivity(tour, type, actor, details = {}) {
  tour.activity ??= [];
  tour.activity.push({
    id: crypto.randomUUID(), type, at: Date.now(), actorName: actorName(tour, actor),
    actorRole: actor?.role || 'system', details,
  });
  if (tour.activity.length > MAX_ACTIVITY_EVENTS) tour.activity.splice(0, tour.activity.length - MAX_ACTIVITY_EVENTS);
}

function accountUsers(tour, excludeUserId = null) {
  return [...new Set([tour.organizerAccountUserId, ...tour.contributors.filter(item => !item.revokedAt).map(item => item.accountUserId)]
    .filter(userId => userId && userId !== excludeUserId))];
}

function pushPayload(tour, title, body) {
  return { title, body, url: `./index.html#shared_tour=${encodeURIComponent(tour.code || '')}`, tag: `tour-${tour.code || 'shared'}` };
}

function validMembershipRequest(body, extraKeys = []) {
  const allowed = new Set(['protocolVersion', 'schemaVersion', ...extraKeys]);
  return body?.protocolVersion === PROTOCOL_VERSION && body?.schemaVersion === TOUR_SCHEMA_VERSION &&
    Object.keys(body).every(key => allowed.has(key));
}

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
    announcements: (tour.announcements || []).slice().reverse(),
    contributorCount: tour.contributors.filter(item => !item.revokedAt).length,
  };
}

export class Tour extends DurableObject {
  broadcast(tour, event = 'tour_updated') {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const attachment = socket.deserializeAttachment() || {};
        const contributor = tour.contributors.find(item => item.id === attachment.actorId && !item.revokedAt);
        const role = attachment.actorRole === 'organizer' ? 'organizer' : contributor?.isAdmin ? 'administrator' : 'contributor';
        socket.send(JSON.stringify({ type: event, tour: publicTour(tour), online: this.ctx.getWebSockets().length, access: { role } }));
      } catch (_) {}
    }
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(value => value.trim());
    if (protocols[0] !== 'golf-v2' || !/^[A-Za-z0-9_-]{40,64}$/.test(protocols[1] || '')) return new Response('Unauthorized', { status: 401 });
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const actor = stored ? await this.actorForToken(stored, protocols[1], request.headers.get('X-Account-User')) : null;
    if (!stored || !actor) return new Response('Unauthorized', { status: 401 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now(), actorId: actor.id, actorRole: actor.role });
    server.send(JSON.stringify({ type: 'connected', tour: publicTour(stored), online: this.ctx.getWebSockets().length, access: { role: actor.role === 'organizer' ? 'organizer' : actor.isAdmin ? 'administrator' : 'contributor' } }));
    this.broadcast(stored, 'presence');
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'golf-v2' } });
  }

  async webSocketMessage(socket, message) {
    if (message === 'ping') socket.send(JSON.stringify({ type: 'pong', at: Date.now() }));
  }

  async webSocketClose() {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (tour) this.broadcast(tour, 'presence');
  }

  canAdminister(actor) {
    return actor?.role === 'organizer' || !!actor?.isAdmin;
  }
  async detachAccount(accountUserId) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour || !accountUserId) return;
    normalizeMembership(tour);
    let changed = false;
    if (tour.organizerAccountUserId === accountUserId) {
      tour.organizerAccountUserId = null;
      tour.organizerDisplayName = null;
      changed = true;
    }
    for (const contributor of tour.contributors) {
      if (contributor.accountUserId === accountUserId) {
        contributor.accountUserId = null;
        contributor.displayName = null;
        changed = true;
      }
    }
    if (changed) {
      tour.updatedAt = Date.now();
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
    }
  }

  async bindCode(code) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (tour && !tour.code) { tour.code = code; await this.ctx.storage.put(TOUR_KEY, tour); }
  }

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
      addActivity(tour, 'tour_completed_automatically', null);
      tour.updatedAt = Date.now();
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
      await this.scheduleLifecycle(tour);
    }
    return tour;
  }

  async actorForToken(tour, token, accountUserId = null) {
    normalizeMembership(tour);
    if (accountUserId && tour.organizerAccountUserId === accountUserId) return { role: 'organizer', id: 'organizer', accountUserId };
    if (accountUserId) {
      const contributor = tour.contributors.find(item => !item.revokedAt && item.accountUserId === accountUserId);
      if (contributor) return {
        role: 'contributor', id: contributor.id, accountUserId, memberId: contributor.memberId || null,
        membershipRole: contributor.role, isAdmin: !!contributor.isAdmin,
      };
    }
    if (await tokenMatches(token, tour.organizerTokenHash)) return { role: 'organizer', id: 'organizer' };
    for (const contributor of tour.contributors) {
      if (!contributor.revokedAt && await tokenMatches(token, contributor.tokenHash)) {
        return { role: 'contributor', id: contributor.id, isAdmin: !!contributor.isAdmin };
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
      organizerDisplayName: null,
      invitationRevision: 1,
      invitationRotatedAt: null,
      activity: [],
      announcements: [],
      roundHistory: [],
      code: config.code || null,
    };
    addActivity(tour, 'tour_created', { role: 'organizer' });
    await this.ctx.storage.put(TOUR_KEY, tour);
    await this.scheduleLifecycle(tour);
    return result(201, { tour: publicTour(tour) });
  }

  async bindOrganizerAccount(identity) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    const accountUserId = identity?.userId;
    if (!accountUserId) return result(400, { error: 'Invalid account identity' });
    if (!tour.organizerAccountUserId) {
      tour.organizerAccountUserId = accountUserId;
      tour.organizerDisplayName = identity.displayName || null;
      addActivity(tour, 'organizer_account_linked', { role: 'organizer' });
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

  async join(body, identity = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    const accountUserId = identity?.userId || null;
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
      if (existing) return result(200, {
        tour: publicTour(tour), contributorId: existing.id, memberId: existing.memberId || null, membershipRole: existing.role,
      });
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
      role: body.memberId ? 'player' : 'scorekeeper',
      displayName: identity?.displayName || null,
      leftAt: null,
      removedAt: null,
      isAdmin: false,
    };
    tour.contributors.push(contributor);
    addActivity(tour, 'member_joined', { role: 'contributor', id: contributor.id }, {
      membershipRole: contributor.role, memberName: tour.members.find(item => item.id === contributor.memberId)?.name || null,
    });
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    this.broadcast(tour, 'member_joined');
    if (tour.organizerAccountUserId) this.ctx.waitUntil(notifyUsers(this.env, [tour.organizerAccountUserId], 'membership', pushPayload(tour, tour.name, `${actorName(tour, { role: 'contributor', id: contributor.id })} gick med i touren.`)));
    return result(200, {
      tour: publicTour(tour), contributorId: contributor.id, contributorToken,
      memberId: contributor.memberId, membershipRole: contributor.role,
    });
  }

  async access(token, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (actor?.role === 'organizer') return result(200, { role: 'organizer' });
    if (actor) return result(200, {
      role: actor.isAdmin ? 'administrator' : 'contributor', contributorId: actor.id, ...(actor.memberId ? { memberId: actor.memberId } : {}),
      ...(actor.accountUserId ? { membershipRole: actor.membershipRole || 'scorekeeper' } : {}),
    });
    return result(403, { error: 'Not authorized' });
  }

  async manage(token, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!this.canAdminister(actor)) return result(403, { error: 'Not authorized' });
    return result(200, {
      tour: publicTour(tour),
      organizer: {
        displayName: tour.organizerDisplayName || 'Organisatör', accountLinked: !!tour.organizerAccountUserId,
      },
      invitation: { revision: tour.invitationRevision, rotatedAt: tour.invitationRotatedAt, active: true },
      activity: tour.activity.slice().reverse(),
      contributors: tour.contributors.filter(item => !tour.organizerAccountUserId || item.accountUserId !== tour.organizerAccountUserId).map(item => ({
        id: item.id, deviceLabel: item.deviceLabel, createdAt: item.createdAt, revokedAt: item.revokedAt,
        accountLinked: !!item.accountUserId, memberId: item.memberId || null, role: item.role,
        displayName: item.displayName || null, leftAt: item.leftAt || null, removedAt: item.removedAt || null, isAdmin: !!item.isAdmin,
      })),
    });
  }

  async getActivity(token, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    if (!await this.actorForToken(tour, token, accountUserId)) return result(403, { error: 'Not authorized' });
    return result(200, { activity: tour.activity.slice().reverse() });
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
    tour.invitationRevision = (tour.invitationRevision || 1) + 1;
    tour.invitationRotatedAt = Date.now();
    addActivity(tour, 'invitation_rotated', { role: 'organizer' }, { revision: tour.invitationRevision });
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(200, { tour: publicTour(tour), invitationToken });
  }

  async update(token, body, accountUserId = null) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!this.canAdminister(actor)) return result(403, { error: 'Not authorized' });
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
    addActivity(tour, 'conditions_updated', actor);
    tour.retentionUntil = this.completionAt(tour) + RETENTION_MS;
    const today = new Date().toISOString().slice(0, 10);
    if (tour.completedReason === 'expired' || tour.status === 'open') {
      tour.status = tour.endDate < today ? 'completed' : 'open';
      tour.completedReason = tour.status === 'completed' ? 'expired' : null;
    }
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    this.broadcast(tour, 'conditions_updated');
    await this.scheduleLifecycle(tour);
    return result(200, { tour: publicTour(tour) });
  }

  async complete(token, body, accountUserId = null) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (actor?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    if (tour.status !== 'completed') {
      tour.status = 'completed';
      tour.completedReason = 'manual';
      addActivity(tour, 'tour_completed', actor);
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
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (actor?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    if (tour.status === 'open') {
      tour.status = 'cancelled';
      tour.completedReason = 'cancelled';
      addActivity(tour, 'tour_cancelled', actor);
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
    addActivity(tour, 'round_recorded', actor, {
      courseName: course.name, playerNames: round.subjects.map(subject => subject.name), playedDate: round.playedDate,
    });
    tour.updatedAt = submittedAt;
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    this.broadcast(tour, 'round_recorded');
    this.ctx.waitUntil(notifyUsers(this.env, accountUsers(tour, actor.accountUserId), 'rounds', pushPayload(tour, `Ny runda i ${tour.name}`, `${actorName(tour, actor)} registrerade ${course.name}.`)));
    return result(201, { tour: publicTour(tour), round, duplicate: false });
  }

  async setAdministrator(contributorId, token, accountUserId, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (!validMembershipRequest(body, ['isAdmin']) || typeof body.isAdmin !== 'boolean') return result(400, { error: 'Invalid request' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (actor?.role !== 'organizer') return result(403, { error: 'Only the owner can change administrators' });
    const contributor = tour.contributors.find(item => item.id === contributorId && !item.revokedAt && item.accountUserId);
    if (!contributor) return result(400, { error: 'Administrator must have an active account' });
    contributor.isAdmin = body.isAdmin;
    addActivity(tour, 'administrator_updated', actor, { memberName: actorName(tour, { role: 'contributor', id: contributor.id }), isAdmin: body.isAdmin });
    tour.updatedAt = Date.now(); tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    this.broadcast(tour, 'role_updated');
    return result(200, { tour: publicTour(tour) });
  }

  async editRound(roundId, token, accountUserId, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!this.canAdminister(actor)) return result(403, { error: 'Not authorized' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION ||
      body.expectedRevision !== tour.revision || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 200 ||
      typeof body.playedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.playedDate) ||
      body.playedDate < tour.startDate || body.playedDate > tour.endDate ||
      Object.keys(body || {}).some(key => !['protocolVersion', 'schemaVersion', 'expectedRevision', 'playedDate', 'reason'].includes(key))) {
      return result(body?.expectedRevision !== tour.revision ? 409 : 400, { error: body?.expectedRevision !== tour.revision ? 'Tour changed; refresh and try again' : 'Invalid correction' });
    }
    const round = tour.rounds.find(item => item.id === roundId);
    if (!round) return result(404, { error: 'Round not found' });
    const previousDate = round.playedDate;
    round.playedDate = body.playedDate;
    round.correctedAt = Date.now();
    round.correctedBy = actor.id;
    tour.roundHistory.push({ id: crypto.randomUUID(), roundId, at: round.correctedAt, actorName: actorName(tour, actor), reason: body.reason.trim(), before: { playedDate: previousDate }, after: { playedDate: round.playedDate } });
    if (tour.roundHistory.length > 100) tour.roundHistory.splice(0, tour.roundHistory.length - 100);
    addActivity(tour, 'round_corrected', actor, { courseName: round.courseName, reason: body.reason.trim() });
    tour.updatedAt = round.correctedAt; tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    this.broadcast(tour, 'round_corrected');
    return result(200, { tour: publicTour(tour), correction: tour.roundHistory.at(-1) });
  }

  async announce(token, accountUserId, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!this.canAdminister(actor)) return result(403, { error: 'Not authorized' });
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!validMembershipRequest(body, ['message']) || !message || message.length > 500) return result(400, { error: 'Invalid announcement' });
    const announcement = { id: crypto.randomUUID(), message, at: Date.now(), author: actorName(tour, actor) };
    tour.announcements.push(announcement);
    if (tour.announcements.length > MAX_ANNOUNCEMENTS) tour.announcements.shift();
    addActivity(tour, 'announcement_posted', actor);
    tour.updatedAt = announcement.at; tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    this.broadcast(tour, 'announcement');
    this.ctx.waitUntil(notifyUsers(this.env, accountUsers(tour, actor.accountUserId), 'announcements', pushPayload(tour, tour.name, message)));
    return result(201, { tour: publicTour(tour), announcement });
  }

  async revokeContributor(contributorId, token, body, accountUserId = null) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    if (body?.protocolVersion !== PROTOCOL_VERSION || body?.schemaVersion !== TOUR_SCHEMA_VERSION || Object.keys(body).length !== 2) {
      return result(400, { error: 'Invalid request' });
    }
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!this.canAdminister(actor)) return result(403, { error: 'Not authorized' });
    const contributor = tour.contributors.find(item => item.id === contributorId);
    if (!contributor) return result(404, { error: 'Contributor not found' });
    if (!contributor.revokedAt) {
      contributor.revokedAt = Date.now();
      contributor.removedAt = contributor.revokedAt;
      contributor.leftAt = null;
      addActivity(tour, 'member_removed', actor, { memberName: actorName(tour, { role: 'contributor', id: contributor.id }) });
      tour.updatedAt = contributor.revokedAt;
      tour.revision++;
      await this.ctx.storage.put(TOUR_KEY, tour);
    }
    return result(200, {
      tour: publicTour(tour), ...(contributor.accountUserId ? { accountUserId: contributor.accountUserId } : {}),
    });
  }

  async updateMyMembership(body, accountUserId) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    if (!accountUserId || !validMembershipRequest(body, ['memberId'])) return result(400, { error: 'Invalid request' });
    const contributor = tour.contributors.find(item => !item.revokedAt && item.accountUserId === accountUserId);
    if (!contributor) return result(403, { error: 'Not authorized' });
    const memberId = body.memberId === null ? null : body.memberId;
    if (memberId !== null && (typeof memberId !== 'string' || !tour.members.some(member => member.id === memberId))) {
      return result(400, { error: 'Invalid tour player' });
    }
    if (memberId && tour.contributors.some(item => item.id !== contributor.id && !item.revokedAt && item.memberId === memberId)) {
      return result(409, { error: 'Tour player is already linked to another account' });
    }
    contributor.memberId = memberId;
    contributor.role = memberId ? 'player' : 'scorekeeper';
    addActivity(tour, 'membership_updated', { role: 'contributor', id: contributor.id }, {
      membershipRole: contributor.role, memberName: tour.members.find(item => item.id === memberId)?.name || null,
    });
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(200, { tour: publicTour(tour), memberId, membershipRole: contributor.role });
  }

  async updateContributor(contributorId, token, accountUserId, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!this.canAdminister(actor)) return result(403, { error: 'Not authorized' });
    if (!validMembershipRequest(body, ['memberId', 'role']) || !MEMBERSHIP_ROLES.has(body.role)) {
      return result(400, { error: 'Invalid request' });
    }
    const contributor = tour.contributors.find(item => item.id === contributorId);
    if (!contributor) return result(404, { error: 'Contributor not found' });
    const memberId = body.memberId === null ? null : body.memberId;
    if (body.role === 'player' && (typeof memberId !== 'string' || !tour.members.some(member => member.id === memberId))) {
      return result(400, { error: 'Player role requires a tour player' });
    }
    if (body.role === 'scorekeeper' && memberId !== null) return result(400, { error: 'Scorekeeper cannot claim a tour player' });
    if (memberId && tour.contributors.some(item => item.id !== contributor.id && !item.revokedAt && item.memberId === memberId)) {
      return result(409, { error: 'Tour player is already linked to another account' });
    }
    contributor.role = body.role;
    contributor.memberId = memberId;
    addActivity(tour, 'membership_updated', actor, {
      memberName: actorName(tour, { role: 'contributor', id: contributor.id }), membershipRole: contributor.role,
      linkedPlayerName: tour.members.find(item => item.id === memberId)?.name || null,
    });
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(200, {
      tour: publicTour(tour), accountUserId: contributor.accountUserId || null, memberId: contributor.memberId || null,
    });
  }

  async leave(token, accountUserId, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    if (!validMembershipRequest(body)) return result(400, { error: 'Invalid request' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!actor || actor.role === 'organizer') return result(403, { error: 'Organizer cannot leave the tour' });
    const contributor = tour.contributors.find(item => item.id === actor.id);
    contributor.revokedAt = Date.now();
    contributor.leftAt = contributor.revokedAt;
    contributor.removedAt = null;
    addActivity(tour, 'member_left', actor, { memberName: actorName(tour, actor) });
    tour.updatedAt = contributor.revokedAt;
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    if (tour.organizerAccountUserId) this.ctx.waitUntil(notifyUsers(this.env, [tour.organizerAccountUserId], 'membership', pushPayload(tour, tour.name, `${actorName(tour, actor)} lämnade touren.`)));
    return result(200, { left: true });
  }

  async restoreContributor(contributorId, token, accountUserId, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    if (!validMembershipRequest(body)) return result(400, { error: 'Invalid request' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (!this.canAdminister(actor)) return result(403, { error: 'Not authorized' });
    const contributor = tour.contributors.find(item => item.id === contributorId);
    if (!contributor) return result(404, { error: 'Contributor not found' });
    if (contributor.memberId && tour.contributors.some(item => item.id !== contributor.id && !item.revokedAt && item.memberId === contributor.memberId)) {
      contributor.memberId = null;
      contributor.role = 'scorekeeper';
    }
    contributor.revokedAt = null;
    contributor.leftAt = null;
    contributor.removedAt = null;
    addActivity(tour, 'member_restored', actor, { memberName: actorName(tour, { role: 'contributor', id: contributor.id }) });
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return result(200, {
      tour: publicTour(tour), accountUserId: contributor.accountUserId || null, memberId: contributor.memberId || null,
    });
  }

  async transferOwnership(token, accountUserId, body) {
    const tour = await this.ctx.storage.get(TOUR_KEY);
    if (!tour) return result(404, { error: 'Tour not found' });
    normalizeMembership(tour);
    if (!validMembershipRequest(body, ['contributorId'])) return result(400, { error: 'Invalid request' });
    const actor = await this.actorForToken(tour, token, accountUserId);
    if (actor?.role !== 'organizer') return result(403, { error: 'Not authorized' });
    const target = tour.contributors.find(item => item.id === body.contributorId && !item.revokedAt && item.accountUserId);
    if (!target) return result(400, { error: 'New organizer must have an active account' });
    const previousAccountUserId = tour.organizerAccountUserId;
    if (previousAccountUserId && previousAccountUserId !== target.accountUserId) {
      tour.contributors.push({
        id: crypto.randomUUID(), tokenHash: '', deviceLabel: '', createdAt: Date.now(), revokedAt: null,
        accountUserId: previousAccountUserId, memberId: null, role: 'scorekeeper',
        displayName: tour.organizerDisplayName || null, leftAt: null, removedAt: null,
      });
    }
    addActivity(tour, 'ownership_transferred', actor, { newOrganizerName: target.displayName || actorName(tour, { role: 'contributor', id: target.id }) });
    tour.organizerAccountUserId = target.accountUserId;
    tour.organizerDisplayName = target.displayName || null;
    target.revokedAt = Date.now();
    target.removedAt = target.revokedAt;
    tour.organizerTokenHash = await hashToken(generateToken());
    tour.updatedAt = Date.now();
    tour.revision++;
    await this.ctx.storage.put(TOUR_KEY, tour);
    this.ctx.waitUntil(notifyUsers(this.env, accountUsers(tour), 'ownership', pushPayload(tour, tour.name, `${target.displayName || 'En medlem'} är nu ägare.`)));
    return result(200, {
      tour: publicTour(tour), newOrganizerAccountUserId: target.accountUserId, memberId: target.memberId || null,
    });
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

  async endReminderDue(now) {
    const stored = await this.ctx.storage.get(TOUR_KEY);
    const tour = stored ? await this.ensureLifecycle(stored) : null;
    if (!tour || tour.status !== 'open' || tour.endReminderSentAt) return null;
    normalizeMembership(tour);
    const tomorrow = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (tour.endDate !== tomorrow) return null;
    tour.endReminderSentAt = now;
    await this.ctx.storage.put(TOUR_KEY, tour);
    return { userIds: accountUsers(tour), payload: pushPayload(tour, `${tour.name} avslutas i morgon`, 'Registrera eventuella återstående rundor innan touren stängs.') };
  }
}
