import assert from 'node:assert/strict';

const api = (process.env.SMOKE_API_BASE || 'https://golfcalc-sync.golfcalc-sync.workers.dev').replace(/\/$/, '');
const app = process.env.SMOKE_APP_URL || 'https://hbrosenius.github.io/GolfCalulator/';
const headers = token => ({ 'Content-Type': 'application/json', 'X-Golf-Protocol': '2', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const json = async response => {
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${response.status} ${JSON.stringify(body)}`);
  return body;
};
const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
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
      startDate: iso(-1), endDate: iso(1), bestOfN: 1, duplicateCourseRule: 'best',
      members: [{ name: 'Smoke Player', hi: 10 }, { name: 'Smoke Marker', hi: 20 }],
      courses: [{ name: 'Smoke Course', holes: 9, maxRounds: 1, tees: [{
        name: 'Test', slope: 113, cr: 36, par: 36,
        hpar: [4,4,4,4,4,4,4,4,4], si: [1,3,5,7,9,11,13,15,17],
      }] }],
    }),
  }));

  const socketUrl = `${api.replace(/^http/, 'ws')}/tour/${created.code}/live`;
  const liveUpdate = new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl, ['golf-v2', created.organizerToken]);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Live standings timeout')); }, 10000);
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.tour?.rounds?.length) { clearTimeout(timer); socket.close(); resolve(message); }
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Live WebSocket failed')); };
  });

  const course = created.tour.courses[0];
  const member = created.tour.members[0];
  const rows = course.tees[0].hpar.map((par, index) => ({ h: index + 1, par, si: course.tees[0].si[index], strokes: 1, score: par + 1, netto: par, pts: 2, skipped: false }));
  await json(await fetch(`${api}/tour/${created.code}/rounds`, {
    method: 'POST', headers: headers(created.organizerToken), body: JSON.stringify({
      protocolVersion: 2, schemaVersion: 1, clientRoundId: crypto.randomUUID(), playedDate: iso(0),
      courseId: course.id, gameMode: 'individual',
      subjects: [{ memberId: member.id, teeName: 'Test', totalPoints: 18, totalBrutto: 45, rows, teamId: null }],
    }),
  }));
  const realtime = await liveUpdate;
  assert.equal(realtime.tour.rounds[0].subjects[0].totalPoints, 18);
  console.log(JSON.stringify({ ok: true, service: health.service, tour: created.code, realtime: true }));
} finally {
  if (created) await fetch(`${api}/tour/${created.code}`, { method: 'DELETE', headers: headers(created.organizerToken) }).catch(() => {});
}
