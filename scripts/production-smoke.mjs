import assert from 'node:assert/strict';
import { buildSmokeSubmission } from './smoke-round.mjs';

const api = (process.env.SMOKE_API_BASE || 'https://golfcalc-sync.golfcalc-sync.workers.dev').replace(/\/$/, '');
const app = process.env.SMOKE_APP_URL || 'https://hbrosenius.github.io/GolfCalulator/';
const headers = token => ({ 'Content-Type': 'application/json', 'X-Golf-Protocol': '2', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const json = async response => {
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${response.status} ${JSON.stringify(body)}`);
  return body;
};
const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const connectLive = async (url, token, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(url, ['golf-v2', token]);
        const timer = setTimeout(() => { socket.close(); reject(new Error('Live WebSocket connection timeout')); }, 5000);
        socket.onopen = () => { clearTimeout(timer); resolve(socket); };
        socket.onerror = () => { clearTimeout(timer); socket.close(); reject(new Error('Live WebSocket connection failed')); };
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 1000);
    }
  }
  throw new Error(`Live WebSocket failed after ${attempts} attempts: ${lastError?.message || 'unknown error'}`);
};
let created;

try {
  const health = await json(await fetch(`${api}/health`));
  assert.equal(health.ok, true);
  const html = await (await fetch(app)).text();
  assert.match(html, /Poängbogey/);

  // Verify the privacy-preserving login contract without sending an email.
  const login = await fetch(`${api}/account/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invalid' }) });
  assert.equal(login.status, 202);

  created = await json(await fetch(`${api}/tour`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      protocolVersion: 2, schemaVersion: 1, name: `Smoke ${Date.now()}`,
      startDate: iso(-1), endDate: iso(1), bestOfN: 1, duplicateCourseRule: 'best', approvalRequired: true,
      members: [{ name: 'Smoke Player', hi: 10 }, { name: 'Smoke Marker', hi: 20 }],
      courses: [{ name: 'Smoke Course', holes: 9, maxRounds: 1, tees: [{
        name: 'Test', slope: 113, cr: 36, par: 36,
        hpar: [4,4,4,4,4,4,4,4,4], si: [1,3,5,7,9,11,13,15,17],
      }] }],
    }),
  }));

  const socketUrl = `${api.replace(/^http/, 'ws')}/tour/${created.code}/live`;
  const socket = await connectLive(socketUrl, created.organizerToken);
  const liveUpdate = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Live standings update timeout')); }, 10000);
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.tour?.rounds?.length || message.tour?.provisionalRounds?.length) { clearTimeout(timer); socket.close(); resolve(message); }
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Live WebSocket failed after connecting')); };
    socket.onclose = event => {
      if (!event.wasClean) { clearTimeout(timer); reject(new Error(`Live WebSocket closed unexpectedly (${event.code})`)); }
    };
  });

  const submission = buildSmokeSubmission(created.tour, iso(0));
  const recorded = await json(await fetch(`${api}/tour/${created.code}/rounds`, {
    method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify(submission),
  }));
  assert.equal(recorded.round.approvalStatus, 'provisional');
  const realtime = await liveUpdate;
  assert.equal(realtime.tour.rounds.length, 0);
  assert.equal(realtime.tour.provisionalRounds[0].subjects[0].totalPoints, 18);
  const correction = { protocolVersion: 2, schemaVersion: 1, mutationId: crypto.randomUUID(),
    expectedRoundRevision: recorded.round.revision || 1, reason: 'Automated smoke correction',
    changes: [{ memberId: recorded.round.subjects[0].memberId, hole: 1, score: recorded.round.subjects[0].rows[0].score + 1 }] };
  const correctionUrl = `${api}/tour/${created.code}/rounds/${recorded.round.id}`;
  const corrected = await json(await fetch(correctionUrl, {
    method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(correction),
  }));
  assert.equal(corrected.round.subjects[0].totalPoints, 17);
  const retry = await json(await fetch(correctionUrl, {
    method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(correction),
  }));
  assert.equal(retry.duplicate, true);
  const audit = await json(await fetch(`${correctionUrl}/corrections`, { headers: headers(created.organizerToken) }));
  assert.equal(audit.corrections.length, 1);
  assert.equal(audit.corrections[0].before.subjects[0].totalPoints, 18);
  assert.equal(audit.corrections[0].after.subjects[0].totalPoints, 17);
  assert.equal(corrected.round.approvalStatus, 'provisional');
  assert.equal(corrected.tour.rounds.length, 0);
  assert.equal(corrected.tour.provisionalRounds.length, 1);
  const approval = { protocolVersion: 2, schemaVersion: 1, mutationId: crypto.randomUUID(),
    expectedRoundRevision: corrected.round.revision, approvalStatus: 'confirmed', reason: 'Smoke scorecard reviewed' };
  const approved = await json(await fetch(correctionUrl, {
    method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify(approval),
  }));
  assert.equal(approved.tour.rounds[0].approvalStatus, 'confirmed');
  const approvalAudit = await json(await fetch(`${correctionUrl}/corrections`, { headers: headers(created.organizerToken) }));
  assert.equal(approvalAudit.corrections.length, 2);
  assert.equal(approvalAudit.corrections[1].before.approvalStatus, 'provisional');
  assert.equal(approvalAudit.corrections[1].after.approvalStatus, 'confirmed');
  let current = approved.round;
  for (const resultStatus of ['withdrawn', 'disqualified', 'active']) {
    const decision = await json(await fetch(correctionUrl, {
      method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify({ protocolVersion: 2, schemaVersion: 1,
        mutationId: crypto.randomUUID(), expectedRoundRevision: current.revision, resultStatus, reason: `Smoke ${resultStatus}` }),
    }));
    current = decision.round;
    assert.equal(current.resultStatus, resultStatus);
    assert.equal(current.subjects[0].totalPoints, 17);
    assert.equal(decision.tour.rounds.length, 0);
    assert.equal(decision.tour.excludedRounds.length, resultStatus === 'active' ? 0 : 1);
  }
  assert.equal(current.approvalStatus, 'provisional');
  const reconfirmed = await json(await fetch(correctionUrl, {
    method: 'PATCH', headers: headers(created.organizerToken), body: JSON.stringify({ ...approval,
      mutationId: crypto.randomUUID(), expectedRoundRevision: current.revision, reason: 'Smoke fresh approval after reinstatement' }),
  }));
  assert.equal(reconfirmed.tour.rounds.length, 1);
  assert.equal(reconfirmed.tour.rounds[0].subjects[0].totalPoints, 17);
  const finalAudit = await json(await fetch(`${correctionUrl}/corrections`, { headers: headers(created.organizerToken) }));
  assert.equal(finalAudit.corrections.length, 6);
  assert.equal(finalAudit.corrections.filter(entry => entry.type === 'result_status').length, 3);
  console.log(JSON.stringify({ ok: true, service: health.service, tour: created.code, realtime: true, correction: true, audit: true, retry: true, approval: true, resultStatus: true }));
} finally {
  if (created) await fetch(`${api}/tour/${created.code}`, { method: 'DELETE', headers: headers(created.organizerToken) }).catch(() => {});
}
