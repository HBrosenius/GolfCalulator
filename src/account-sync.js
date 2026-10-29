(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfAccountSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createClient(baseUrl, fetchImpl) {
    const fetcher = fetchImpl || fetch;
    const call = async (path, options = {}, token) => {
      const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetcher(`${baseUrl}${path}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
      const data = response.status === 204 ? null : await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data?.error || 'Kontotjänsten svarade inte');
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    };
    return Object.freeze({
      requestLink: email => call('/account/login', { method: 'POST', body: { email } }),
      exchange: (token, device = {}) => call('/account/exchange', { method: 'POST', body: { token, ...device } }),
      me: token => call('/account/me', {}, token),
      deleteAccount: token => call('/account/me', { method: 'DELETE' }, token),
      exportAccount: token => call('/account/export', {}, token),
      profile: token => call('/account/profile', {}, token),
      saveProfile: (token, displayName, handicap, playerId) => call('/account/profile', { method: 'PUT', body: { displayName, handicap, playerId } }, token),
      tours: token => call('/account/tours', {}, token),
      sessions: token => call('/account/sessions', {}, token),
      revokeSession: (token, sessionId) => call(`/account/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, token),
      revokeOtherSessions: token => call('/account/sessions', { method: 'DELETE' }, token),
      securityEvents: token => call('/account/security-events', {}, token),
      stats: token => call('/account/stats', {}, token),
      pushKey: () => call('/account/push-key'),
      pushSettings: token => call('/account/push', {}, token),
      savePush: (token, subscription, preferences) => call('/account/push', { method: 'PUT', body: { subscription, preferences } }, token),
      deletePush: token => call('/account/push', { method: 'DELETE' }, token),
      logout: token => call('/account/session', { method: 'DELETE' }, token),
      snapshot: token => call('/account/snapshot', {}, token),
      saveSnapshot: (token, baseVersion, data) => call('/account/snapshot', { method: 'PUT', body: { baseVersion, data } }, token),
    });
  }

  function mergeDeletions(remote, local) {
    const merged = new Map();
    [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]
      .forEach(item => {
        if (!item || item.id == null || !Number.isFinite(item.deletedAt)) return;
        const normalized = { id: String(item.id), deletedAt: item.deletedAt };
        const existing = merged.get(normalized.id);
        if (!existing || existing.deletedAt < normalized.deletedAt) merged.set(normalized.id, normalized);
      });
    return [...merged.values()];
  }

  // Legacy IDs are deterministic so devices migrate the same saved tee once.
  function courseId(course) {
    if (course.id) return String(course.id);
    const key = JSON.stringify([course.name, course.tee, course.holes]);
    let a = 2166136261, b = 5381;
    for (const c of key) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
    return `course-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
  }

  function mergeSnapshots(remote, local, baseline) {
    const output = {};
    const conflicts = [];
    for (const collection of ['courses', 'rounds', 'players', 'tours', 'setups', 'goals']) {
      const keyOf = item => collection === 'courses' ? courseId(item) : String(item.id);
      const deletionKey = `${collection.slice(0, -1)}Deletions`;
      const deletions = mergeDeletions(remote?.[deletionKey], local?.[deletionKey]);
      const deleted = new Set(deletions.map(item => item.id));
      const map = data => new Map((data?.[collection] || []).map(item => [keyOf(item), collection === 'courses' ? { ...item, id: keyOf(item) } : item]));
      // Older clients do not save the goals collection locally. Never interpret that as deletion.
      if (collection === 'goals' && !Array.isArray(local?.goals)) {
        output.goals = (remote?.goals || []).filter(item => !deleted.has(String(item.id)));
        output.goalDeletions = deletions; continue;
      }
      const r = map(remote), l = map(local), base = map(baseline);
      const canonical = value => value && typeof value === 'object'
        ? (Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))) : value;
      const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
      const records = [];
      for (const id of new Set([...r.keys(), ...l.keys(), ...base.keys()])) {
        if (deleted.has(id)) continue;
        const rv = r.get(id), lv = l.get(id), bv = base.get(id);
        let value;
        if (same(rv, lv)) value = rv;
        else if (baseline && same(lv, bv)) value = rv;
        else if (baseline && same(rv, bv)) value = lv;
        else if (!rv) value = lv;
        else if (!lv) value = rv;
        else { conflicts.push({ collection, id }); continue; }
        if (value) records.push(collection === 'courses' ? { ...value, id } : value);
      }
      output[collection] = records;
      output[deletionKey] = deletions;
    }
    if (conflicts.length) {
      const error = new Error('Data ändrades på flera enheter. Välj vilken kopia som ska användas.');
      error.status = 409;
      error.conflicts = conflicts;
      throw error;
    }
    return output;
  }

  return Object.freeze({ createClient, mergeSnapshots, courseId });
}));
