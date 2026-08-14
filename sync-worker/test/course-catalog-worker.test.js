import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

const course = {
  id: 'more-gk-18', name: 'Möre GK', region: 'Kalmar län', country: 'SE', holes: 18,
  version: 1, updatedAt: 1786665600000,
  tees: [{ name: 'Gul', slope: 131, cr: 71.4, par: 72, hpar: Array(18).fill(4), si: Array.from({ length: 18 }, (_, index) => index + 1) }],
};

beforeAll(async () => {
  await env.ACCOUNTS_DB.exec(`
    CREATE TABLE IF NOT EXISTS course_catalog (id TEXT PRIMARY KEY,name TEXT NOT NULL,search_name TEXT NOT NULL,region TEXT NOT NULL,country TEXT NOT NULL,holes INTEGER NOT NULL,version INTEGER NOT NULL,updated_at INTEGER NOT NULL,published INTEGER NOT NULL,payload TEXT NOT NULL,source_url TEXT,source_title TEXT,verified_at INTEGER,verification_status TEXT NOT NULL DEFAULT 'legacy');
  `);
  await env.ACCOUNTS_DB.prepare(`
    INSERT OR REPLACE INTO course_catalog (id,name,search_name,region,country,holes,version,updated_at,published,payload)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(course.id, course.name, 'möre gk', course.region, course.country, course.holes, course.version, course.updatedAt, 1, JSON.stringify(course)).run();
});

describe('public course catalogue', () => {
  it('finds published courses with a bounded case-insensitive query', async () => {
    const response = await SELF.fetch('https://worker.test/courses?q=M%C3%96RE');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('public');
    expect(await response.json()).toMatchObject({ count: 1, courses: [{ id: course.id, name: course.name }] });
  });

  it('returns source and verification metadata without embedding it in score data', async () => {
    await env.ACCOUNTS_DB.prepare(`UPDATE course_catalog SET source_url=?,source_title=?,verified_at=?,verification_status=? WHERE id=?`)
      .bind('https://example.se/scorekort', 'Officiellt scorekort', 1786665600000, 'verified', course.id).run();
    const data = await (await SELF.fetch('https://worker.test/courses?q=M%C3%B6re')).json();
    expect(data.courses[0]).toMatchObject({
      source: { url: 'https://example.se/scorekort', title: 'Officiellt scorekort' },
      verifiedAt: 1786665600000,
      verificationStatus: 'verified',
    });
  });

  it('treats wildcard characters literally and rejects oversized searches', async () => {
    expect((await SELF.fetch('https://worker.test/courses?q=%25')).status).toBe(200);
    expect((await (await SELF.fetch('https://worker.test/courses?q=%25')).json()).count).toBe(0);
    expect((await SELF.fetch(`https://worker.test/courses?q=${'a'.repeat(81)}`)).status).toBe(400);
  });
});
