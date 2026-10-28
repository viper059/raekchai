// seed 23 เรื่อง แล้วให้ importer ผูกเรื่อง Train to Busan กับ TMDB โดยไม่สร้างซ้ำ
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query(fs.readFileSync('supabase/seed.sql', 'utf8'));
const n = async q => (await db.query(q)).rows[0];
assert.equal((await n('select count(*)::int c from titles')).c, 23);
assert.equal((await n(`select count(*)::int c from title_timeline where zone is null`)).c, 0, 'ทุกเรื่องมีโซน');
const pm = await n(`select count(*)::int c from title_cast tc join titles t on t.id=tc.title_id where t.title_en='Parasite'`);
assert.equal(pm.c, 6);
const sq = await n(`select season_count::int s from title_timeline where title_en='Squid Game'`);
assert.equal(sq.s, 3);
const before = (await n('select count(*)::int c from people')).c;

const { saveTitle, normalize } = await import('../scripts/import-tmdb.mjs');
const train = JSON.parse(fs.readFileSync('test/train.json', 'utf8'));
await saveTitle(db, normalize('movie', train), new Date());
assert.equal((await n('select count(*)::int c from titles')).c, 23, 'ไม่สร้างเรื่องซ้ำ');
const gy = await n(`select count(*)::int c from people where name_en='Gong Yoo'`);
assert.equal(gy.c, 1, 'ไม่สร้างนักแสดงซ้ำ');
const t = await n(`select tmdb_id, platforms_th from titles join title_timeline using (id) where titles.title_en='Train to Busan'`);
assert.equal(t.tmdb_id, 396535);
console.log('seed + adopt OK · people', before, '→', (await n('select count(*)::int c from people')).c);
await db.end();
