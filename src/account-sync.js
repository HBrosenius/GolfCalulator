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
      exchange: token => call('/account/exchange', { method: 'POST', body: { token } }),
      me: token => call('/account/me', {}, token),
      profile: token => call('/account/profile', {}, token),
      saveProfile: (token, displayName, handicap) => call('/account/profile', { method: 'PUT', body: { displayName, handicap } }, token),
      tours: token => call('/account/tours', {}, token),
      logout: token => call('/account/session', { method: 'DELETE' }, token),
      snapshot: token => call('/account/snapshot', {}, token),
      saveSnapshot: (token, baseVersion, data) => call('/account/snapshot', { method: 'PUT', body: { baseVersion, data } }, token),
    });
  }

  function mergeCollection(remote, local, keyOf) {
    const merged = new Map();
    (Array.isArray(remote) ? remote : []).forEach((item, index) => merged.set(keyOf(item, index), item));
    (Array.isArray(local) ? local : []).forEach((item, index) => merged.set(keyOf(item, index), item));
    return [...merged.values()];
  }

  function mergeSnapshots(remote, local) {
    return {
      courses: mergeCollection(remote?.courses, local?.courses,
        course => `${course?.name || ''}|${course?.tee || ''}|${course?.holes || ''}`),
      rounds: mergeCollection(remote?.rounds, local?.rounds,
        (round, index) => String(round?.id ?? `${round?.date}|${round?.courseName}|${index}`)),
      players: mergeCollection(remote?.players, local?.players,
        (player, index) => String(player?.id ?? `${player?.name}|${player?.lastName || ''}|${index}`)),
      tours: mergeCollection(remote?.tours, local?.tours,
        (tour, index) => String(tour?.id ?? `${tour?.name}|${tour?.startDate}|${index}`)),
    };
  }

  return Object.freeze({ createClient, mergeSnapshots });
}));
