// ทดสอบสคริปต์ดึงข้อมูลด้วยข้อมูล TMDB จำลอง กับ Postgres ในเครื่อง
import assert from 'node:assert/strict';
import pg from 'pg';
const { normalize, keep, saveTitle, fetchTitle } = await import('../scripts/import-tmdb.mjs');

const train = {
  id: 396535, title: 'Train to Busan', original_title: '부산행', runtime: 118, adult: false, vote_count: 9000,
  origin_country: ['KR'], production_countries: [{ iso_3166_1: 'KR' }],
  genres: [{ id: 27, name: 'Horror' }, { id: 28, name: 'Action' }],
  production_companies: [{ id: 7036, name: 'Next Entertainment World', origin_country: 'KR', logo_path: '/n.png' }],
  poster_path: '/train.jpg', overview: 'Zombies on a train.',
  credits: { cast: [
      { id: 1, name: 'Gong Yoo', character: 'Seok-woo', order: 0 },
      { id: 2, name: 'Ma Dong-seok', character: 'Sang-hwa', order: 2 },
      { id: 3, name: 'Jung Yu-mi', character: 'Seong-kyeong', order: 1 },
      ...Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, name: 'Extra ' + i, character: 'Passenger', order: 10 + i }))
    ], crew: [{ id: 9, name: 'Yeon Sang-ho', job: 'Director' }, { id: 10, name: 'Someone', job: 'Writer' }] },
  release_dates: { results: [
    { iso_3166_1: 'FR', release_dates: [{ type: 1, release_date: '2016-05-13T00:00:00.000Z' }] },
    { iso_3166_1: 'KR', release_dates: [{ type: 3, release_date: '2016-07-20T00:00:00.000Z' }] },
    { iso_3166_1: 'TH', release_dates: [{ type: 3, release_date: '2016-08-11T00:00:00.000Z' }, { type: 3, release_date: '2023-01-01T00:00:00.000Z' }] } ] },
  'watch/providers': { results: { TH: { link: 'https://www.themoviedb.org/movie/396535/watch?locale=TH',
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/nf.png' }], rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/a.png' }] } } },
  translations: { translations: [{ iso_639_1: 'th', data: { title: 'ด่วนนรกซอมบี้คลั่ง', overview: 'ซอมบี้บนรถไฟ' } }, { iso_639_1: 'en', data: { title: 'Train to Busan', overview: 'Zombies on a train.' } }] }
};
const f4 = {
  id: 129552, name: 'F4 Thailand: Boys Over Flowers', original_name: 'F4 Thailand: หัวใจรักสี่ดวงดาว', adult: false, vote_count: 2,
  origin_country: ['TH'], first_air_date: '2021-12-18', last_air_date: '2022-04-02', status: 'Ended', episode_run_time: [60],
  genres: [{ id: 18, name: 'Drama' }, { id: 10766, name: 'Soap' }], production_companies: [{ id: 50, name: 'GMMTV', origin_country: 'TH' }],
  networks: [{ id: 3000, name: 'GMM25', origin_country: 'TH', logo_path: '/g.png' }],
  created_by: [], seasons: [{ season_number: 0, air_date: null, episode_count: 2 }, { season_number: 1, air_date: '2021-12-18', episode_count: 16, name: 'Season 1' }],
  aggregate_credits: { cast: [{ id: 21, name: 'Tontawan Tantivejakul', order: 0, roles: [{ character: 'Gorya' }] }, { id: 22, name: 'Vachirawit Chivaaree', order: 1, roles: [{ character: 'Thyme' }] }] },
  'watch/providers': { results: { TH: { link: 'x', flatrate: [{ provider_id: 158, provider_name: 'Viu', logo_path: '/v.png' }] } } },
  translations: { translations: [{ iso_639_1: 'th', data: { name: 'F4 Thailand : หัวใจรักสี่ดวงดาว', overview: '' } }] }
};
const short = { ...train, id: 1, runtime: 12 };

// TMDB จำลอง
globalThis.fetch = async url => {
  const u = new URL(url);
  const map = { '/3/movie/396535': train, '/3/tv/129552': f4, '/3/movie/1': short };
  const body = map[u.pathname];
  return { ok: !!body, status: body ? 200 : 404, json: async () => body, text: async () => '' };
};
process.env.TMDB_TOKEN = 'test';

// --- normalize ---
const t = normalize('movie', train);
assert.equal(t.title_th, 'ด่วนนรกซอมบี้คลั่ง');
assert.equal(t.release_year, 2016); assert.equal(t.release_month, 7); assert.equal(t.release_source, 'theatrical', 'ใช้วันเข้าโรงแรก ไม่ใช่คานส์ และไม่ใช่ฉายซ้ำ');
assert.equal(t.cast.length, 10, 'นักแสดงไม่เกิน 10');
assert.deepEqual(t.cast.slice(0, 3).map(c => c.name), ['Gong Yoo', 'Jung Yu-mi', 'Ma Dong-seok'], 'เรียงตามเครดิต');
assert.deepEqual(t.creators.map(c => c.name), ['Yeon Sang-ho']);
assert.equal(t.providers.length, 2);
const s = normalize('tv', f4);
assert.equal(s.kind, 'series'); assert.equal(s.release_year, 2021); assert.equal(s.release_month, 12);
assert.equal(s.series_status, 'ended'); assert.equal(s.end_year, 2022); assert.equal(s.synopsis_th, null);
assert.ok(keep(s), 'ซีรีส์ไทยไม่กรองด้วยยอดโหวต');
assert.ok(!keep(normalize('movie', short)), 'ตัดหนังสั้น');
console.log('normalize OK');

// --- save to DB ---
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await db.query(`insert into titles (kind, title_en, title_th, release_year, release_month, release_source) values ('series','F4 Thailand: Boys Over Flowers','F4 Thailand : หัวใจรักสี่ดวงดาว',2021,12,'manual')`);
const run1 = new Date();
const idA = await saveTitle(db, await fetchTitle('movie', 396535), run1);
const idB = await saveTitle(db, await fetchTitle('tv', 129552), run1);
const one = async (q, p) => (await db.query(q, p)).rows;
assert.equal((await one('select count(*)::int n from titles'))[0].n, 2, 'ผูกแถวที่กรอกเองแทนสร้างซ้ำ');
const [ts] = await one('select * from titles where id=$1', [idB]);
assert.equal(ts.tmdb_id, 129552); assert.equal(ts.release_source, 'manual');
assert.equal((await one('select count(*)::int n from title_cast where title_id=$1', [idA]))[0].n, 10);
const [tl] = await one('select * from title_timeline where id=$1', [idA]);
assert.equal(tl.zone, 'asia'); assert.deepEqual(tl.platforms_th.sort(), ['Apple TV', 'Netflix']);
const [tlB] = await one('select * from title_timeline where id=$1', [idB]);
assert.equal(tlB.zone, 'thai'); assert.equal(Number(tlB.season_count), 1); assert.deepEqual(tlB.platforms_thai_audio, ['Viu'], 'ซีรีส์ไทย = เสียงไทยต้นฉบับ');

// แอดมินกรอกพากย์ไทย แล้ว Apple TV ถอดเรื่องออก: ต้องเก็บค่าพากย์ไว้ และลบ Apple TV
await db.query(`update title_platforms set audio_th='dub', sub_th=true where title_id=$1 and platform_id=(select id from platforms where name='Netflix')`, [idA]);
delete train['watch/providers'].results.TH.rent;
await new Promise(r => setTimeout(r, 20));
await saveTitle(db, await fetchTitle('movie', 396535), new Date());
const plats = await one(`select p.name, tp.audio_th, tp.sub_th from title_platforms tp join platforms p on p.id=tp.platform_id where title_id=$1`, [idA]);
assert.deepEqual(plats, [{ name: 'Netflix', audio_th: 'dub', sub_th: true }]);
assert.equal((await one('select count(*)::int n from titles'))[0].n, 2, 'ดึงซ้ำไม่สร้างแถวใหม่');
// ยอดถูกใจไม่ถูกเขียนทับ
await db.query(`insert into auth.users values ('00000000-0000-0000-0000-000000000009')`);
await db.query(`insert into title_likes (user_id, title_id) values ('00000000-0000-0000-0000-000000000009', $1)`, [idA]);
await saveTitle(db, await fetchTitle('movie', 396535), new Date());
assert.equal((await one('select like_count from titles where id=$1', [idA]))[0].like_count, 1);
const [ct] = await one(`select name_th, zone from countries where code='KR'`);
console.log('db OK · country KR =', ct.name_th, ct.zone);
await db.end();
console.log('ALL TESTS PASSED');
