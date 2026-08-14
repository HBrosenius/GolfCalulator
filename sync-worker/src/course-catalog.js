const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 20;

function catalogueJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store' },
  });
}

function searchPattern(value) {
  return `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

export async function searchCourseCatalog(request, env) {
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length > MAX_QUERY_LENGTH) return catalogueJson({ error: 'Sökningen är för lång' }, 400);
  const normalized = query.toLocaleLowerCase('sv-SE');
  const statement = normalized
    ? env.ACCOUNTS_DB.prepare(`
        SELECT payload, source_url, source_title, verified_at, verification_status FROM course_catalog
        WHERE published = 1 AND search_name LIKE ? ESCAPE '\\'
        ORDER BY name COLLATE NOCASE LIMIT ?
      `).bind(searchPattern(normalized), MAX_RESULTS)
    : env.ACCOUNTS_DB.prepare(`
        SELECT payload, source_url, source_title, verified_at, verification_status FROM course_catalog
        WHERE published = 1 ORDER BY name COLLATE NOCASE LIMIT ?
      `).bind(MAX_RESULTS);
  const rows = await statement.all();
  const courses = (rows.results || []).map(row => ({
    ...JSON.parse(row.payload),
    source: row.source_url ? { url: row.source_url, title: row.source_title || 'Källa' } : null,
    verifiedAt: row.verified_at || null,
    verificationStatus: row.verification_status || 'legacy',
  }));
  return catalogueJson({ courses, query, count: courses.length });
}
