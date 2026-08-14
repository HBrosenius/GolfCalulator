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
    catalogId: 'test-course', catalogVersion: 2, catalogUpdatedAt: 123,
  }]);
});
