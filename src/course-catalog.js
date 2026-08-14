(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfCourseCatalog = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function validCourse(course) {
    if (!course || typeof course.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(course.id) ||
      typeof course.name !== 'string' || !course.name.trim() || course.name.length > 120 || ![9, 18].includes(course.holes)) return false;
    if (!Array.isArray(course.tees) || course.tees.length === 0 || course.tees.length > 12) return false;
    return course.tees.every(tee => typeof tee.name === 'string' && tee.name.trim() && tee.name.length <= 24 &&
      Number.isFinite(tee.slope) && tee.slope >= 55 && tee.slope <= 155 && Number.isFinite(tee.cr) &&
      tee.cr >= 20 && tee.cr <= 90 && Number.isInteger(tee.par) && tee.par >= 27 && tee.par <= 80 &&
      Array.isArray(tee.hpar) && tee.hpar.length === course.holes && tee.hpar.every(par => Number.isInteger(par) && par >= 3 && par <= 6) &&
      Array.isArray(tee.si) && tee.si.length === course.holes && tee.si.every(si => Number.isInteger(si) && si >= 1 && si <= 18));
  }

  function createClient(baseUrl = 'https://golfcalc-sync.golfcalc-sync.workers.dev', fetchImpl) {
    const fetcher = fetchImpl || fetch;
    return Object.freeze({
      async search(query = '') {
        const url = `${baseUrl.replace(/\/$/, '')}/courses?q=${encodeURIComponent(String(query).trim().slice(0, 80))}`;
        const response = await fetcher(url);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Bankatalogen kunde inte hämtas');
        return (Array.isArray(data.courses) ? data.courses : []).filter(validCourse);
      },
    });
  }

  function localEntries(course) {
    if (!validCourse(course)) return [];
    return course.tees.map(tee => ({
      name: course.name, tee: tee.name, holes: course.holes, slope: tee.slope, cr: tee.cr, par: tee.par,
      hpar: tee.hpar.slice(), si: tee.si.slice(), catalogId: course.id, catalogVersion: course.version || 1,
      catalogUpdatedAt: course.updatedAt || null,
    }));
  }

  return Object.freeze({ createClient, localEntries, validCourse });
}));
