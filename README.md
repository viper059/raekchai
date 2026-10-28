# แรกฉาย

แรกฉาย รวมหนังและซีรีส์ทุกเรื่อง เรียงตามปีและเดือนที่ฉายครั้งแรก ค้นได้ตามโซน ประเภท ประเทศ นักแสดง และดูว่าเรื่องไหนมีให้ดูที่แอปไหน พร้อมพากย์ไทยหรือซับไทย

## โครงสร้าง

| ไฟล์ | คืออะไร |
|---|---|
| `index.html` | หน้าเว็บทั้งหมด (ไฟล์เดียว) อ่านข้อมูลจาก Supabase โดยตรง ขึ้น GitHub Pages ได้เลย |
| `supabase/migrations/` | โครงสร้างฐานข้อมูล ติดตั้งแล้วบนโปรเจกต์ Supabase `raekchai` |
| `supabase/seed.sql` | 23 เรื่องตั้งต้น (ใส่ไว้แล้ว) |
| `scripts/import-tmdb.mjs` | สคริปต์ดึงหนังและซีรีส์จาก TMDB ลงฐานข้อมูล |
| `.github/workflows/import-tmdb.yml` | รันสคริปต์ทุกวันตี 3 (เวลาไทย) และกดรันเองได้ |
| `test/` | ทดสอบสคริปต์ดึงข้อมูลและหน้าเว็บ |

## ตั้งค่าครั้งแรก

### 1. GitHub Pages
Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / `(root)` → Save

### 2. Supabase: ลิงก์เข้าสู่ระบบ
Authentication → URL Configuration
- **Site URL**: `https://viper059.github.io/raekchai/`
- **Redirect URLs**: เพิ่ม `https://viper059.github.io/raekchai/`

ระบบส่งอีเมลของ Supabase แบบฟรีส่งได้น้อยมากต่อชั่วโมง ถ้ามีคนใช้เยอะ ให้ตั้ง SMTP ของตัวเองที่ Authentication → Emails → SMTP Settings

### 3. GitHub Secrets สำหรับดึงข้อมูล
Settings → Secrets and variables → Actions → New repository secret

| ชื่อ | เอามาจาก |
|---|---|
| `TMDB_TOKEN` | themoviedb.org → Settings → API → **API Read Access Token** |
| `DATABASE_URL` | Supabase → ปุ่ม **Connect** → **Session pooler** (ใส่รหัสผ่านฐานข้อมูลแทน `[YOUR-PASSWORD]`) |

ใช้ Session pooler เท่านั้น เพราะ GitHub Actions ต่อแบบ Direct connection ไม่ได้

### 4. ดึงข้อมูลชุดแรก
Actions → **ดึงข้อมูลจาก TMDB** → Run workflow → mode: `seed`

ดึงหนังและซีรีส์ไทยทั้งหมดที่ TMDB มี และเรื่องยอดนิยมที่เข้าโรงหรืออยู่ในแอปสตรีมในไทย ใช้เวลาหลายชั่วโมง หลังจากนั้นระบบจะอัปเดตเองทุกวัน

## กติกาข้อมูล

- **วันฉาย = ปี + เดือน** ที่เปิดให้ชมครั้งแรก ไม่นับฉายซ้ำ
  - หนัง: วันเข้าโรงแรกสุดจากทุกประเทศ ถ้าไม่มีใช้รอบเทศกาล ถ้าไม่มีอีกใช้วันออกสตรีม
  - ซีรีส์: วันออกอากาศตอนแรกของซีซัน 1
  - เรื่องที่แอดมินตั้ง `release_source = 'manual'` สคริปต์จะไม่แก้วันฉาย
- **นักแสดงนำ 3–10 คน** ตามลำดับเครดิต
- **โซน** คำนวณจากประเทศหลัก
- **ถูกใจ** ต้องเข้าสู่ระบบ กดได้ 1 ครั้งต่อเรื่อง ยอดนับอัตโนมัติ แก้ตรง ๆ ไม่ได้
- **พากย์ไทย / ซับไทย** TMDB ไม่มีข้อมูลนี้ แอดมินต้องกรอกในตาราง `title_platforms` (`audio_th`, `sub_th`) สคริปต์จะไม่เขียนทับ ซีรีส์และหนังไทยตั้งเป็นเสียงไทยต้นฉบับให้อัตโนมัติ
- สคริปต์ข้ามหนังสั้น (ต่ำกว่า 40 นาที) เรื่องสำหรับผู้ใหญ่ และเรื่องต่างประเทศที่มีโหวตน้อยกว่า 5

## แอดมิน

แอดมินแก้ข้อมูลผ่าน Supabase → Table Editor ได้เลย ถ้าจะให้บัญชีในเว็บแก้ข้อมูลได้ด้วย:

```sql
insert into admins (user_id) select id from auth.users where email = 'อีเมลแอดมิน';
```

เรื่องที่ข้อมูลยังไม่ครบดูได้จาก view `titles_incomplete`

## ทดสอบ

```bash
npm ci
DATABASE_URL=postgres://... node test/importer.test.mjs   # ใช้ฐานข้อมูลทดสอบ ห้ามใช้ production
node test/page.test.cjs                                      # ต้องติดตั้ง jsdom
```

## เครดิต

ข้อมูลหนัง โปสเตอร์ และนักแสดงจาก TMDB — This product uses the TMDB API but is not endorsed or certified by TMDB. ข้อมูลช่องทางสตรีมจาก JustWatch

TMDB API ใช้ฟรีได้เฉพาะเว็บที่ไม่หารายได้ ถ้าจะติดโฆษณาหรือเก็บเงิน ต้องขอ license เชิงพาณิชย์จาก TMDB ก่อน
