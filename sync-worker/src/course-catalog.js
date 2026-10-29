import '../../src/course-catalog.js';
const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS = 20;

function catalogueJson(data, status = 200, cache = null) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': cache || (status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store') },
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

function fromRow(row,id,version) {
  return {...JSON.parse(row.payload),...(id?{id}:{}),...(version?{version}:{}),source:row.source_url?{url:row.source_url,title:row.source_title||'Källa'}:null,verifiedAt:row.verified_at||null,verificationStatus:row.verification_status||'legacy'};
}
export async function getCourseCatalog(env,id,version=null) {
  const current=await env.ACCOUNTS_DB.prepare('SELECT * FROM course_catalog WHERE id=? AND published=1').bind(id).first();
  if(!current)return catalogueJson({error:'Banan finns inte i den publicerade katalogen'},404);
  if(version!=null){const row=await env.ACCOUNTS_DB.prepare('SELECT * FROM course_catalog_versions WHERE course_id=? AND version=?').bind(id,version).first();if(!row)return catalogueJson({error:'Banversionen finns inte'},404);return catalogueJson({course:fromRow(row,id,version)},200,'public, max-age=31536000, immutable');}
  return catalogueJson({course:fromRow(current,id,current.version)},200,'no-store');
}
const receipt=row=>({id:row.id,courseId:row.course_id,observedVersion:row.observed_version,createdAt:row.created_at,status:row.status,reviewNote:row.review_note||null,reviewedAt:row.reviewed_at||null,appliedVersion:row.applied_version||null});
export async function listCourseReports(env,id,userId) {
  const rows=await env.ACCOUNTS_DB.prepare('SELECT * FROM course_correction_reports WHERE course_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50').bind(id,userId).all();
  return catalogueJson({reports:(rows.results||[]).map(row=>({...receipt(row),request:JSON.parse(row.request_json)}))},200,'no-store');
}
export async function reportCourse(env,id,userId,body) {
  const canonical=value=>JSON.stringify(Object.fromEntries(Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b))));
  if(typeof body?.clientId!=='string'||body.clientId.length>80)return catalogueJson({error:'Ogiltig rapport'},400);
  const previous=await env.ACCOUNTS_DB.prepare('SELECT * FROM course_correction_reports WHERE user_id=? AND client_id=?').bind(userId,body.clientId).first();
  if(previous)return previous.course_id===id&&previous.request_json===canonical(body)?catalogueJson({report:receipt(previous),duplicate:true},200,'no-store'):catalogueJson({error:'Rapportens återförsök ändrades. Öppna en ny rapport.'},409);
  const current=await env.ACCOUNTS_DB.prepare('SELECT version FROM course_catalog WHERE id=? AND published=1').bind(id).first();
  if(!current)return catalogueJson({error:'Banan finns inte i katalogen'},404);
  const observed=await env.ACCOUNTS_DB.prepare('SELECT * FROM course_catalog_versions WHERE course_id=? AND version=?').bind(id,body.observedVersion||0).first();
  if(!observed||!globalThis.GolfCourseCatalog.reportValid(body,fromRow(observed,id,body.observedVersion)))return catalogueJson({error:'Kontrollera rapportens banversion, tee och fält'},400);
  if(!await env.CREATE_LIMITER.getByName(`course-report:${userId}`).check(5))return catalogueJson({error:'För många rapporter. Försök senare.'},429);
  await env.ACCOUNTS_DB.prepare('INSERT INTO course_correction_reports (id,course_id,user_id,client_id,observed_version,request_json,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,client_id) DO NOTHING').bind(crypto.randomUUID(),id,userId,body.clientId,body.observedVersion,canonical(body),Date.now()).run();
  const saved=await env.ACCOUNTS_DB.prepare('SELECT * FROM course_correction_reports WHERE user_id=? AND client_id=?').bind(userId,body.clientId).first();
  if(saved.course_id!==id||saved.request_json!==canonical(body))return catalogueJson({error:'Rapportens återförsök ändrades'},409);
  return catalogueJson({report:receipt(saved)},201,'no-store');
}
