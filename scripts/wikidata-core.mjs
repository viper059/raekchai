// แรกฉาย — แปลงข้อมูลจาก Wikidata เป็นแถวของฐานข้อมูล (ไม่มีการต่อฐานข้อมูลในไฟล์นี้)
// ข้อมูล Wikidata เป็น CC0 ใช้ได้ทุกแบบรวมถึงเชิงพาณิชย์

export const UA = 'raekchai/1.0 (https://github.com/viper059/raekchai)';
export const FILM_TYPES = ['Q11424', 'Q24869', 'Q202866', 'Q93204', 'Q506240'];
export const SERIES_TYPES = ['Q5398426', 'Q581714', 'Q1259759', 'Q526877', 'Q63952888', 'Q1366112', 'Q1658957'];
const ANIMATED = new Set(['Q202866', 'Q581714', 'Q63952888']);
const MINUTE = 'http://www.wikidata.org/entity/Q7727';
const HOUR = 'http://www.wikidata.org/entity/Q25235';

// ประเภทหนัง: จับคำในชื่อภาษาอังกฤษของประเภทใน Wikidata → รหัสประเภทของเรา (เลขเดียวกับ TMDB)
const GENRE_WORDS = [
  [/horror|zombie|slasher|ghost/, 27], [/comedy|comedic|satir|parody/, 35], [/drama|melodrama/, 18],
  [/action|martial arts|wuxia|superhero|disaster/, 28], [/thriller|suspense/, 53], [/roman/, 10749],
  [/science fiction|sci-fi|cyberpunk|space opera/, 878], [/fantasy|supernatural/, 14], [/animat|anime/, 16],
  [/adventure/, 12], [/crime|gangster|heist|detective|noir/, 80], [/documentary/, 99], [/\bwar\b/, 10752],
  [/western/, 37], [/music/, 10402], [/mystery/, 9648], [/family|children/, 10751], [/histor|biograph|period/, 36],
  [/soap opera|telenovela|lakorn|thai television soap/, 10766], [/reality/, 10764]
];
export const genreIdsFromLabel = label => GENRE_WORDS.filter(([re]) => re.test((label || '').toLowerCase())).map(([, id]) => id);

// ---------- อ่านค่าใน entity ----------
const best = arr => {
  const live = (arr || []).filter(s => s.rank !== 'deprecated' && s.mainsnak?.datavalue);
  const pref = live.filter(s => s.rank === 'preferred');
  return pref.length ? pref : live;
};
export const claims = (e, p) => best(e?.claims?.[p]);
export const ids = (e, p) => claims(e, p).map(s => s.mainsnak.datavalue.value.id).filter(Boolean);
const qualIds = (s, q) => (s.qualifiers?.[q] || []).map(x => x.datavalue?.value?.id).filter(Boolean);
const qualStr = (s, q) => s.qualifiers?.[q]?.[0]?.datavalue?.value;
const num = s => s ? Number(String(s.mainsnak.datavalue.value.amount).replace('+', '')) : null;
const label = (e, lang) => e?.labels?.[lang]?.value || null;
// ตัดวงเล็บท้ายชื่อ เช่น "ช็อง ยู-มี (นักแสดงเกิด พ.ศ. 2526)" หรือ "ร่างทรง (ภาพยนตร์)"
export const cleanName = s => (s || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim() || null;

export function wdTime(s) {
  const v = s?.mainsnak?.datavalue?.value;
  const m = /^\+?(\d{4})-(\d{2})-(\d{2})/.exec(v?.time || '');
  if (!m) return null;
  const prec = v.precision ?? 11;
  if (prec < 9) return null;                          // ระดับทศวรรษหรือหยาบกว่า ใช้ไม่ได้
  return { y: +m[1], m: prec >= 10 && +m[2] ? +m[2] : null, d: prec >= 11 ? +m[3] : 0, sort: m[1] + m[2] + m[3] };
}

const countryCode = ref => claims(ref, 'P297')[0]?.mainsnak.datavalue.value || null;

// วันฉายครั้งแรก: ใช้วันที่เก่าที่สุดที่ระบุประเทศ (รอบเข้าโรงในประเทศนั้น)
// ถ้าไม่มีเลยค่อยใช้วันที่ไม่ระบุสถานที่ และสุดท้ายวันที่ระบุเมือง/เทศกาล
export function firstRelease(e, refs) {
  const rows = claims(e, 'P577').map(s => {
    const t = wdTime(s);
    if (!t) return null;
    const places = qualIds(s, 'P291');
    const kind = !places.length ? 'none' : places.some(p => countryCode(refs[p])) ? 'country' : 'place';
    return { ...t, kind };
  }).filter(Boolean);
  const pick = k => rows.filter(r => r.kind === k).sort((a, b) => a.sort.localeCompare(b.sort))[0];
  const c = pick('country');
  if (c) return { ...c, source: 'theatrical' };
  const n = pick('none');
  if (n) return { ...n, source: 'theatrical' };
  const p = pick('place');
  if (p) return { ...p, source: 'festival' };
  return null;
}

// ---------- แปลงเป็นแถว ----------
export function kindOf(e) {
  const t = ids(e, 'P31');
  if (t.some(x => SERIES_TYPES.includes(x))) return 'series';
  if (t.some(x => FILM_TYPES.includes(x))) return 'movie';
  return null;
}

export function normalize(e, refs) {
  const kind = kindOf(e);
  if (!kind) return null;
  const R = id => refs[id];
  const thTitle = cleanName(label(e, 'th')) || cleanName(e.sitelinks?.thwiki?.title);
  const original = claims(e, 'P1476')[0]?.mainsnak.datavalue.value.text || null;
  const enTitle = cleanName(label(e, 'en')) || cleanName(original) || thTitle;
  if (!enTitle) return null;

  let rel, seasons = [], status = null, endYear = null;
  if (kind === 'movie') {
    rel = firstRelease(e, refs);
  } else {
    seasons = claims(e, 'P527').map((s, i) => {
      const se = R(s.mainsnak.datavalue.value.id);
      const n = +(qualStr(s, 'P1545') || claims(se, 'P1545')[0]?.mainsnak.datavalue.value || i + 1);
      const t = wdTime(claims(se, 'P580')[0]) || wdTime(claims(se, 'P577')[0]);
      return se && t && Number.isInteger(n) ? { n, y: t.y, m: t.m, eps: num(claims(se, 'P1113')[0]), name: cleanName(label(se, 'th')) } : null;
    }).filter(Boolean).sort((a, b) => a.n - b.n);
    seasons = seasons.filter((s, i) => i === 0 || s.n !== seasons[i - 1].n);
    const start = wdTime(claims(e, 'P580')[0]) || wdTime(claims(e, 'P577').map(s => ({ s, t: wdTime(s) })).filter(x => x.t).sort((a, b) => a.t.sort.localeCompare(b.t.sort))[0]?.s);
    const s1 = seasons.find(s => s.n === 1);
    rel = start ? { ...start, source: 'broadcast' } : s1 ? { y: s1.y, m: s1.m, source: 'broadcast' } : null;
    const end = wdTime(claims(e, 'P582')[0]);
    if (end) { status = 'ended'; endYear = end.y; }
    if (!seasons.length && rel) {
      const nSeasons = num(claims(e, 'P2437')[0]);
      if (!nSeasons || nSeasons === 1) seasons = [{ n: 1, y: rel.y, m: rel.m, eps: num(claims(e, 'P1113')[0]), name: null }];
    }
  }
  if (!rel) return null;

  const person = id => R(id) && { qid: id, name_en: cleanName(label(R(id), 'en')) || cleanName(label(R(id), 'th')), name_th: cleanName(label(R(id), 'th')) };
  const seen = new Set();
  const cast = claims(e, 'P161').map(s => {
    const id = s.mainsnak.datavalue.value.id;
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const p = person(id);
    const role = qualIds(s, 'P453')[0];
    return p?.name_en ? { ...p, character: role ? cleanName(label(R(role), 'th')) || cleanName(label(R(role), 'en')) : null } : null;
  }).filter(Boolean).slice(0, 10);
  const creatorProp = kind === 'series' ? 'P170' : 'P57';
  const creators = [...new Set(ids(e, creatorProp))].map(person).filter(p => p?.name_en)
    .map(p => ({ ...p, role: kind === 'series' ? 'creator' : 'director' }));

  const org = id => R(id) && { qid: id, name: cleanName(label(R(id), 'en')) || cleanName(label(R(id), 'th')) };
  const companies = [...new Set(ids(e, 'P272'))].map(org).filter(x => x?.name);
  const networks = kind === 'series' ? [...new Set(ids(e, 'P449'))].map(org).filter(x => x?.name) : [];
  const countries = [...new Set(ids(e, 'P495').map(id => countryCode(R(id))).filter(Boolean))];

  const genreSet = new Set(ids(e, 'P136').flatMap(id => genreIdsFromLabel(label(R(id), 'en'))));
  if (ids(e, 'P31').some(t => ANIMATED.has(t))) genreSet.add(16);
  if (ids(e, 'P31').includes('Q1658957')) genreSet.add(10766);

  const rt = claims(e, 'P2047')[0]?.mainsnak.datavalue.value;
  const runtime = rt ? Math.round(Number(rt.amount) * (rt.unit === HOUR ? 60 : rt.unit === MINUTE ? 1 : 1)) || null : null;
  const poster = claims(e, 'P3383')[0]?.mainsnak.datavalue.value;

  return {
    qid: e.id, kind,
    title_th: thTitle, title_en: enTitle, title_original: original && original !== enTitle ? original : null,
    release_year: rel.y, release_month: rel.m, release_source: rel.source,
    runtime_min: runtime && runtime > 0 && runtime < 2000 ? runtime : null,
    series_status: kind === 'series' ? status : null, end_year: kind === 'series' ? endYear : null,
    poster_url: poster ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(poster.replace(/ /g, '_')) + '?width=342' : null,
    countries, genres: [...genreSet], companies, networks, cast, creators, seasons
  };
}

// entity อ้างอิงที่ต้องดึงเพิ่ม แยกเป็น 2 กลุ่ม เพื่อไม่ต้องโหลดข้อมูลทั้งก้อนของนักแสดงทุกคน
//   labels: ต้องการแค่ชื่อ (คน ค่าย ช่อง ประเภท ตัวละคร)
//   claims: ต้องการข้อมูลข้างใน (ประเทศ → รหัส ISO, ซีซัน → วันที่/จำนวนตอน, สถานที่ฉาย → เป็นประเทศไหม)
export function refIds(e) {
  const labels = new Set(), withClaims = new Set();
  const add = (set, p) => { for (const s of claims(e, p)) { const id = s.mainsnak.datavalue.value.id; if (id) set.add(id); } };
  ['P161', 'P57', 'P170', 'P272', 'P449', 'P136'].forEach(p => add(labels, p));
  ['P495', 'P527'].forEach(p => add(withClaims, p));
  for (const s of claims(e, 'P161')) qualIds(s, 'P453').forEach(id => labels.add(id));
  for (const s of claims(e, 'P577')) qualIds(s, 'P291').forEach(id => withClaims.add(id));
  withClaims.forEach(id => labels.delete(id));
  return { labels: [...labels], claims: [...withClaims] };
}

// ---------- เรียก Wikidata ----------
export function client(fetchImpl = globalThis.fetch, { delayMs = 0 } = {}) {
  let last = 0;
  async function get(url, tries = 0) {
    const wait = last + delayMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      if (tries >= 5) throw new Error(`Wikidata ${res.status}`);
      const ra = +res.headers?.get?.('retry-after') || 2 ** tries * 2;
      await new Promise(r => setTimeout(r, ra * 1000));
      return get(url, tries + 1);
    }
    if (!res.ok) throw new Error(`Wikidata ${res.status} ${url.slice(0, 120)}`);
    return res.json();
  }
  async function entities(list, props = 'labels|claims|sitelinks') {
    const out = {};
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const u = 'https://www.wikidata.org/w/api.php?' + new URLSearchParams({
        action: 'wbgetentities', format: 'json', ids: chunk.join('|'), props, languages: 'th|en', sitefilter: 'thwiki', maxlag: '5'
      });
      const j = await get(u);
      if (j.error?.code === 'maxlag') { await new Promise(r => setTimeout(r, 5000)); i -= 50; continue; }
      Object.assign(out, j.entities || {});
    }
    return out;
  }
  // อ่านเลข QID จากข้อความตรง ๆ ถ้าบริการตัดผลกลางทางก็ยังได้ส่วนที่มาแล้ว
  async function sparqlIds(query, tries = 0) {
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
    const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'application/sparql-results+json' } });
    if ((res.status === 429 || res.status >= 500) && tries < 4) {
      await new Promise(r => setTimeout(r, (+res.headers?.get?.('retry-after') || 10 * 2 ** tries) * 1000));
      return sparqlIds(query, tries + 1);
    }
    const text = await res.text();
    const found = [...new Set([...text.matchAll(/"value"\s*:\s*"http:\/\/www\.wikidata\.org\/entity\/(Q\d+)"/g)].map(m => m[1]))];
    const complete = res.ok && /\]\s*\}\s*\}\s*$/.test(text);
    return { ids: found, complete };
  }
  return { entities, sparqlIds };
}

// คำค้นแยกตามประเภททีละตัว เพราะคำค้นรวมทุกประเภทใช้เวลานานจนบริการของ Wikidata ตัดกลางทาง
const byType = (types, body) => types.map(t => `SELECT DISTINCT ?item WHERE { ?item wdt:P31 wd:${t}. ${body} }`);
const THWIKI = '?a schema:about ?item; schema:isPartOf <https://th.wikipedia.org/>.';
export const QUERIES = {
  thaiFilms: byType(FILM_TYPES, '?item wdt:P495 wd:Q869.'),
  thaiSeries: byType(SERIES_TYPES, '?item wdt:P495 wd:Q869.'),
  thwikiFilms: byType(FILM_TYPES, THWIKI),
  thwikiSeries: byType(SERIES_TYPES, THWIKI)
};

