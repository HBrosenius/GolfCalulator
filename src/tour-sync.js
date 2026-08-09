(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfTourSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE_URL = 'https://golfcalc-sync.golfcalc-sync.workers.dev';
  const PROTOCOL_VERSION = 2;
  const SCHEMA_VERSION = 1;
  const STORE_KEY = 'golf_shared_tours_db';
  const CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{8}$/;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

  function headers(token) {
    const result = { 'Content-Type': 'application/json', 'X-Golf-Protocol': String(PROTOCOL_VERSION) };
    if (token) result.Authorization = `Bearer ${token}`;
    return result;
  }

  function createClient(options) {
    const settings = options || {};
    const baseUrl = (settings.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const fetchImpl = settings.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error('fetch is required');

    async function jsonRequest(path, requestOptions) {
      const response = await fetchImpl(`${baseUrl}${path}`, requestOptions);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body;
    }

    return Object.freeze({
      create: (payload, accountToken) => jsonRequest('/tour', {
        method: 'POST', headers: headers(accountToken), body: JSON.stringify(payload),
      }),
      get: code => jsonRequest(`/tour/${String(code).toUpperCase()}`),
      join: (code, invitationToken, deviceLabel, accountToken, memberId) => jsonRequest(`/tour/${String(code).toUpperCase()}/join`, {
        method: 'POST', headers: headers(accountToken), body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION,
          invitationToken, deviceLabel: deviceLabel || '', ...(memberId ? { memberId } : {}),
        }),
      }),
      access: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/access`, { headers: headers(token) }),
      manage: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/manage`, { headers: headers(token) }),
      activity: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/activity`, { headers: headers(token) }),
      updateConditions: (code, token, payload) => jsonRequest(`/tour/${String(code).toUpperCase()}/conditions`, {
        method: 'PATCH', headers: headers(token), body: JSON.stringify(payload),
      }),
      rotateInvitation: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/rotate-invitation`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }),
      }),
      complete: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/complete`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }),
      }),
      cancel: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/cancel`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }),
      }),
      deleteTour: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}`, {
        method: 'DELETE', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }),
      }),
      revokeContributor: (code, token, contributorId) => jsonRequest(`/tour/${String(code).toUpperCase()}/contributors/${contributorId}/revoke`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }),
      }),
      updateMembership: (code, token, memberId) => jsonRequest(`/tour/${String(code).toUpperCase()}/membership`, {
        method: 'PATCH', headers: headers(token), body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, memberId: memberId || null,
        }),
      }),
      leave: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/leave`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }),
      }),
      updateContributor: (code, token, contributorId, role, memberId) => jsonRequest(`/tour/${String(code).toUpperCase()}/contributors/${contributorId}/membership`, {
        method: 'PATCH', headers: headers(token), body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, role, memberId: memberId || null,
        }),
      }),
      restoreContributor: (code, token, contributorId) => jsonRequest(`/tour/${String(code).toUpperCase()}/contributors/${contributorId}/restore`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }),
      }),
      transferOwnership: (code, token, contributorId) => jsonRequest(`/tour/${String(code).toUpperCase()}/transfer-ownership`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, contributorId,
        }),
      }),
      setAdministrator: (code, token, contributorId, isAdmin) => jsonRequest(`/tour/${String(code).toUpperCase()}/contributors/${contributorId}/administrator`, {
        method: 'PATCH', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, isAdmin }),
      }),
      editRound: (code, token, roundId, expectedRevision, playedDate, reason) => jsonRequest(`/tour/${String(code).toUpperCase()}/rounds/${roundId}`, {
        method: 'PATCH', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, expectedRevision, playedDate, reason }),
      }),
      announce: (code, token, message) => jsonRequest(`/tour/${String(code).toUpperCase()}/announcements`, {
        method: 'POST', headers: headers(token), body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, message }),
      }),
      liveUrl: code => `${baseUrl.replace(/^http/, 'ws')}/tour/${String(code).toUpperCase()}/live`,
      submitRound: (code, token, payload) => jsonRequest(`/tour/${String(code).toUpperCase()}/rounds`, {
        method: 'POST', headers: headers(token), body: JSON.stringify(payload),
      }),
    });
  }

  function createStore(storage) {
    function load() {
      try {
        const parsed = JSON.parse(storage.getItem(STORE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }

    function save(records) {
      try { storage.setItem(STORE_KEY, JSON.stringify(records)); return true; }
      catch (_) { return false; }
    }

    function upsert(record) {
      const records = load();
      const normalized = { ...record, code: String(record.code).toUpperCase(), cachedAt: Date.now() };
      const index = records.findIndex(item => item.code === normalized.code);
      if (index >= 0) records[index] = { ...records[index], ...normalized };
      else records.unshift(normalized);
      return save(records);
    }

    function find(code) {
      return load().find(record => record.code === String(code).toUpperCase()) || null;
    }

    function remove(code) {
      return save(load().filter(record => record.code !== String(code).toUpperCase()));
    }

    function queueSubmission(code, payload) {
      const record = find(code);
      if (!record) return false;
      const pending = Array.isArray(record.pendingSubmissions) ? record.pendingSubmissions.slice() : [];
      const index = pending.findIndex(item => item.payload.clientRoundId === payload.clientRoundId);
      const queued = { payload, attempts: index >= 0 ? pending[index].attempts : 0, lastError: null };
      if (index >= 0) pending[index] = queued;
      else pending.push(queued);
      return upsert({ ...record, pendingSubmissions: pending });
    }

    function updateSubmission(code, clientRoundId, patch) {
      const record = find(code);
      if (!record) return false;
      const pending = (record.pendingSubmissions || []).map(item =>
        item.payload.clientRoundId === clientRoundId ? { ...item, ...patch } : item);
      return upsert({ ...record, pendingSubmissions: pending });
    }

    function completeSubmission(code, clientRoundId, tour) {
      const record = find(code);
      if (!record) return false;
      const pending = (record.pendingSubmissions || []).filter(item => item.payload.clientRoundId !== clientRoundId);
      return upsert({ ...record, tour: tour || record.tour, pendingSubmissions: pending });
    }

    return Object.freeze({ load, upsert, find, remove, queueSubmission, updateSubmission, completeSubmission });
  }

  async function flushPending(store, client, onlyCode) {
    const results = [];
    for (const record of store.load()) {
      if (onlyCode && record.code !== String(onlyCode).toUpperCase()) continue;
      for (const queued of record.pendingSubmissions || []) {
        try {
          const response = await client.submitRound(record.code, record.token, queued.payload);
          store.completeSubmission(record.code, queued.payload.clientRoundId, response.tour);
          results.push({ code: record.code, clientRoundId: queued.payload.clientRoundId, ok: true, response });
        } catch (error) {
          store.updateSubmission(record.code, queued.payload.clientRoundId, {
            attempts: (queued.attempts || 0) + 1,
            lastError: error.message || 'Synchronization failed',
          });
          results.push({ code: record.code, clientRoundId: queued.payload.clientRoundId, ok: false, error });
        }
      }
    }
    return results;
  }

  function invitationFragment(code, invitationToken) {
    const normalizedCode = String(code || '').toUpperCase();
    if (!CODE_PATTERN.test(normalizedCode) || !TOKEN_PATTERN.test(invitationToken || '')) throw new Error('Invalid tour invitation');
    return `#tour=${encodeURIComponent(normalizedCode)}&invite=${encodeURIComponent(invitationToken)}`;
  }

  function parseInvitationFragment(fragment) {
    const source = String(fragment || '');
    if (!source.startsWith('#')) return null;
    const value = source.slice(1);
    const params = new URLSearchParams(value);
    const code = (params.get('tour') || '').toUpperCase();
    const invitationToken = params.get('invite') || '';
    return CODE_PATTERN.test(code) && TOKEN_PATTERN.test(invitationToken) ? { code, invitationToken } : null;
  }

  return Object.freeze({
    DEFAULT_BASE_URL, PROTOCOL_VERSION, SCHEMA_VERSION, STORE_KEY,
    createClient, createStore, flushPending, invitationFragment, parseInvitationFragment,
  });
}));
