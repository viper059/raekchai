-- เปลี่ยนแหล่งข้อมูลหลักเป็น Wikidata (CC0 ใช้ได้ทุกแบบ)
alter table titles    add column wikidata_id text unique;
alter table people    add column wikidata_id text unique;
alter table companies add column wikidata_id text unique;
alter table networks  add column wikidata_id text unique;
