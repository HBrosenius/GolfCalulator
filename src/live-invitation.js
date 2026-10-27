(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfLiveInvitation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const pattern = /^[A-HJ-KM-NP-Z2-9]{20}$/;
  function parse(value) {
    if (typeof value !== 'string') return null;
    const code = value.trim().toUpperCase();
    if (pattern.test(code)) return code;
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      const params = new URLSearchParams(url.hash.slice(1));
      const invitation = (params.get('live_join') || '').toUpperCase();
      // Accept exactly the invitation fragment, never credentials or another action.
      if ([...params.keys()].length !== 1 || !pattern.test(invitation)) return null;
      return invitation;
    } catch (_) { return null; }
  }
  function link(base, code) {
    if (!pattern.test(code)) throw new Error('Invalid live invitation');
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid app URL');
    url.search = '';
    url.hash = `live_join=${code}`;
    return url.href;
  }
  return Object.freeze({ parse, link });
}));
