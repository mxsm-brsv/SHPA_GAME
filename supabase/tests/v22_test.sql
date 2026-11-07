-- Проверка v22: журнал сканов — кто, когда, что и сколько баллов.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
set test.role = '';
do $$ declare r bigint; u uuid; begin
  if not exists (select 1 from players where is_staff and roster_id is not null) then
    select id into r from roster where role in ('staff', 'admin') and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end if;
  while (select count(*) from players where role = 'participant' and roster_id is not null) < 1 loop
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end loop;
end $$;
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
select id as p1 from players where role = 'participant' and roster_id is not null order by id limit 1 \gset
insert into print_codes (hash, kind, n, day, points, max_claims, title) values
  (encode(sha256(convert_to('shpa:' || _print_norm('TSTLOG0001'), 'UTF8')), 'hex'), 'cache', 77, null, 15, 0, 'Тайник №77');
insert into code_words (hash, hint, points) values (_word_hash('Журнал тест'), 'тест журнала', 15);

\echo '--- журнал сканов'
set test.uid = :'p1';
select redeem_code('TSTLOG0001') is not null as a \gset
select redeem_code('журнал тест') is not null as b \gset
set test.uid = :'staff_id';
select staff_scan_log() as j \gset
select pg_temp.ok((select count(*) from jsonb_array_elements(:'j'::jsonb) e where e->>'title' = 'Тайник №77' and (e->>'points')::int = 15 and e->>'kind' = 'cache' and e->>'player' is not null and (e->>'at')::bigint > 0) = 1, 'тайник: кто, когда, +15');
select pg_temp.ok((select count(*) from jsonb_array_elements(:'j'::jsonb) e where e->>'kind' = 'word' and e->>'title' = 'тест журнала' and (e->>'points')::int = 15) = 1, 'кодовое слово в журнале');
select pg_temp.ok(jsonb_array_length(staff_scan_log('cache')) >= 1 and not exists (select 1 from jsonb_array_elements(staff_scan_log('cache')) e where e->>'kind' not in ('cache', 'cache_gold')), 'фильтр «тайники»');
set test.uid = :'p1';
select pg_temp.ok((select count(*) from pg_temp.ok(true, 'x')) = 1, 'участник');
do $$ begin perform staff_scan_log(); raise exception 'ПРОВАЛ: участнику журнал виден'; exception when others then if sqlerrm not like 'staff only%' then raise; end if; end $$;
delete from print_codes where n = 77 and kind = 'cache';
delete from code_words where hint = 'тест журнала';
