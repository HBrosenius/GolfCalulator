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
      create: payload => jsonRequest('/tour', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }),
      get: code => jsonRequest(`/tour/${String(code).toUpperCase()}`),
      join: (code, invitationToken, deviceLabel) => jsonRequest(`/tour/${String(code).toUpperCase()}/join`, {
        method: 'POST', headers: headers(), body: JSON.stringify({
          protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION,
          invitationToken, deviceLabel: deviceLabel || '',
        }),
      }),
      access: (code, token) => jsonRequest(`/tour/${String(code).toUpperCase()}/access`, { headers: headers(token) }),
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

    return Object.freeze({ load, upsert, find, remove });
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
    createClient, createStore, invitationFragment, parseInvitationFragment,
  });
}));
