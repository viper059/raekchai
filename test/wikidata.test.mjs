// ทดสอบการแปลงข้อมูล Wikidata และการบันทึกลงฐานข้อมูล
// ข้อมูลจำลองคัดมาจากรูปแบบจริงของ Wikidata (Train to Busan, Squid Game, หลานม่า) ณ ต.ค. 2026
import assert from 'node:assert/strict';
import pg from 'pg';
import fs from 'node:fs';
import { normalize, refIds, cleanName, genreIdsFromLabel } from '../scripts/wikidata-core.mjs';

const item = id => ({ datavalue: { value: { id } } });
const st = (value, qualifiers, rank = 'normal') => ({ rank, mainsnak: { datavalue: { value } }, ...(qualifiers ? { qualifiers } : {}) });
const q = id => ({ id });
const time = (d, precision = 11) => ({ time: `+${d}T00:00:00Z`, precision });
const lab = (en, th) => ({ ...(en ? { en: { value: en } } : {}), ...(th ? { th: { value: th } } : {}) });

const train = {
  id: 'Q20948236', labels: lab('Train to Busan', 'ด่วนนรก ซอมบี้คลั่ง'), sitelinks: { thwiki: { title: 'ด่วนนรก ซอมบี้คลั่ง' } },
  claims: {
    P31: [st(q('Q11424'))], P495: [st(q('Q884'))], P57: [st(q('Q19947205'))], P272: [st(q('Q131190323'))],
    P161: ['Q623436', 'Q20444998', 'Q486077', 'Q498374', 'Q492701', 'Q483633', 'Q16080358', 'Q16766800', 'Q1', 'Q2', 'Q3', 'Q4'].map(x => st(q(x))),
    P577: [
      st(time('2016-05-13'), { P291: [item('Q39984')] }),     // คานส์ (เมือง ไม่มีรหัสประเทศ)
      st(time('2016-07-20'), { P291: [item('Q884')] }),       // เกาหลีใต้
      st(time('2016-07-22'), { P291: [item('Q30')] }),
      st(time('2017-07-21'))
    ],
    P1476: [st({ text: '부산행', language: 'ko' }, {}, 'preferred')],
    P2047: [st({ amount: '+118', unit: 'http://www.wikidata.org/entity/Q7727' })],
    P136: ['Q3072049', 'Q200092', 'Q188473', 'Q2484376', 'Q47009776'].map(x => st(q(x)))
  }
};
const squid = {
  id: 'Q106582931', labels: lab('Squid Game', 'สควิดเกม เล่นลุ้นตาย'), sitelinks: {},
  claims: {
    P31: [st(q('Q5398426'))], P495: [st(q('Q884'))], P170: [st(q('Q3143548'))], P57: [st(q('Q3143548'))],
    P161: ['Q491318', 'Q18732317', 'Q28699137'].map(x => st(q(x))),
    P580: [st(time('2021-09-17'))], P582: [st(time('2025-06-27'))], P449: [st(q('Q907311'))],
    P527: [['Q108806773', '1'], ['Q112431753', '2'], ['Q128239752', '3']].map(([id, n]) => st(q(id), { P1545: [{ datavalue: { value: n } }] })),
    P136: [st(q('Q67175872')), st(q('Q1366112'))]
  }
};
const grandma = {
  id: 'Q125294821', labels: lab('How to Make Millions Before Grandma Dies', 'หลานม่า'), sitelinks: { thwiki: { title: 'หลานม่า' } },
  claims: {
    P31: [st(q('Q11424'))], P495: [st(q('Q869'))], P57: [st(q('Q129788259'))], P272: [st(q('Q35980843'))],
    P161: ['Q55163532', 'Q105258216', 'Q13022492'].map(x => st(q(x))),
    P577: [st(time('2024-09-13'), { P291: [item('Q16'), item('Q30')] }), st(time('2024-04-04'), { P291: [item('Q869')] })],
    P136: [st(q('Q157443')), st(q('Q130232'))]
  }
};
const iso = code => ({ P297: [st(code)] });
const refs = {
  Q884: { labels: lab('South Korea', 'ประเทศเกาหลีใต้'), claims: iso('KR') }, Q30: { labels: lab('United States'), claims: iso('US') },
  Q869: { labels: lab('Thailand', 'ประเทศไทย'), claims: iso('TH') }, Q16: { labels: lab('Canada'), claims: iso('CA') },
  Q39984: { labels: lab('Cannes', 'กาน'), claims: {} },
  Q19947205: { labels: lab('Yeon Sang-ho') }, Q131190323: { labels: lab('Next Entertainment World') },
  Q623436: { labels: lab('Gong Yoo', 'กง ยู') }, Q20444998: { labels: lab('Kim Su-an') },
  Q486077: { labels: lab('Jung Yu-mi', 'ช็อง ยู-มี (นักแสดงเกิด พ.ศ. 2526)') }, Q498374: { labels: lab('Ma Dong-seok', 'มา ดง-ซ็อก') },
  Q492701: { labels: lab('Choi Woo-shik') }, Q483633: { labels: lab('Sohee') }, Q16080358: { labels: lab('Kim Eui-sung') },
  Q16766800: { labels: lab('Kim Chang-hwan') }, Q1: { labels: lab('A') }, Q2: { labels: lab('B') }, Q3: { labels: lab('C') }, Q4: { labels: lab('D') },
  Q3072049: { labels: lab('zombie film') }, Q200092: { labels: lab('horror film') }, Q188473: { labels: lab('action film') },
  Q2484376: { labels: lab('thriller film') }, Q47009776: { labels: lab('apocalyptic film') },
  Q3143548: { labels: lab('Hwang Dong-hyeok') }, Q491318: { labels: lab('Lee Jung-jae', 'อี ช็อง-แจ') },
  Q18732317: { labels: lab('Park Hae-soo') }, Q28699137: { labels: lab('Jung Ho-yeon') }, Q907311: { labels: lab('Netflix', 'เน็ตฟลิกซ์') },
  Q108806773: { labels: lab('Squid Game, season 1'), claims: { P580: [st(time('2021-09-17'))], P1113: [st({ amount: '+9' })] } },
  Q112431753: { labels: lab('Squid Game, season 2'), claims: { P580: [st(time('2024-12-26'))], P1113: [st({ amount: '+7' })] } },
  Q128239752: { labels: lab('Squid Game, season 3'), claims: { P580: [st(time('2025-06-27'))], P1113: [st({ amount: '+6' })] } },
  Q67175872: { labels: lab('thriller television series') }, Q1366112: { labels: lab('drama television series', 'ละครโทรทัศน์') },
  Q129788259: { labels: lab('Pat Boonnitipat', 'พัฒน์ บุญนิธิพัฒน์') }, Q35980843: { labels: lab('Jorkwang Film', 'จอกว้าง ฟิล์ม') },
  Q55163532: { labels: lab('Putthipong Assarattanakul', 'พุฒิพงศ์ อัสสรัตนกุล') }, Q105258216: { labels: lab('Tontawan Tantivejakul', 'ต้นตะวัน ตันติเวชกุล') },
  Q13022492: { labels: lab('Sanya Kunakorn', 'สัญญา คุณากร') },
  Q157443: { labels: lab('comedy film') }, Q130232: { labels: lab('drama film') }
};

// ---------- แปลงข้อมูล ----------
const t = normalize(train, refs);
assert.equal(t.kind, 'movie');
assert.equal(t.title_th, 'ด่วนนรก ซอมบี้คลั่ง');
assert.deepEqual([t.release_year, t.release_month, t.release_source], [2016, 7, 'theatrical'], 'ข้ามคานส์ ใช้วันเข้าโรงแรกที่ระบุประเทศ');
assert.equal(t.cast.length, 10, 'นักแสดงไม่เกิน 10');
assert.equal(t.cast[0].name_en, 'Gong Yoo');
assert.equal(t.cast[2].name_th, 'ช็อง ยู-มี', 'ตัดวงเล็บท้ายชื่อ');
assert.deepEqual(t.countries, ['KR']);
assert.deepEqual(t.genres.sort((a, b) => a - b), [27, 28, 53]);
assert.equal(t.runtime_min, 118);
assert.equal(t.title_original, '부산행');
assert.deepEqual(t.creators.map(c => c.name_en), ['Yeon Sang-ho']);

const s = normalize(squid, refs);
assert.equal(s.kind, 'series');
assert.deepEqual([s.release_year, s.release_month], [2021, 9]);
assert.equal(s.series_status, 'ended'); assert.equal(s.end_year, 2025);
assert.deepEqual(s.seasons.map(x => [x.n, x.y, x.m, x.eps]), [[1, 2021, 9, 9], [2, 2024, 12, 7], [3, 2025, 6, 6]]);
assert.deepEqual(s.networks.map(n => n.name), ['Netflix'], 'ใช้ชื่อแบรนด์ภาษาอังกฤษ');
assert.deepEqual(s.creators.map(c => c.role), ['creator']);
assert.deepEqual(s.genres.sort((a, b) => a - b), [18, 53]);

const g = normalize(grandma, refs);
assert.deepEqual([g.release_year, g.release_month], [2024, 4], 'ใช้รอบไทย (เม.ย.) ไม่ใช่รอบต่างประเทศ (ก.ย.)');
assert.deepEqual(g.countries, ['TH']);
assert.deepEqual(g.cast.map(c => c.name_th), ['พุฒิพงศ์ อัสสรัตนกุล', 'ต้นตะวัน ตันติเวชกุล', 'สัญญา คุณากร']);
assert.deepEqual(g.genres.sort((a, b) => a - b), [18, 35]);

const r = refIds(train);
assert.ok(r.claims.includes('Q884') && r.claims.includes('Q39984'), 'ประเทศและสถานที่ฉายต้องโหลดข้อมูลข้างใน');
assert.ok(r.labels.includes('Q623436') && !r.labels.includes('Q884'), 'นักแสดงโหลดแค่ชื่อ');
assert.equal(cleanName('ร่างทรง (ภาพยนตร์)'), 'ร่างทรง');
assert.deepEqual(genreIdsFromLabel('romantic comedy film').sort((a, b) => a - b), [35, 10749]);
assert.equal(normalize({ id: 'Q9', labels: lab('Some Band'), claims: { P31: [st(q('Q215380'))] } }, refs), null, 'ไม่ใช่หนัง/ซีรีส์ ข้าม');
assert.equal(normalize({ ...train, claims: { ...train.claims, P577: [] } }, refs), null, 'ไม่มีวันฉาย ข้าม');
console.log('normalize OK');

// ---------- บันทึกลงฐานข้อมูล ----------
if (!process.env.DATABASE_URL) { console.log('ข้ามส่วนฐานข้อมูล (ไม่มี DATABASE_URL)'); process.exit(0); }
const { saveTitle } = await import('../scripts/import-wikidata.mjs');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const one = async (sql, p) => (await db.query(sql, p)).rows;
await db.query(fs.readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
const before = (await one('select count(*)::int n from titles'))[0].n;
// แอดมินกรอกพากย์ไทยไว้ก่อนแล้ว ต้องไม่หาย
await db.query(`insert into platforms (name) values ('Netflix')`);
await db.query(`insert into title_platforms (title_id, platform_id, audio_th, sub_th) select id, (select id from platforms where name='Netflix'), 'dub', true from titles where title_en='Train to Busan'`);

for (const x of [t, s, g]) await saveTitle(db, x);
for (const x of [t, s, g]) await saveTitle(db, x);   // รันซ้ำต้องไม่สร้างซ้ำ
assert.equal((await one('select count(*)::int n from titles'))[0].n, before, 'ผูกกับข้อมูลตั้งต้น ไม่สร้างเรื่องซ้ำ');
const [tr] = await one(`select * from title_timeline join titles using (id) where titles.wikidata_id = 'Q20948236'`);
assert.equal(tr.zone, 'asia'); assert.equal(tr.release_month, 7);
assert.equal((await one(`select count(*)::int n from title_cast where title_id = $1`, [tr.id]))[0].n, 10);
assert.deepEqual((await one(`select audio_th, sub_th from title_platforms where title_id = $1`, [tr.id]))[0], { audio_th: 'dub', sub_th: true }, 'ไม่แตะข้อมูลพากย์ไทย');
const gy = await one(`select wikidata_id from people where name_en = 'Gong Yoo'`);
assert.deepEqual(gy, [{ wikidata_id: 'Q623436' }], 'ผูกนักแสดงตั้งต้น ไม่สร้างซ้ำ');
const [sq] = await one(`select season_count::int, networks from title_timeline where title_en = 'Squid Game'`);
assert.equal(sq.season_count, 3); assert.deepEqual(sq.networks, ['Netflix']);
const [gm] = await one(`select release_month, title_th from titles where wikidata_id = 'Q125294821'`);
assert.deepEqual(gm, { release_month: 4, title_th: 'หลานม่า' });
// เรื่องที่แอดมินตั้งวันฉายเอง ห้ามเปลี่ยน
await db.query(`update titles set release_source='manual', release_year=2015, release_month=1 where wikidata_id='Q20948236'`);
await saveTitle(db, t);
assert.deepEqual((await one(`select release_year, release_month from titles where wikidata_id='Q20948236'`))[0], { release_year: 2015, release_month: 1 });
await db.end();
console.log('db OK · ALL TESTS PASSED');
