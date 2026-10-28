-- =============================================================
--  แรกฉาย — ฐานข้อมูลภาพยนตร์และซีรีส์ตามปีที่ฉายครั้งแรก
--  PostgreSQL / Supabase
--
--  กติกาข้อมูล
--  • หนังและซีรีส์อยู่ในตาราง titles เดียวกัน แยกด้วย kind
--  • วันฉาย = ปี + เดือนที่เปิดให้คนชมครั้งแรก ไม่นับฉายซ้ำ
--    หนัง: ยึดวันเข้าโรง (TMDb type 2–3) ก่อน ถ้าไม่มีจึงใช้รอบเทศกาล (type 1)
--    ซีรีส์: วันออกอากาศตอนแรกของซีซัน 1 ส่วนซีซันอื่นเก็บในตาราง seasons
--  • นักแสดงเก็บเฉพาะนักแสดงนำ 3–10 คน (billing 0–9)
--  • โซนคำนวณจากประเทศหลัก ไม่เก็บซ้ำในตาราง titles
--  • ช่องทางสตรีมเก็บแยกว่ามีพากย์ไทย/ซับไทยหรือไม่ ต่อแพลตฟอร์ม
--  • ผู้ใช้กดถูกใจได้ 1 ครั้งต่อเรื่อง ลำดับหนังคนชอบเรียงจาก like_count
-- =============================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------- ตารางอ้างอิง ----------

create table countries (
  code     char(2) primary key,               -- ISO 3166-1 เช่น TH, KR, US
  name_th  text not null,
  name_en  text not null,
  zone     text not null
           check (zone in ('thai', 'asia', 'hollywood', 'europe', 'other'))
);

create table genres (
  id       smallserial primary key,
  tmdb_id  int unique,
  name_th  text not null,
  name_en  text not null
);

create table companies (
  id        bigserial primary key,
  tmdb_id   int unique,
  name      text not null,
  country   char(2) references countries(code),
  logo_url  text
);

create table people (
  id           bigserial primary key,
  tmdb_id      int unique,
  name_th      text,
  name_en      text not null,
  profile_url  text
);

-- ช่องที่ออกอากาศครั้งแรก (ทีวีหรือแพลตฟอร์มต้นทาง) เช่น ช่อง 3, GMM25, tvN, Netflix
create table networks (
  id        smallserial primary key,
  tmdb_id   int unique,
  name      text not null unique,
  country   char(2) references countries(code),
  logo_url  text
);

create table platforms (
  id                smallserial primary key,
  tmdb_provider_id  int unique,
  name              text not null unique,
  logo_url          text,
  homepage          text
);

-- ---------- ตารางหลัก ----------

create table titles (
  id              bigserial primary key,
  kind            text not null check (kind in ('movie', 'series')),
  tmdb_id         int,                                -- TMDb แยกเลข movie กับ tv
  title_th        text,
  title_en        text not null,
  title_original  text,
  release_year    smallint not null check (release_year between 1888 and 2100),
  release_month   smallint check (release_month between 1 and 12),   -- ว่างได้ ถ้าไม่รู้เดือน
  release_source  text not null default 'theatrical'
                  check (release_source in ('theatrical', 'festival', 'broadcast', 'manual')),
  runtime_min     smallint check (runtime_min > 0),   -- หนัง: ความยาวเรื่อง / ซีรีส์: ความยาวต่อตอน
  series_status   text check (series_status in ('airing', 'ended', 'canceled')),
  end_year        smallint,                           -- ปีที่ซีรีส์จบ
  unique (kind, tmdb_id),
  check (kind = 'series' or (series_status is null and end_year is null)),
  synopsis_th     text,
  synopsis_en     text,
  poster_url      text,
  needs_review    boolean not null default false,   -- ให้แอดมินตรวจ/เติมข้อมูล
  like_count      int not null default 0,           -- นับจาก title_likes อัตโนมัติ ห้ามแก้เอง
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ซีซันของซีรีส์ (ซีซัน 1 ต้องตรงกับปี/เดือนใน titles)
create table seasons (
  title_id       bigint references titles(id) on delete cascade,
  season_number  smallint not null check (season_number >= 0),   -- 0 = ตอนพิเศษ
  name           text,
  release_year   smallint not null,
  release_month  smallint check (release_month between 1 and 12),
  episode_count  smallint check (episode_count > 0),
  poster_url     text,
  primary key (title_id, season_number)
);

-- ---------- ตารางเชื่อม ----------

create table title_networks (
  title_id    bigint   references titles(id) on delete cascade,
  network_id  smallint references networks(id),
  primary key (title_id, network_id)
);

create table title_countries (
  title_id    bigint  references titles(id) on delete cascade,
  country     char(2) references countries(code),
  is_primary  boolean not null default false,       -- ประเทศหลัก ใช้คำนวณโซน
  primary key (title_id, country)
);
create unique index one_primary_country
  on title_countries (title_id) where is_primary;

create table title_genres (
  title_id  bigint   references titles(id) on delete cascade,
  genre_id  smallint references genres(id),
  primary key (title_id, genre_id)
);

create table title_companies (
  title_id    bigint references titles(id) on delete cascade,
  company_id  bigint references companies(id),
  billing     smallint not null default 0,
  primary key (title_id, company_id)
);

create table title_cast (
  title_id   bigint references titles(id) on delete cascade,
  person_id  bigint references people(id),
  character  text,
  billing    smallint not null check (billing between 0 and 9),   -- สูงสุด 10 คน
  primary key (title_id, person_id),
  unique (title_id, billing)
);

-- ผู้กำกับ (หนัง) หรือผู้สร้างซีรีส์
create table title_creators (
  title_id   bigint references titles(id) on delete cascade,
  person_id  bigint references people(id),
  role       text not null default 'director' check (role in ('director', 'creator')),
  primary key (title_id, person_id, role)
);

create table title_platforms (
  title_id     bigint   references titles(id) on delete cascade,
  platform_id  smallint references platforms(id),
  region       char(2)  not null default 'TH' references countries(code),
  offer        text     not null default 'stream'
               check (offer in ('stream', 'free', 'rent', 'buy')),
  audio_th     text     not null default 'none'          -- เสียงไทยบนแพลตฟอร์มนี้
               check (audio_th in ('original', 'dub', 'none')),   -- ต้นฉบับไทย / พากย์ไทย / ไม่มี
  sub_th       boolean  not null default false,         -- มีซับไทย
  link         text,
  checked_at   timestamptz not null default now(),      -- วันที่เช็กล่าสุด (TMDb ไม่มีข้อมูลเสียง/ซับ ต้องเช็กเอง)
  primary key (title_id, platform_id, region, offer)
);

-- ---------- ดัชนี ----------

create index titles_timeline_idx on titles (release_year desc, release_month desc nulls last);
create index titles_kind_idx on titles (kind, release_year desc);
create index on title_networks (network_id);

create index titles_title_th_trgm   on titles    using gin (title_th extensions.gin_trgm_ops);
create index titles_title_en_trgm   on titles    using gin (title_en extensions.gin_trgm_ops);
create index titles_title_orig_trgm on titles    using gin (title_original extensions.gin_trgm_ops);
create index people_name_th_trgm    on people    using gin (name_th extensions.gin_trgm_ops);
create index people_name_en_trgm    on people    using gin (name_en extensions.gin_trgm_ops);
create index companies_name_trgm    on companies using gin (name extensions.gin_trgm_ops);

create index on title_countries (country);
create index on title_genres    (genre_id);
create index on title_companies (company_id);
create index on title_cast      (person_id);
create index on title_creators (person_id);
create index on title_platforms (platform_id, region);
create index title_platforms_thai_audio on title_platforms (region, platform_id) where audio_th <> 'none';

-- ---------- updated_at อัตโนมัติ ----------

create function touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger titles_touch before update on titles
  for each row execute function touch_updated_at();

-- ---------- View สำหรับหน้าไทม์ไลน์ ----------

create view title_timeline with (security_invoker = true) as
select
  m.id, m.kind, m.title_th, m.title_en, m.poster_url,
  m.release_year, m.release_month, m.series_status, m.end_year, m.like_count,
  c.code as country, c.zone,
  (select count(*) from seasons s where s.title_id = m.id and s.season_number > 0) as season_count,
  coalesce((select array_agg(g.name_th order by g.name_th)
              from title_genres x join genres g on g.id = x.genre_id
             where x.title_id = m.id), '{}') as genres,
  coalesce((select array_agg(n.name)
              from title_networks x join networks n on n.id = x.network_id
             where x.title_id = m.id), '{}') as networks,
  coalesce((select array_agg(distinct p.name)
              from title_platforms x join platforms p on p.id = x.platform_id
             where x.title_id = m.id and x.region = 'TH'), '{}') as platforms_th,
  coalesce((select array_agg(distinct p.name)
              from title_platforms x join platforms p on p.id = x.platform_id
             where x.title_id = m.id and x.region = 'TH' and x.audio_th <> 'none'), '{}') as platforms_thai_audio,
  coalesce((select array_agg(distinct p.name)
              from title_platforms x join platforms p on p.id = x.platform_id
             where x.title_id = m.id and x.region = 'TH' and x.sub_th), '{}') as platforms_thai_sub
from titles m
left join title_countries mc on mc.title_id = m.id and mc.is_primary
left join countries c on c.code = mc.country;

-- เรื่องที่ข้อมูลยังไม่ครบ ให้แอดมินตามเติม
create view titles_incomplete with (security_invoker = true) as
select m.id, m.kind, m.title_th, m.title_en, m.release_year,
       (select count(*) from title_cast x where x.title_id = m.id)      as cast_count,
       (select count(*) from title_companies x where x.title_id = m.id) as company_count,
       (select count(*) from seasons x where x.title_id = m.id)         as season_count,
       m.needs_review
from titles m
where m.needs_review
   or (select count(*) from title_cast x where x.title_id = m.id) < 3
   or not exists (select 1 from title_companies x where x.title_id = m.id)
   or (m.kind = 'series' and not exists (select 1 from seasons x where x.title_id = m.id));

-- ---------- ค้นหา: ชื่อไทย/อังกฤษ/ต้นฉบับ นักแสดง ผู้กำกับ/ผู้สร้าง ค่าย ----------

create function search_titles(q text, kind_filter text default null, lim int default 30)
returns setof title_timeline
language sql stable set search_path = public as $$
  select t.* from title_timeline t
  join titles m on m.id = t.id
  where (kind_filter is null or m.kind = kind_filter)
    and (m.title_th ilike '%' || q || '%'
     or m.title_en ilike '%' || q || '%'
     or m.title_original ilike '%' || q || '%'
     or exists (select 1 from title_cast x join people p on p.id = x.person_id
                 where x.title_id = m.id
                   and (p.name_th ilike '%' || q || '%' or p.name_en ilike '%' || q || '%'))
     or exists (select 1 from title_creators x join people p on p.id = x.person_id
                 where x.title_id = m.id
                   and (p.name_th ilike '%' || q || '%' or p.name_en ilike '%' || q || '%'))
     or exists (select 1 from title_companies x join companies c on c.id = x.company_id
                 where x.title_id = m.id and c.name ilike '%' || q || '%'))
  order by t.release_year desc, t.release_month desc nulls last
  limit lim;
$$;

-- ---------- ถูกใจ และลำดับหนังคนชอบ ----------

create table title_likes (
  user_id     uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  title_id    bigint not null references titles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, title_id)          -- 1 คนกดได้ 1 ครั้งต่อเรื่อง
);
create index on title_likes (title_id, created_at desc);

-- นับยอดถูกใจเก็บไว้ใน titles.like_count ให้เรียงลำดับได้เร็ว
create function sync_like_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update titles set like_count = like_count + 1 where id = new.title_id;
  elsif tg_op = 'DELETE' then
    update titles set like_count = greatest(like_count - 1, 0) where id = old.title_id;
  end if;
  return null;
end $$;

create trigger title_likes_count after insert or delete on title_likes
  for each row execute function sync_like_count();

-- ไม่ให้ใครแก้ like_count ตรง ๆ (ยกเว้นทริกเกอร์ข้างบน)
create function guard_like_count() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.like_count is distinct from old.like_count and pg_trigger_depth() < 2 then
    new.like_count := old.like_count;
  end if;
  return new;
end $$;

create trigger titles_guard_like_count before update on titles
  for each row execute function guard_like_count();

-- ลำดับตลอดกาล: เรียงตามยอดถูกใจ เท่ากันให้เรื่องใหม่กว่าขึ้นก่อน
create view title_ranking with (security_invoker = true) as
select rank() over (order by t.like_count desc) as rank,
       rank() over (partition by t.kind order by t.like_count desc) as rank_in_kind,
       t.*
from title_timeline t
where t.like_count > 0
order by t.like_count desc, t.release_year desc, t.release_month desc nulls last;

-- มาแรง: ยอดถูกใจใน 30 วันล่าสุด
-- เป็นฟังก์ชัน security definer เพราะผู้ใช้แต่ละคนอ่าน title_likes ได้แค่ของตัวเอง
-- ฟังก์ชันนี้คืนแค่ยอดรวมต่อเรื่อง ไม่เปิดเผยว่าใครกดอะไร
create function trending_titles(days int default 30, lim int default 50)
returns table (title_id bigint, recent_likes bigint)
language sql stable security definer set search_path = public as $$
  select l.title_id, count(*) as recent_likes
  from title_likes l
  where l.created_at > now() - make_interval(days => least(greatest(days, 1), 365))
  group by l.title_id
  order by recent_likes desc
  limit least(greatest(lim, 1), 200);
$$;

-- กดถูกใจ / ยกเลิก ในคำสั่งเดียว คืนค่าสถานะใหม่และยอดล่าสุด
create function toggle_like(p_title_id bigint)
returns table (liked boolean, like_count int)
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบก่อนกดถูกใจ';
  end if;
  delete from title_likes where user_id = auth.uid() and title_id = p_title_id;
  if found then
    liked := false;
  else
    insert into title_likes (user_id, title_id) values (auth.uid(), p_title_id);
    liked := true;
  end if;
  select t.like_count into like_count from titles t where t.id = p_title_id;
  return next;
end $$;

alter table title_likes enable row level security;
create policy "see own likes"    on title_likes for select to authenticated using (user_id = auth.uid());
create policy "like as yourself" on title_likes for insert to authenticated with check (user_id = auth.uid());
create policy "unlike your own"  on title_likes for delete to authenticated using (user_id = auth.uid());

-- ---------- สิทธิ์: ทุกคนอ่านได้ เฉพาะแอดมินเขียน ----------

create table admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table admins enable row level security;   -- ไม่มี policy = แก้ได้จาก service role เท่านั้น

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'countries','genres','companies','people','networks','platforms','titles','seasons',
    'title_countries','title_genres','title_companies','title_cast',
    'title_creators','title_networks','title_platforms'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select using (true)', t);
    execute format(
      'create policy "admin write" on %I for all to authenticated
         using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- ---------- ข้อมูลเริ่มต้น ----------

insert into countries (code, name_th, name_en, zone) values
  ('TH','ไทย','Thailand','thai'),
  ('KR','เกาหลีใต้','South Korea','asia'),
  ('JP','ญี่ปุ่น','Japan','asia'),
  ('CN','จีน','China','asia'),
  ('HK','ฮ่องกง','Hong Kong','asia'),
  ('TW','ไต้หวัน','Taiwan','asia'),
  ('IN','อินเดีย','India','asia'),
  ('US','สหรัฐอเมริกา','United States','hollywood'),
  ('GB','สหราชอาณาจักร','United Kingdom','europe'),
  ('FR','ฝรั่งเศส','France','europe'),
  ('DE','เยอรมนี','Germany','europe'),
  ('IT','อิตาลี','Italy','europe'),
  ('ES','สเปน','Spain','europe');

-- id ตรงกับรหัสประเภทของ TMDb
insert into genres (tmdb_id, name_th, name_en) values
  (28,'แอ็กชัน','Action'), (12,'ผจญภัย','Adventure'), (16,'แอนิเมชัน','Animation'),
  (35,'ตลก','Comedy'), (80,'อาชญากรรม','Crime'), (99,'สารคดี','Documentary'),
  (18,'ดราม่า','Drama'), (10751,'ครอบครัว','Family'), (14,'แฟนตาซี','Fantasy'),
  (36,'ประวัติศาสตร์','History'), (27,'สยองขวัญ','Horror'), (10402,'ดนตรี','Music'),
  (9648,'ลึกลับ','Mystery'), (10749,'โรแมนติก','Romance'), (878,'ไซไฟ','Science Fiction'),
  (53,'ระทึกขวัญ','Thriller'), (10752,'สงคราม','War'), (37,'คาวบอย','Western'),
  -- ประเภทที่ TMDb ใช้กับซีรีส์
  (10759,'แอ็กชันและผจญภัย','Action & Adventure'), (10765,'ไซไฟและแฟนตาซี','Sci-Fi & Fantasy'),
  (10766,'ละคร','Soap'), (10764,'เรียลลิตี้','Reality'), (10762,'เด็ก','Kids'),
  (10768,'สงครามและการเมือง','War & Politics');

-- ช่องออกอากาศ (networks) และแอปสตรีม (platforms) สคริปต์ดึงข้อมูลจาก TMDb เติมให้เอง พร้อมโลโก้
