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

  function createScorePushController(options) {
    const settings = options || {};
    if (typeof settings.getRound !== 'function' || typeof settings.send !== 'function') {
      throw new TypeError('getRound and send are required');
    }
    const delay = settings.debounceMs == null ? 600 : settings.debounceMs;
    const schedule = settings.setTimeout || setTimeout;
    const cancel = settings.clearTimeout || clearTimeout;
    const dirty = new Map();
    let timer = null;
    let version = 0;
    let activeRoom = null;

    function syncRoom(code) {
      if (activeRoom === null) activeRoom = code;
      if (code !== activeRoom) {
        dirty.clear();
        activeRoom = code;
      }
    }

    function mark(seat) {
      const round = settings.getRound();
      if (!round || !round.code || round.localSeat == null) return;
      syncRoom(round.code);
      dirty.set(seat == null ? round.localSeat : seat, ++version);
      if (timer !== null) cancel(timer);
      timer = schedule(() => { timer = null; flush(); }, delay);
    }

    async function flush() {
      if (timer !== null) { cancel(timer); timer = null; }
      const round = settings.getRound();
      if (!round || !round.code || round.localSeat == null) return false;
      syncRoom(round.code);
      const roomCode = round.code;
      const work = [...dirty.entries()];
      if (!work.length) return true;
      const results = await Promise.all(work.map(async ([seat, queuedVersion]) => {
        try {
          const response = await settings.send({
            code: roomCode, seat,
            token: seat === round.localSeat ? round.seatToken : round.hostToken,
            scores: Array.isArray(round.scores?.[seat]) ? [...round.scores[seat]] : [],
          });
          const latest = settings.getRound();
          if (response !== false && latest?.code === roomCode && dirty.get(seat) === queuedVersion) dirty.delete(seat);
          return response !== false;
        } catch (_) {
          return false;
        }
      }));
      return results.every(Boolean);
    }

    function stop(options) {
      if (timer !== null) cancel(timer);
      timer = null;
      if (options?.clear) dirty.clear();
    }

    function pendingSeats() {
      return [...dirty.keys()];
    }

    return Object.freeze({ mark, flush, stop, pendingSeats });
  }

  return Object.freeze({ DEFAULT_BASE_URL, PROTOCOL_VERSION, createClient, createScorePushController });
}));
