const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, localEntries, validCourse } = require('../src/course-catalog.js');

const course = {
  id: 'test-course', name: 'Test GK', region: 'Kalmar län', holes: 9, version: 2, updatedAt: 123,
  tees: [{ name: 'Gul', slope: 113, cr: 36, par: 36, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17] }],
};

test('catalog client encodes searches and rejects malformed server courses', async () => {
  let requestedUrl;
  const client = createClient('https://catalog.test/', async url => {
    requestedUrl = url;
    return Response.json({ courses: [course, { id: 'bad', name: 'Trasig', holes: 18, tees: [] }] });
  });
  const courses = await client.search('Möre & Öland');
  assert.equal(requestedUrl, 'https://catalog.test/courses?q=M%C3%B6re%20%26%20%C3%96land');
  assert.deepEqual(courses, [course]);
});

test('catalog courses become complete offline local tee entries', () => {
  assert.equal(validCourse(course), true);
  assert.deepEqual(localEntries(course), [{
    name: 'Test GK', tee: 'Gul', holes: 9, slope: 113, cr: 36, par: 36,
    hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17],
    ratingCategory: 'all', catalogTee: 'Gul',
    catalogId: 'test-course', catalogVersion: 2, catalogUpdatedAt: 123,
    catalogSource: null, catalogVerifiedAt: null, catalogVerificationStatus: 'legacy',
  }]);
});

test('category-specific ratings become distinct local tee choices', () => {
  const rated = {
    ...course,
    tees: [{
      name: '55', par: 36, hpar: Array(9).fill(4), si: [1,3,5,7,9,11,13,15,17],
      ratings: [
        { category: 'men', label: 'Herrar', slope: 126, cr: 35.2 },
        { category: 'women', label: 'Damer', slope: 135, cr: 37.8 },
      ],
    }],
  };
  assert.equal(validCourse(rated), true);
  assert.deepEqual(localEntries(rated).map(entry => [entry.tee, entry.ratingCategory, entry.slope, entry.cr]), [
    ['55 · Herrar', 'men', 126, 35.2],
    ['55 · Damer', 'women', 135, 37.8],
  ]);
});

test('catalogue accepts safe provenance and preserves it offline', () => {
  const sourced = {
    ...course,
    source: { url: 'https://example.se/scorekort', title: 'Officiellt scorekort' },
    verifiedAt: 1786665600000,
    verificationStatus: 'verified',
  };
  assert.equal(validCourse(sourced), true);
  assert.deepEqual(localEntries(sourced)[0].catalogSource, sourced.source);
  assert.equal(localEntries(sourced)[0].catalogVerifiedAt, sourced.verifiedAt);
  assert.equal(validCourse({ ...sourced, source: { url: 'javascript:alert(1)', title: 'Fel' } }), false);
});
