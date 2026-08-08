(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfStorage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isAvailable(storage) {
    if (!storage) return false;
    const key = '__golf_storage_test__';
    try {
      storage.setItem(key, '1');
      const ok = storage.getItem(key) === '1';
      storage.removeItem(key);
      return ok;
    } catch (error) { return false; }
  }

  function createJsonStore(storage) {
    const available = isAvailable(storage);
    return Object.freeze({
      available,
      load(key, fallback) {
        if (!available) return fallback;
        try {
          const raw = storage.getItem(key);
          return raw == null ? fallback : JSON.parse(raw);
        } catch (error) { return fallback; }
      },
      save(key, value, verify) {
        if (!available) return false;
        try {
          const json = JSON.stringify(value);
          storage.setItem(key, json);
          return !verify || storage.getItem(key) === json;
        } catch (error) { return false; }
      },
      remove(key) {
        if (!available) return false;
        try { storage.removeItem(key); return true; }
        catch (error) { return false; }
      },
    });
  }

  function migrateTours(value) {
    if (!Array.isArray(value)) return [];
    return value.map(tour => {
      const sourceCourses = Array.isArray(tour.courses) ? tour.courses : [];
      const courses = sourceCourses.map(course =>
        typeof course === 'string' ? { name: course, maxRounds: 1 } : course);
      return { courses: [], ...tour, courses };
    });
  }

  function createBackupPayload(data, now) {
    return {
      version: 1,
      exportedAt: (now || new Date()).toISOString(),
      courses: Array.isArray(data.courses) ? data.courses : [],
      rounds: Array.isArray(data.rounds) ? data.rounds : [],
      players: Array.isArray(data.players) ? data.players : [],
    };
  }

  function subjectMatchesPlayer(subject, player) {
    if (!subject || !player) return false;
    if (subject.playerId != null) return subject.playerId === player.id;
    return subject.name === (player.nick || player.name) || subject.name === player.name;
  }

  function roundIncludesPlayer(round, player) {
    return !!round && Array.isArray(round.subjects) && round.subjects.some(subject =>
      subjectMatchesPlayer(subject, player) ||
      (Array.isArray(subject.memberIds) && subject.memberIds.includes(player.id)) ||
      (subject.playerId == null && Array.isArray(subject.members) && subject.members.some(name =>
        name === (player.nick || player.name) || name === player.name))
    );
  }

  function uniquePlayerIdForName(name, players) {
    if (typeof name !== 'string' || !Array.isArray(players)) return null;
    const matches = players.filter(player =>
      name === player.name || name === (player.nick || player.name));
    return matches.length === 1 ? matches[0].id : null;
  }

  function migrateRounds(value, players) {
    if (!Array.isArray(value)) return [];
    return value.map(round => {
      const subjects = Array.isArray(round.subjects) ? round.subjects.map(subject => {
        const playerId = subject.playerId ?? uniquePlayerIdForName(subject.name, players);
        const memberIds = Array.isArray(subject.members)
          ? subject.members.map((name, index) => subject.memberIds?.[index] ?? uniquePlayerIdForName(name, players))
          : subject.memberIds;
        return { ...subject, playerId, ...(Array.isArray(subject.members) ? { memberIds } : {}) };
      }) : [];
      return { ...round, schemaVersion: 2, subjects };
    });
  }

  return Object.freeze({
    createBackupPayload, createJsonStore, isAvailable, migrateTours,
    migrateRounds, roundIncludesPlayer, subjectMatchesPlayer, uniquePlayerIdForName,
  });
}));
