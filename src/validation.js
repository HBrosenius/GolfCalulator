(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfValidation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isJoinCode(value) {
    return typeof value === 'string' && /^[A-HJ-KM-NP-Z2-9]{4}$/.test(value.toUpperCase());
  }

  function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  function isPhotoDataUrl(value) {
    return typeof value === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  }

  function isBackupPayload(value) {
    return !!value && typeof value === 'object' && value.version === 1 &&
      (Array.isArray(value.courses) || Array.isArray(value.rounds) || Array.isArray(value.players));
  }

  return Object.freeze({ isBackupPayload, isJoinCode, isPhotoDataUrl, isPositiveInteger });
}));
