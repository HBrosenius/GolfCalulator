(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfLiveSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_BASE_URL = 'https://golfcalc-sync.golfcalc-sync.workers.dev';
  const PROTOCOL_VERSION = 2;

  function createClient(options) {
    const settings = options || {};
    const baseUrl = (settings.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const fetchImpl = settings.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error('fetch is required');

    function headers(token) {
      const value = {
        'Content-Type': 'application/json',
        'X-Golf-Protocol': String(PROTOCOL_VERSION),
      };
      if (token) value.Authorization = `Bearer ${token}`;
      return value;
    }

    function request(path, options) {
      return fetchImpl(`${baseUrl}${path}`, options);
    }

    function mutation(path, method, body, token) {
      return request(path, {
        method,
        headers: headers(token),
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...body }),
      });
    }

    return Object.freeze({ baseUrl, headers, mutation, request });
  }

  return Object.freeze({ DEFAULT_BASE_URL, PROTOCOL_VERSION, createClient });
}));
