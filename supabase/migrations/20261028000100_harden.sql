-- ปิดฟังก์ชันภายใน, ย้าย is_admin ไป schema private, แยก policy แอดมิน, เร่ง policy ถูกใจ
revoke execute on function public.sync_like_count() from public, anon, authenticated;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'countries','genres','companies','people','networks','platforms','titles','seasons',
    'title_countries','title_genres','title_companies','title_cast',
    'title_creators','title_networks','title_platforms'
  ] loop
    execute format('drop policy "admin write" on %I', t);
    execute format('create policy "admin insert" on %I for insert to authenticated with check ((select private.is_admin()))', t);
    execute format('create policy "admin update" on %I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t);
    execute format('create policy "admin delete" on %I for delete to authenticated using ((select private.is_admin()))', t);
  end loop;
end $$;

drop function public.is_admin();

drop policy "see own likes"    on title_likes;
drop policy "like as yourself" on title_likes;
drop policy "unlike your own"  on title_likes;
create policy "see own likes"    on title_likes for select to authenticated using (user_id = (select auth.uid()));
create policy "like as yourself" on title_likes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "unlike your own"  on title_likes for delete to authenticated using (user_id = (select auth.uid()));

create policy "see own admin row" on admins for select to authenticated using (user_id = (select auth.uid()));

create index on companies (country);
create index on networks (country);
