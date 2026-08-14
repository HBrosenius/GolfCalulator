const test = require('node:test');
const assert = require('node:assert/strict');

test('SGF inventory keeps playable Swedish clubs and normalizes websites', async () => {
  const { buildInventory } = await import('../scripts/swedish-course-inventory.mjs');
  const base = {
    OrganizationalUnitID: 'club-1', Name: 'Test Golfklubb', Website: 'example.se ',
    GPSLatitudeClubhouse: '57.1', GPSLongitudeClubhouse: '16.2',
    Addresses: [{ Type: 'Besök', Country: 'Sverige', PostalAddress: 'TESTORT', Region: 'Småland' }],
    '@metadata': { updatedAt: '2026-08-14T00:00:00Z' },
  };
  const inventory = buildInventory([
    base,
    { ...base, OrganizationalUnitID: 'admin', Name: 'Smålands GDF (Payex)' },
    { ...base, OrganizationalUnitID: 'foreign', Addresses: [{ Type: 'Besök', Country: 'Spanien' }] },
    { ...base, OrganizationalUnitID: 'no-gps', GPSLatitudeClubhouse: '' },
  ]);
  assert.deepEqual(inventory, [{
    sgfId: 'club-1', name: 'Test Golfklubb', website: 'https://example.se', postalAddress: 'TESTORT',
    region: 'Småland', latitude: 57.1, longitude: 16.2,
    inventoryUpdatedAt: '2026-08-14T00:00:00Z', status: 'needs-review',
  }]);
});
