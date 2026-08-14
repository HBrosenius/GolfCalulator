#!/usr/bin/env node

const SGF_CLUBS_URL = 'https://golf.se/api/golf/clubs';

function visitAddress(club) {
  return club.Addresses?.find(address => address.Type === 'Besök')
    || club.Addresses?.find(address => address.Country === 'Sverige')
    || null;
}

function isSwedishPlayableClub(club) {
  const address = visitAddress(club);
  return Boolean(address?.Country === 'Sverige' && club.GPSLatitudeClubhouse && club.GPSLongitudeClubhouse &&
    !/payex|gdf|förbundet|tourerna|sm-veckan/i.test(club.Name || ''));
}

function normalizeWebsite(value) {
  const website = String(value || '').trim();
  if (!website) return null;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

export function normalizeClub(club) {
  const address = visitAddress(club);
  return {
    sgfId: club.OrganizationalUnitID,
    name: String(club.Name || '').trim(),
    website: normalizeWebsite(club.Website),
    postalAddress: address?.PostalAddress || null,
    region: address?.Region || null,
    latitude: Number(club.GPSLatitudeClubhouse),
    longitude: Number(club.GPSLongitudeClubhouse),
    inventoryUpdatedAt: club['@metadata']?.updatedAt || null,
    status: 'needs-review',
  };
}

export function buildInventory(clubs) {
  return clubs.filter(isSwedishPlayableClub).map(normalizeClub)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

async function main() {
  const response = await fetch(SGF_CLUBS_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`SGF inventory failed: HTTP ${response.status}`);
  const data = await response.json();
  const clubs = buildInventory(Array.isArray(data.clubs) ? data.clubs : []);
  process.stdout.write(`${JSON.stringify({ source: SGF_CLUBS_URL, retrievedAt: new Date().toISOString(), count: clubs.length, clubs }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
