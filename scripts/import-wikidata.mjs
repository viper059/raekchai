// แรกฉาย — ดึงหนังและซีรีส์จาก Wikidata ลงฐานข้อมูล
//
// ใช้:  node scripts/import-wikidata.mjs <mode>
//   seed   ดึงทั้งหมด: หนัง/ซีรีส์ไทย + หนัง/ซีรีส์ที่มีบทความในวิกิพีเดียภาษาไทย
//   daily  เพิ่มเรื่องใหม่ และอัปเดตเรื่องที่ไม่ได้อัปเดตนานที่สุด
//   ids    เฉพาะเรื่อง เช่น IDS="Q20948236,Q106582931"
//
// ตัวแปรแวดล้อม
//   DATABASE_URL   connection string ของ Supabase (Session pooler)
//   REFRESH_LIMIT  จำนวนเรื่องเก่าที่อัปเดตต่อวันในโหมด daily (ค่าเริ่มต้น 1500)
//
// ไม่ยุ่งกับตาราง title_platforms (แอปสตรีม/พากย์ไทย/ซับไทย) ที่แอดมินกรอกเอง

import pg from 'pg';
import { client as wdClient, normalize, refIds, QUERIES } from './wikidata-core.mjs';

const env = process.env;
const REFRESH_LIMIT = +env.REFRESH_LIMIT || 1500;
const BATCH = 50;

const ASIA = new Set('JP KR KP CN HK TW MO IN ID MY SG PH VN KH LA MM BN BD PK LK NP MN BT MV AF IR IQ IL JO LB SA AE QA KW BH OM YE SY TR KZ UZ TM KG TJ'.split(' '));
const EUROPE = new Set('GB IE FR DE IT ES PT NL BE LU CH AT DK SE NO FI IS PL CZ SK HU RO BG GR HR SI RS BA ME MK AL EE LV LT UA BY RU MD MT CY'.split(' '));
const zoneOf = cc => cc === 'TH' ? 'thai' : cc === 'US' ? 'hollywood' : ASIA.has(cc) ? 'asia' : EUROPE.has(cc) ? 'europe' : 'other';
let thNames, enNames;
try { thNames = new Intl.DisplayNames(['th'], { type: 'region' }); enNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}

export const stats = { saved: 0, skipped: 0, failed: 0 };

// ---------- บันทึกลงฐานข้อมูล ----------
async function ensureCountry(c, cc) {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return null;
  await c.query(`insert into countries (code, name_th, name_en, zone) values ($1,$2,$3,$4) on conflict (code) do nothing`,
    [cc, thNames?.of(cc) || cc, enNames?.of(cc) || cc, zoneOf(cc)]);
  return cc;
}

export async function saveTitle(db, t) {
  const c = await db.connect();
  try {
    await c.query('begin');
    // แถวที่กรอกเอง (ยังไม่มีเลข Wikidata) ชื่อและปีตรงกัน: ผูกเข้าด้วยกันแทนสร้างซ้ำ
    await c.query(`update titles set wikidata_id = $1
      where id = (select id from titles where wikidata_id is null and kind = $2
                  and (lower(title_en) = lower($3) or (title_th is not null and title_th = $4))
                  and abs(release_year - $5) <= 1 order by id limit 1)
        and not exists (select 1 from titles where wikidata_id = $1)`,
      [t.qid, t.kind, t.title_en, t.title_th, t.release_year]);

    const { rows: [row] } = await c.query(`
      insert into titles (kind, wikidata_id, title_th, title_en, title_original, release_year, release_month, release_source,
                          runtime_min, series_status, end_year, poster_url)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      on conflict (wikidata_id) do update set
        kind           = excluded.kind,
        title_th       = coalesce(excluded.title_th, titles.title_th),
        title_en       = excluded.title_en,
        title_original = coalesce(excluded.title_original, titles.title_original),
        release_year   = case when titles.release_source = 'manual' then titles.release_year  else excluded.release_year  end,
        release_month  = case when titles.release_source = 'manual' then titles.release_month else excluded.release_month end,
        release_source = case when titles.release_source = 'manual' then 'manual' else excluded.release_source end,
        runtime_min    = coalesce(excluded.runtime_min, titles.runtime_min),
        series_status  = coalesce(excluded.series_status, titles.series_status),
        end_year       = coalesce(excluded.end_year, titles.end_year),
        poster_url     = coalesce(excluded.poster_url, titles.poster_url)
      returning id`,
      [t.kind, t.qid, t.title_th, t.title_en, t.title_original, t.release_year, t.release_month, t.release_source,
       t.runtime_min, t.series_status, t.end_year, t.poster_url]);
    const id = row.id;

    // คนที่อยู่ในเรื่องนี้เดิม (ข้อมูลตั้งต้นที่ยังไม่มีเลข Wikidata) เก็บไว้ผูกชื่อ
    const { rows: oldPeople } = await c.query(`
      select p.id, p.name_en, p.name_th from people p where p.wikidata_id is null and p.id in (
        select person_id from title_cast where title_id = $1 union select person_id from title_creators where title_id = $1)`, [id]);

    // ข้อมูลส่วนที่ Wikidata ไม่มี ไม่ลบทิ้ง: ลบแล้วใส่ใหม่เฉพาะส่วนที่ได้ข้อมูลมา
    const replace = async (tbl, has) => { if (has) await c.query(`delete from ${tbl} where title_id = $1`, [id]); };
    await replace('title_countries', t.countries.length);
    await replace('title_genres', t.genres.length);
    await replace('title_companies', t.companies.length);
    await replace('title_cast', t.cast.length);
    await replace('title_creators', t.creators.length);
    await replace('title_networks', t.networks.length);
    await replace('seasons', t.seasons.length);

    for (const [i, cc] of t.countries.entries())
      if (await ensureCountry(c, cc))
        await c.query(`insert into title_countries values ($1,$2,$3) on conflict do nothing`, [id, cc, i === 0]);

    if (t.genres.length)
      await c.query(`insert into title_genres select $1, id from genres where tmdb_id = any($2::int[]) on conflict do nothing`, [id, t.genres]);

    const org = async (table, o, extra = {}) => {
      await c.query(`update ${table} set wikidata_id = $1 where id = (select id from ${table} where wikidata_id is null and name = $2 limit 1)
                     and not exists (select 1 from ${table} where wikidata_id = $1)`, [o.qid, o.name]);
      let name = o.name;
      if (table === 'networks') {
        const { rows } = await c.query(`select 1 from networks where name = $1 and wikidata_id is distinct from $2`, [name, o.qid]);
        if (rows.length) name = `${name} (${o.qid})`;
      }
      const { rows: [r] } = await c.query(`insert into ${table} (wikidata_id, name) values ($1,$2)
        on conflict (wikidata_id) do update set name = ${table}.name returning id`, [o.qid, name]);
      return r.id;
    };
    for (const [i, co] of t.companies.entries())
      await c.query(`insert into title_companies values ($1,$2,$3) on conflict do nothing`, [id, await org('companies', co), i]);
    for (const n of t.networks)
      await c.query(`insert into title_networks values ($1,$2) on conflict do nothing`, [id, await org('networks', n)]);

    const person = async p => {
      const old = oldPeople.find(o => o.name_en === p.name_en || (p.name_th && (o.name_th === p.name_th || o.name_en === p.name_th)));
      if (old) await c.query(`update people set wikidata_id = $1 where id = $2 and not exists (select 1 from people where wikidata_id = $1)`, [p.qid, old.id]);
      const { rows: [r] } = await c.query(`insert into people (wikidata_id, name_en, name_th) values ($1,$2,$3)
        on conflict (wikidata_id) do update set name_en = excluded.name_en, name_th = coalesce(excluded.name_th, people.name_th) returning id`,
        [p.qid, p.name_en, p.name_th]);
      return r.id;
    };
    for (const [i, p] of t.cast.entries())
      await c.query(`insert into title_cast values ($1,$2,$3,$4) on conflict do nothing`, [id, await person(p), p.character, i]);
    for (const p of t.creators)
      await c.query(`insert into title_creators values ($1,$2,$3) on conflict do nothing`, [id, await person(p), p.role]);

    for (const s of t.seasons)
      await c.query(`insert into seasons (title_id, season_number, name, release_year, release_month, episode_count) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [id, s.n, s.name, s.y, s.m, s.eps && s.eps > 0 && s.eps < 30000 ? s.eps : null]);

    await c.query(`update titles set updated_at = now() where id = $1`, [id]);
    await c.query('commit');
    return id;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

// ---------- ดึงเป็นชุด ----------
export async function importIds(db, wd, qids, log = console.log) {
  const refCache = new Map();   // ประเทศ ประเภท สถานที่ ซ้ำกันบ่อย ไม่ต้องโหลดซ้ำ
  for (let i = 0; i < qids.length; i += BATCH) {
    const chunk = qids.slice(i, i + BATCH);
    try {
      const main = await wd.entities(chunk);
      const need = { labels: new Set(), claims: new Set() };
      for (const e of Object.values(main)) {
        const r = refIds(e);
        r.labels.forEach(x => refCache.has(x) || need.labels.add(x));
        r.claims.forEach(x => refCache.has(x) || need.claims.add(x));
      }
      const got = {
        ...(need.labels.size ? await wd.entities([...need.labels], 'labels') : {}),
        ...(need.claims.size ? await wd.entities([...need.claims], 'labels|claims') : {})
      };
      for (const [k, v] of Object.entries(got)) refCache.set(k, v);
      if (refCache.size > 50000) refCache.clear();
      const refs = new Proxy({}, { get: (_, k) => refCache.get(k) });
      for (const e of Object.values(main)) {
        if (e.missing !== undefined || e.redirects) { stats.skipped++; continue; }
        let t;
        try { t = normalize(e, refs); } catch (err) { stats.failed++; console.error(`แปลง ${e.id} ไม่ได้ — ${err.message}`); continue; }
        if (!t) { stats.skipped++; continue; }
        try { await saveTitle(db, t); stats.saved++; }
        catch (err) { stats.failed++; console.error(`บันทึก ${e.id} ไม่ได้ — ${err.message}`); }
      }
    } catch (err) {
      stats.failed += chunk.length;
      console.error(`ชุด ${i}–${i + chunk.length} ผิดพลาด — ${err.message}`);
    }
    if ((i / BATCH) % 10 === 9) log(`ทำไปแล้ว ${Math.min(i + BATCH, qids.length)}/${qids.length} · บันทึก ${stats.saved} · ข้าม ${stats.skipped} · ผิดพลาด ${stats.failed}`);
  }
}

export async function discoverAll(wd, log = console.log) {
  const all = new Set();
  for (const [name, list] of Object.entries(QUERIES)) {
    let n = 0, partial = 0;
    for (const q of list) {
      const { ids, complete } = await wd.sparqlIds(q);
      ids.forEach(x => all.add(x)); n += ids.length; if (!complete) partial++;
    }
    log(`${name}: ${n} รายการ${partial ? ` (มี ${partial} คำค้นที่ได้ผลไม่ครบ จะเก็บส่วนที่เหลือในรอบถัดไป)` : ''}`);
  }
  return [...all];
}

async function main() {
  const mode = process.argv[2] || 'daily';
  if (!env.DATABASE_URL) throw new Error('ยังไม่ได้ตั้ง DATABASE_URL');
  const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3, ssl: env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
  const wd = wdClient(globalThis.fetch, { delayMs: 200 });
  const t0 = Date.now();
  // เช็กการเชื่อมต่อก่อน ถ้ารหัสผ่านผิดจะหยุดทันที ไม่ต้องเสียเวลาดึงข้อมูลทั้งหมด
  try {
    await db.query('select 1 from titles limit 1');
  } catch (e) {
    await db.end();
    const hint = /password authentication failed/.test(e.message)
      ? 'รหัสผ่านใน DATABASE_URL ไม่ถูกต้อง: ตั้งรหัสผ่านฐานข้อมูลใหม่ใน Supabase แล้วอัปเดต secret DATABASE_URL (อย่าลืมลบ [ ] ออก)'
      : /ENOTFOUND|ENETUNREACH|ECONNREFUSED/.test(e.message)
        ? 'ต่อฐานข้อมูลไม่ได้: ตรวจว่าใช้ลิงก์แบบ Session pooler (มีคำว่า pooler.supabase.com)'
        : 'ต่อฐานข้อมูลไม่ได้';
    throw new Error(`${hint}\nรายละเอียด: ${e.message}`);
  }
  try {
    let qids;
    if (mode === 'ids') {
      qids = (env.IDS || '').split(',').map(s => s.trim()).filter(s => /^Q\d+$/.test(s));
    } else {
      const found = await discoverAll(wd);
      if (mode === 'seed') qids = found;
      else {
        const { rows } = await db.query(`select wikidata_id from titles where wikidata_id is not null`);
        const have = new Set(rows.map(r => r.wikidata_id));
        const fresh = found.filter(q => !have.has(q));
        const { rows: old } = await db.query(`select wikidata_id from titles where wikidata_id is not null order by updated_at asc limit $1`, [REFRESH_LIMIT]);
        qids = [...new Set([...fresh, ...old.map(r => r.wikidata_id)])];
        console.log(`เรื่องใหม่ ${fresh.length} · อัปเดตเรื่องเก่า ${old.length}`);
      }
    }
    console.log(`จะดึง ${qids.length} เรื่อง`);
    await importIds(db, wd, qids);
    // ลบคน/ค่ายจากข้อมูลตั้งต้นที่ไม่มีเรื่องไหนใช้แล้ว
    await db.query(`delete from people p where wikidata_id is null
      and not exists (select 1 from title_cast where person_id = p.id) and not exists (select 1 from title_creators where person_id = p.id)`);
    await db.query(`delete from companies c where wikidata_id is null and not exists (select 1 from title_companies where company_id = c.id)`);
  } finally {
    await db.end();
  }
  console.log(`เสร็จใน ${Math.round((Date.now() - t0) / 1000)} วินาที · บันทึก ${stats.saved} · ข้าม ${stats.skipped} · ผิดพลาด ${stats.failed}`);
  if (stats.failed > 0 && stats.saved === 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
