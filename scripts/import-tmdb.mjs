// แรกฉาย — ดึงหนังและซีรีส์จาก TMDB ลงฐานข้อมูล
//
// ใช้:  node scripts/import-tmdb.mjs <mode>
//   seed   ดึงชุดแรก: หนัง/ซีรีส์ไทยทั้งหมด + เรื่องที่เข้าโรงในไทย + เรื่องที่มีในแอปสตรีมไทย
//   daily  อัปเดตรายวัน: เรื่องใหม่ เรื่องที่ TMDB แก้ไข และรีเฟรชแอปสตรีมของเรื่องเก่า
//   ids    ดึงเฉพาะเรื่อง เช่น IDS="movie:496243,tv:93405"
//
// ตัวแปรแวดล้อม
//   DATABASE_URL   connection string ของ Supabase (Session pooler)
//   TMDB_TOKEN     TMDB API Read Access Token  (หรือ TMDB_API_KEY)
//   SEED_PAGES     จำนวนหน้าต่อชุดค้นหาตอน seed (หน้าละ 20 เรื่อง, ค่าเริ่มต้น 25)
//   REFRESH_LIMIT  จำนวนเรื่องเก่าที่รีเฟรชต่อวัน (ค่าเริ่มต้น 400)
//   MIN_VOTES      คะแนนโหวตขั้นต่ำของเรื่องต่างประเทศ (ค่าเริ่มต้น 5) เรื่องไทยไม่กรอง

import pg from 'pg';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';
const LOGO = 'https://image.tmdb.org/t/p/w92';
const env = process.env;
const SEED_PAGES = +env.SEED_PAGES || 25;
const REFRESH_LIMIT = +env.REFRESH_LIMIT || 400;
const MIN_VOTES = env.MIN_VOTES != null ? +env.MIN_VOTES : 5;
const CONCURRENCY = +env.CONCURRENCY || 6;

const ASIA = new Set('JP KR KP CN HK TW MO IN ID MY SG PH VN KH LA MM BN BD PK LK NP MN BT MV AF IR IQ IL JO LB SA AE QA KW BH OM YE SY TR KZ UZ TM KG TJ'.split(' '));
const EUROPE = new Set('GB IE FR DE IT ES PT NL BE LU CH AT DK SE NO FI IS PL CZ SK HU RO BG GR HR SI RS BA ME MK AL EE LV LT UA BY RU MD MT CY'.split(' '));
const zoneOf = cc => cc === 'TH' ? 'thai' : cc === 'US' ? 'hollywood' : ASIA.has(cc) ? 'asia' : EUROPE.has(cc) ? 'europe' : 'other';
let thNames, enNames;
try { thNames = new Intl.DisplayNames(['th'], { type: 'region' }); enNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}

const OFFER = { flatrate: 'stream', free: 'free', ads: 'free', rent: 'rent', buy: 'buy' };
const TV_STATUS = { 'Returning Series': 'airing', 'In Production': 'airing', 'Planned': 'airing', 'Pilot': 'airing', 'Ended': 'ended', 'Canceled': 'canceled' };

// ---------- TMDB ----------
const stats = { requests: 0, saved: 0, skipped: 0, failed: 0 };
export async function tmdb(path, params = {}, tries = 0) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (env.TMDB_TOKEN) headers.authorization = 'Bearer ' + env.TMDB_TOKEN;
  else url.searchParams.set('api_key', env.TMDB_API_KEY);
  stats.requests++;
  const res = await fetch(url, { headers });
  if (res.status === 429 || res.status >= 500) {
    if (tries >= 5) throw new Error(`TMDB ${res.status} ${path}`);
    await new Promise(r => setTimeout(r, 1000 * 2 ** tries));
    return tmdb(path, params, tries + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function* discover(kind, params, maxPages) {
  for (let page = 1; page <= maxPages; page++) {
    const r = await tmdb(`/discover/${kind}`, { ...params, page });
    if (!r) return;
    for (const x of r.results) yield x.id;
    if (page >= Math.min(r.total_pages, 500)) return;
  }
}

// ---------- แปลงข้อมูล TMDB เป็นแถวของเรา ----------
const ym = d => { const m = /^(\d{4})-(\d{2})/.exec(d || ''); return m ? { y: +m[1], m: +m[2] } : null; };
const tr = (d, lang) => d.translations?.translations?.find(t => t.iso_639_1 === lang)?.data || {};
const clean = s => (s || '').trim() || null;

export function movieRelease(d) {
  const all = (d.release_dates?.results || []).flatMap(c => c.release_dates.map(r => ({ ...r, date: r.release_date.slice(0, 10) })));
  const first = types => all.filter(r => types.includes(r.type)).map(r => r.date).sort()[0];
  const theatrical = first([2, 3]);
  if (theatrical) return { ...ym(theatrical), source: 'theatrical' };
  const festival = first([1]);
  if (festival) return { ...ym(festival), source: 'festival' };
  const other = first([4, 5, 6]) || d.release_date;
  return other ? { ...ym(other), source: 'broadcast' } : null;
}

export function normalize(kind, d) {
  const th = tr(d, 'th'), en = tr(d, 'en');
  const isMovie = kind === 'movie';
  const countries = [...new Set([...(d.origin_country || []), ...(d.production_countries || []).map(c => c.iso_3166_1)])].filter(Boolean);
  const titleEn = clean(isMovie ? en.title : en.name) || clean(isMovie ? d.title : d.name) || clean(isMovie ? d.original_title : d.original_name);
  const titleTh = clean(isMovie ? th.title : th.name);
  const rel = isMovie ? movieRelease(d) : (ym(d.first_air_date) && { ...ym(d.first_air_date), source: 'broadcast' });
  if (!rel || !titleEn) return null;

  let cast, creators;
  if (isMovie) {
    cast = (d.credits?.cast || []).sort((a, b) => a.order - b.order).map(c => ({ id: c.id, name: c.name, profile: c.profile_path, character: clean(c.character) }));
    creators = (d.credits?.crew || []).filter(c => c.job === 'Director').map(c => ({ id: c.id, name: c.name, profile: c.profile_path, role: 'director' }));
  } else {
    cast = (d.aggregate_credits?.cast || []).sort((a, b) => a.order - b.order).map(c => ({ id: c.id, name: c.name, profile: c.profile_path, character: clean(c.roles?.[0]?.character) }));
    creators = (d.created_by || []).map(c => ({ id: c.id, name: c.name, profile: c.profile_path, role: 'creator' }));
  }
  const seen = new Set();
  cast = cast.filter(c => !seen.has(c.id) && seen.add(c.id)).slice(0, 10);
  const seenC = new Set();
  creators = creators.filter(c => !seenC.has(c.id) && seenC.add(c.id));

  const wp = d['watch/providers']?.results?.TH;
  const providers = [];
  if (wp) for (const [k, offer] of Object.entries(OFFER)) for (const p of wp[k] || [])
    if (!providers.some(x => x.id === p.provider_id && x.offer === offer))
      providers.push({ id: p.provider_id, name: p.provider_name, logo: p.logo_path, offer });

  const lastAir = ym(d.last_air_date);
  const status = isMovie ? null : TV_STATUS[d.status] || null;
  return {
    kind: isMovie ? 'movie' : 'series',
    tmdb_id: d.id,
    title_th: titleTh,
    title_en: titleEn,
    title_original: clean(isMovie ? d.original_title : d.original_name),
    release_year: rel.y, release_month: rel.m, release_source: rel.source,
    runtime_min: (isMovie ? d.runtime : d.episode_run_time?.[0]) || null,
    series_status: status,
    end_year: status === 'ended' || status === 'canceled' ? lastAir?.y || null : null,
    synopsis_th: clean(th.overview), synopsis_en: clean(en.overview) || clean(d.overview),
    poster_url: d.poster_path ? IMG + d.poster_path : null,
    countries, genres: (d.genres || []).map(g => ({ id: g.id, name: g.name })),
    companies: (d.production_companies || []).map(c => ({ id: c.id, name: c.name, logo: c.logo_path, country: c.origin_country || null })),
    networks: (d.networks || []).map(n => ({ id: n.id, name: n.name, logo: n.logo_path, country: n.origin_country || null })),
    seasons: (d.seasons || []).filter(s => ym(s.air_date)).map(s => ({ n: s.season_number, name: clean(s.name), ...ym(s.air_date), eps: s.episode_count || null, poster: s.poster_path ? IMG + s.poster_path : null })),
    cast, creators, providers, watchLink: wp?.link || null,
    adult: !!d.adult, votes: d.vote_count || 0
  };
}

export function keep(t) {
  if (!t || t.adult) return false;
  if (t.kind === 'movie' && t.runtime_min && t.runtime_min < 40) return false;   // หนังสั้น
  if (t.countries[0] !== 'TH' && t.votes < MIN_VOTES) return false;
  return true;
}

export async function fetchTitle(kind, id) {
  const d = kind === 'movie'
    ? await tmdb(`/movie/${id}`, { language: 'en-US', append_to_response: 'credits,release_dates,watch/providers,translations' })
    : await tmdb(`/tv/${id}`, { language: 'en-US', append_to_response: 'aggregate_credits,watch/providers,translations' });
  return d ? normalize(kind, d) : null;
}

// ---------- บันทึกลงฐานข้อมูล ----------
async function ensureCountry(c, cc) {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return null;
  await c.query(`insert into countries (code, name_th, name_en, zone) values ($1,$2,$3,$4) on conflict (code) do nothing`,
    [cc, thNames?.of(cc) || cc, enNames?.of(cc) || cc, zoneOf(cc)]);
  return cc;
}
async function uniqueName(c, table, idCol, name, id, cc) {
  // แถวที่กรอกเองชื่อเดียวกันแต่ยังไม่มีเลข TMDB: ผูกเข้าด้วยกัน
  await c.query(`update ${table} set ${idCol} = $2 where name = $1 and ${idCol} is null
                 and not exists (select 1 from ${table} where ${idCol} = $2)`, [name, id]);
  const { rows } = await c.query(`select 1 from ${table} where name = $1 and ${idCol} is distinct from $2`, [name, id]);
  return rows.length ? `${name} (${cc || id})` : name;
}

export async function saveTitle(db, t, runStart) {
  const c = await db.connect();
  try {
    await c.query('begin');
    // เรื่องที่แอดมินเคยกรอกเอง (ยังไม่มี tmdb_id) ให้ผูกกับ TMDB แทนการสร้างซ้ำ
    await c.query(`update titles set tmdb_id = $1
      where id = (select id from titles where tmdb_id is null and kind = $2
                  and (lower(title_en) = lower($3) or (title_th is not null and title_th = $4))
                  and abs(release_year - $5) <= 1 order by id limit 1)
        and not exists (select 1 from titles where kind = $2 and tmdb_id = $1)`,
      [t.tmdb_id, t.kind, t.title_en, t.title_th, t.release_year]);

    const { rows: [row] } = await c.query(`
      insert into titles (kind, tmdb_id, title_th, title_en, title_original, release_year, release_month, release_source,
                          runtime_min, series_status, end_year, synopsis_th, synopsis_en, poster_url)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      on conflict (kind, tmdb_id) do update set
        title_th       = coalesce(excluded.title_th, titles.title_th),
        title_en       = excluded.title_en,
        title_original = excluded.title_original,
        release_year   = case when titles.release_source = 'manual' then titles.release_year  else excluded.release_year  end,
        release_month  = case when titles.release_source = 'manual' then titles.release_month else excluded.release_month end,
        release_source = case when titles.release_source = 'manual' then 'manual' else excluded.release_source end,
        runtime_min    = excluded.runtime_min,
        series_status  = excluded.series_status,
        end_year       = excluded.end_year,
        synopsis_th    = coalesce(excluded.synopsis_th, titles.synopsis_th),
        synopsis_en    = coalesce(excluded.synopsis_en, titles.synopsis_en),
        poster_url     = coalesce(excluded.poster_url, titles.poster_url)
      returning id`,
      [t.kind, t.tmdb_id, t.title_th, t.title_en, t.title_original, t.release_year, t.release_month, t.release_source,
       t.runtime_min, t.series_status, t.end_year, t.synopsis_th, t.synopsis_en, t.poster_url]);
    const id = row.id;

    await c.query(`create temp table if not exists title_cast_old (person_id bigint) on commit drop`);
    await c.query(`insert into title_cast_old select person_id from title_cast where title_id = $1
                   union select person_id from title_creators where title_id = $1`, [id]);
    for (const tbl of ['title_countries', 'title_genres', 'title_companies', 'title_cast', 'title_creators', 'title_networks', 'seasons'])
      await c.query(`delete from ${tbl} where title_id = $1`, [id]);

    for (const [i, cc] of t.countries.entries())
      if (await ensureCountry(c, cc))
        await c.query(`insert into title_countries values ($1,$2,$3) on conflict do nothing`, [id, cc, i === 0]);

    for (const g of t.genres) {
      const { rows: [gr] } = await c.query(`insert into genres (tmdb_id, name_th, name_en) values ($1,$2,$2)
        on conflict (tmdb_id) do update set tmdb_id = excluded.tmdb_id returning id`, [g.id, g.name]);
      await c.query(`insert into title_genres values ($1,$2) on conflict do nothing`, [id, gr.id]);
    }

    for (const [i, co] of t.companies.entries()) {
      const cc = await ensureCountry(c, co.country);
      await c.query(`update companies set tmdb_id = $1 where id = (select id from companies where tmdb_id is null and name = $2 limit 1)
                     and not exists (select 1 from companies where tmdb_id = $1)`, [co.id, co.name]);
      const { rows: [cr] } = await c.query(`insert into companies (tmdb_id, name, country, logo_url) values ($1,$2,$3,$4)
        on conflict (tmdb_id) do update set name = excluded.name, country = excluded.country, logo_url = excluded.logo_url returning id`,
        [co.id, co.name, cc, co.logo ? LOGO + co.logo : null]);
      await c.query(`insert into title_companies values ($1,$2,$3) on conflict do nothing`, [id, cr.id, i]);
    }

    const person = async p => {
      // คนในข้อมูลตั้งต้นของเรื่องนี้ (ยังไม่มีเลข TMDB) ชื่อตรงกัน: ผูกเข้าด้วยกัน
      await c.query(`update people set tmdb_id = $1 where id = (
          select pp.id from people pp join title_cast_old o on o.person_id = pp.id
          where pp.tmdb_id is null and pp.name_en = $2 limit 1)
        and not exists (select 1 from people where tmdb_id = $1)`, [p.id, p.name]);
      const { rows } = await c.query(`insert into people (tmdb_id, name_en, profile_url) values ($1,$2,$3)
        on conflict (tmdb_id) do update set name_en = excluded.name_en, profile_url = coalesce(excluded.profile_url, people.profile_url) returning id`,
        [p.id, p.name, p.profile ? IMG + p.profile : null]);
      return rows[0].id;
    };
    for (const [i, p] of t.cast.entries())
      await c.query(`insert into title_cast values ($1,$2,$3,$4) on conflict do nothing`, [id, await person(p), p.character, i]);
    for (const p of t.creators)
      await c.query(`insert into title_creators values ($1,$2,$3) on conflict do nothing`, [id, await person(p), p.role]);

    for (const n of t.networks) {
      const cc = await ensureCountry(c, n.country);
      const name = await uniqueName(c, 'networks', 'tmdb_id', n.name, n.id, cc);
      const { rows: [nr] } = await c.query(`insert into networks (tmdb_id, name, country, logo_url) values ($1,$2,$3,$4)
        on conflict (tmdb_id) do update set logo_url = excluded.logo_url returning id`, [n.id, name, cc, n.logo ? LOGO + n.logo : null]);
      await c.query(`insert into title_networks values ($1,$2) on conflict do nothing`, [id, nr.id]);
    }

    for (const s of t.seasons)
      await c.query(`insert into seasons values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`, [id, s.n, s.name, s.y, s.m, s.eps, s.poster]);

    // แอปสตรีมในไทย: เก็บค่าเสียงไทย/ซับไทยที่แอดมินกรอกไว้ ลบเฉพาะแอปที่ถอดเรื่องออกแล้ว
    const thai = t.countries[0] === 'TH';
    for (const p of t.providers) {
      const name = await uniqueName(c, 'platforms', 'tmdb_provider_id', p.name, p.id);
      const { rows: [pr] } = await c.query(`insert into platforms (tmdb_provider_id, name, logo_url) values ($1,$2,$3)
        on conflict (tmdb_provider_id) do update set logo_url = excluded.logo_url returning id`, [p.id, name, p.logo ? LOGO + p.logo : null]);
      await c.query(`insert into title_platforms (title_id, platform_id, region, offer, audio_th, link, checked_at)
        values ($1,$2,'TH',$3,$4,$5,now())
        on conflict (title_id, platform_id, region, offer) do update set link = excluded.link, checked_at = now()`,
        [id, pr.id, p.offer, thai ? 'original' : 'none', t.watchLink]);
    }
    await c.query(`delete from title_platforms where title_id = $1 and region = 'TH' and checked_at < $2`, [id, runStart]);

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

// ---------- งานหลัก ----------
async function importAll(db, queue) {
  const runStart = new Date();
  const seen = new Set();
  const jobs = [];
  for await (const [kind, id] of queue) {
    const key = kind + ':' + id;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push([kind, id]);
  }
  console.log(`พบ ${jobs.length} เรื่องที่ต้องดึง`);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [kind, id] = jobs[next++];
      try {
        const t = await fetchTitle(kind, id);
        if (!keep(t)) { stats.skipped++; continue; }
        await saveTitle(db, t, runStart);
        stats.saved++;
        if (stats.saved % 100 === 0) console.log(`บันทึกแล้ว ${stats.saved} เรื่อง`);
      } catch (e) {
        stats.failed++;
        console.error(`ผิดพลาด ${kind}:${id} — ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function* seedQueue() {
  const voteMin = MIN_VOTES > 0 ? MIN_VOTES : undefined;
  const lists = [
    ['movie', { with_origin_country: 'TH', sort_by: 'primary_release_date.desc' }, 500],
    ['tv',    { with_origin_country: 'TH', sort_by: 'first_air_date.desc' }, 500],
    ['movie', { region: 'TH', with_release_type: '2|3', sort_by: 'popularity.desc', 'vote_count.gte': voteMin }, SEED_PAGES],
    ['movie', { watch_region: 'TH', with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', 'vote_count.gte': voteMin }, SEED_PAGES],
    ['tv',    { watch_region: 'TH', with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc', 'vote_count.gte': voteMin }, SEED_PAGES],
  ];
  for (const [kind, params, pages] of lists) {
    console.log(`ค้นหา ${kind} ${JSON.stringify(params)}`);
    for await (const id of discover(kind, params, pages)) yield [kind, id];
  }
}

async function* dailyQueue(db) {
  const day = new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10);
  // เรื่องใหม่ / กำลังฉาย / ใกล้ฉาย
  for (const [kind, path, params] of [
    ['movie', '/movie/now_playing', { region: 'TH' }], ['movie', '/movie/upcoming', { region: 'TH' }],
    ['tv', '/tv/on_the_air', {}], ['tv', '/tv/airing_today', {}]
  ]) for (let page = 1; page <= 5; page++) {
    const r = await tmdb(path, { ...params, page });
    if (!r) break;
    for (const x of r.results) yield [kind, x.id];
    if (page >= r.total_pages) break;
  }
  for (const [kind, params] of [
    ['movie', { with_origin_country: 'TH', 'primary_release_date.gte': day }],
    ['tv', { with_origin_country: 'TH', 'first_air_date.gte': day }],
    ['movie', { watch_region: 'TH', with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc' }],
    ['tv', { watch_region: 'TH', with_watch_monetization_types: 'flatrate|free|ads', sort_by: 'popularity.desc' }],
  ]) for await (const id of discover(kind, params, 5)) yield [kind, id];

  // เรื่องที่มีในฐานข้อมูลแล้วและ TMDB แก้ไขใน 36 ชม.ล่าสุด
  for (const [kind, ours] of [['movie', 'movie'], ['tv', 'series']]) {
    const { rows } = await db.query('select tmdb_id from titles where kind = $1 and tmdb_id is not null', [ours]);
    const have = new Set(rows.map(r => r.tmdb_id));
    for (let page = 1; page <= 100; page++) {
      const r = await tmdb(`/${kind}/changes`, { start_date: day, page });
      if (!r) break;
      for (const x of r.results) if (have.has(x.id)) yield [kind, x.id];
      if (page >= r.total_pages) break;
    }
  }
  // รีเฟรชเรื่องที่อัปเดตนานที่สุด (แอปสตรีมเปลี่ยนบ่อย)
  const { rows } = await db.query(`select kind, tmdb_id from titles where tmdb_id is not null order by updated_at asc limit $1`, [REFRESH_LIMIT]);
  for (const r of rows) yield [r.kind === 'movie' ? 'movie' : 'tv', r.tmdb_id];
}

async function* idsQueue() {
  for (const part of (env.IDS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const [kind, id] = part.split(':');
    if ((kind === 'movie' || kind === 'tv') && +id) yield [kind, +id];
    else console.error(`ข้าม "${part}" (ต้องเป็น movie:123 หรือ tv:456)`);
  }
}

async function main() {
  const mode = process.argv[2] || 'daily';
  if (!env.DATABASE_URL) throw new Error('ยังไม่ได้ตั้ง DATABASE_URL');
  if (!env.TMDB_TOKEN && !env.TMDB_API_KEY) throw new Error('ยังไม่ได้ตั้ง TMDB_TOKEN หรือ TMDB_API_KEY');
  const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: CONCURRENCY + 1, ssl: env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
  const t0 = Date.now();
  try {
    const queue = mode === 'seed' ? seedQueue() : mode === 'ids' ? idsQueue() : dailyQueue(db);
    await importAll(db, queue);
    // ลบข้อมูลตั้งต้นที่ไม่มีเรื่องไหนใช้แล้ว (หลังผูกกับ TMDB)
    await db.query(`delete from people p where tmdb_id is null
      and not exists (select 1 from title_cast where person_id = p.id) and not exists (select 1 from title_creators where person_id = p.id)`);
    await db.query(`delete from companies c where tmdb_id is null and not exists (select 1 from title_companies where company_id = c.id)`);
  } finally {
    await db.end();
  }
  console.log(`เสร็จใน ${Math.round((Date.now() - t0) / 1000)} วินาที · บันทึก ${stats.saved} · ข้าม ${stats.skipped} · ผิดพลาด ${stats.failed} · เรียก TMDB ${stats.requests} ครั้ง`);
  if (stats.failed > 0 && stats.saved === 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
