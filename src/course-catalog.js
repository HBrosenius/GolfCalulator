(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfCourseCatalog = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RATING_CATEGORIES = Object.freeze(['all', 'men', 'women']);

  function validRating(rating) {
    return rating && RATING_CATEGORIES.includes(rating.category) &&
      typeof rating.label === 'string' && rating.label.trim() && rating.label.length <= 24 &&
      Number.isFinite(rating.slope) && rating.slope >= 55 && rating.slope <= 155 &&
      Number.isFinite(rating.cr) && rating.cr >= 20 && rating.cr <= 90;
  }

  function validTee(tee, holes) {
    if (!tee || typeof tee.name !== 'string' || !tee.name.trim() || tee.name.length > 24 ||
      !Number.isInteger(tee.par) || tee.par < 27 || tee.par > 80 ||
      !Array.isArray(tee.hpar) || tee.hpar.length !== holes || !tee.hpar.every(par => Number.isInteger(par) && par >= 3 && par <= 6) ||
      !Array.isArray(tee.si) || tee.si.length !== holes || !tee.si.every(si => Number.isInteger(si) && si >= 1 && si <= 18)) return false;
    if (new Set(tee.si).size !== holes || (holes === 9 && new Set(tee.si.map(si => Math.ceil(si / 2))).size !== 9)) return false;
    if (Array.isArray(tee.ratings)) {
      return tee.ratings.length > 0 && tee.ratings.length <= 3 && tee.ratings.every(validRating) &&
        new Set(tee.ratings.map(rating => rating.category)).size === tee.ratings.length && tee.slope == null && tee.cr == null;
    }
    return Number.isFinite(tee.slope) && tee.slope >= 55 && tee.slope <= 155 &&
      Number.isFinite(tee.cr) && tee.cr >= 20 && tee.cr <= 90;
  }

  function validCourse(course) {
    if (!course || typeof course.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(course.id) ||
      typeof course.name !== 'string' || !course.name.trim() || course.name.length > 120 || ![9, 18].includes(course.holes)) return false;
    if (!Array.isArray(course.tees) || course.tees.length === 0 || course.tees.length > 12) return false;
    if (course.source != null && (typeof course.source !== 'object' ||
      typeof course.source.url !== 'string' || !/^https?:\/\//.test(course.source.url) || course.source.url.length > 500 ||
      typeof course.source.title !== 'string' || !course.source.title.trim() || course.source.title.length > 120)) return false;
    if (course.verificationStatus != null && !['verified', 'needs-review', 'legacy'].includes(course.verificationStatus)) return false;
    if (course.verifiedAt != null && (!Number.isInteger(course.verifiedAt) || course.verifiedAt <= 0)) return false;
    if (course.version != null && (!Number.isSafeInteger(course.version) || course.version < 1)) return false;
    if (course.updatedAt != null && (!Number.isSafeInteger(course.updatedAt) || course.updatedAt < 1)) return false;
    return course.tees.every(tee => validTee(tee, course.holes));
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function changes(before, after) {
    const rows = [];
    for (const key of ['name', 'tee', 'holes', 'slope', 'cr', 'par', 'catalogVersion', 'catalogVerificationStatus', 'catalogSource']) {
      if (!same(before[key], after[key])) rows.push({ field: key, before: before[key] ?? null, after: after[key] ?? null });
    }
    for (const key of ['hpar', 'si']) {
      for (let h = 0; h < Math.max(before[key]?.length || 0, after[key]?.length || 0); h++) {
        if (before[key]?.[h] !== after[key]?.[h]) rows.push({ field: `${key}:${h + 1}`, before: before[key]?.[h] ?? null, after: after[key]?.[h] ?? null });
      }
    }
    return rows;
  }

  function candidate(saved, course) {
    return localEntries(course).find(entry => entry.catalogTee === (saved.catalogTee || saved.tee) &&
      entry.ratingCategory === (saved.ratingCategory || 'all')) || null;
  }

  function reportValid(value, course) {
    const keys = ['clientId', 'observedVersion', 'teeName', 'ratingCategory', 'field', 'hole', 'description', 'sourceUrl'];
    if (!validCourse(course) || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return false;
    const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!text(value.clientId, 80) || !/^[A-Za-z0-9_-]+$/.test(value.clientId) || !Number.isSafeInteger(value.observedVersion) || value.observedVersion < 1 ||
      !text(value.teeName, 24) || !RATING_CATEGORIES.includes(value.ratingCategory) || !['rating', 'par', 'si', 'other'].includes(value.field) || !text(value.description, 1000)) return false;
    if (value.hole != null && (!Number.isInteger(value.hole) || value.hole < 1 || value.hole > course.holes)) return false;
    if (value.sourceUrl != null && value.sourceUrl !== '') {
      try {
        if (typeof value.sourceUrl !== 'string' || value.sourceUrl.length > 500 || !['http:', 'https:'].includes(new URL(value.sourceUrl).protocol)) return false;
      } catch (_) { return false; }
    }
    return catalogueOptions(course).some(option => option.teeName === value.teeName && option.category === value.ratingCategory);
  }

  function createClient(baseUrl = 'https://golfcalc-sync.golfcalc-sync.workers.dev', fetchImpl) {
    const fetcher = fetchImpl || fetch;
    return Object.freeze({
      async get(id) {
        const response=await fetcher(`${baseUrl.replace(/\/$/,'')}/courses/${encodeURIComponent(id)}`,{cache:'no-store'});
        const data=await response.json().catch(()=>({}));if(!response.ok||!validCourse(data.course))throw new Error(data.error||'Banan kunde inte hämtas');return data.course;
      },
      async report(id,payload,token) {
        const response=await fetcher(`${baseUrl.replace(/\/$/,'')}/courses/${encodeURIComponent(id)}/reports`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(payload)});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Rapporten kunde inte skickas');return data;
      },
      async reports(id,token) {
        const response=await fetcher(`${baseUrl.replace(/\/$/,'')}/courses/${encodeURIComponent(id)}/reports`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Rapporterna kunde inte hämtas');return data.reports||[];
      },
      async search(query = '') {
        const url = `${baseUrl.replace(/\/$/, '')}/courses?q=${encodeURIComponent(String(query).trim().slice(0, 80))}`;
        const response = await fetcher(url);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Bankatalogen kunde inte hämtas');
        return (Array.isArray(data.courses) ? data.courses : []).filter(validCourse);
      },
    });
  }

  function catalogueOptions(course) {
    if (!validCourse(course)) return [];
    return course.tees.flatMap((tee, teeIndex) => {
      const ratings = Array.isArray(tee.ratings)
        ? tee.ratings
        : [{ category: 'all', label: '', slope: tee.slope, cr: tee.cr }];
      return ratings.map((rating, ratingIndex) => ({
        teeIndex, ratingIndex,
        teeName: tee.name,
        label: rating.label ? `${tee.name} · ${rating.label}` : tee.name,
        category: rating.category,
        slope: rating.slope,
        cr: rating.cr,
      }));
    });
  }

  function localEntries(course) {
    if (!validCourse(course)) return [];
    return catalogueOptions(course).map(option => {
      const tee = course.tees[option.teeIndex];
      return {
        name: course.name, tee: option.label, holes: course.holes, slope: option.slope, cr: option.cr, par: tee.par,
        hpar: tee.hpar.slice(), si: tee.si.slice(), ratingCategory: option.category, catalogTee: option.teeName,
        catalogId: course.id, catalogVersion: course.version || 1,
        catalogUpdatedAt: course.updatedAt || null,
        catalogSource: course.source ? { ...course.source } : null,
        catalogVerifiedAt: course.verifiedAt || null,
        catalogVerificationStatus: course.verificationStatus || 'legacy',
      };
    });
  }

  return Object.freeze({ catalogueOptions, createClient, localEntries, validCourse, changes, candidate, reportValid });
}));
