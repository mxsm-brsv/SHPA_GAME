-- Проверка v27: лоты для ПБ, цены разом, возврат невыданного, сборы.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
create or replace function pg_temp.fails(q text, pat text, what text) returns text language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like pat then return 'ok  ' || what || ' (' || sqlerrm || ')'; end if;
    raise exception 'ПРОВАЛ: % — не та ошибка: %', what, sqlerrm;
  end;
  raise exception 'ПРОВАЛ: % — ошибки не было', what;
end $$;
set test.role = '';
do $$ declare r bigint; u uuid; begin
  while (select count(*) from players where role = 'participant' and roster_id is not null) < 2 loop
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end loop;
end $$;
select (array_agg(id order by id))[1] as p1, (array_agg(id order by id))[2] as p2 from (select id from players where role = 'participant' and roster_id is not null order by id limit 2) x \gset
select faction as f1 from players where id = :'p1' \gset
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
insert into settings (key, value) values ('shop_open', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
select _grant_task(:'p1', 'bonus', 900, 'task', null, 'v27') as g1 \gset
select _grant_task(:'p2', 'bonus', 900, 'task', null, 'v27') as g2 \gset

\echo '--- лот только для ПБ'
set test.uid = :'staff_id';
select staff_merch_save(jsonb_build_object('id', 's7_removka', 'factions', jsonb_build_array('zzz_none'))) is null as a \gset
select staff_merch_save(('{"id":"s7_org_poster","factions":["' || :'f1' || '"]}')::jsonb) is null as b \gset
set test.uid = :'p1';
select pg_temp.ok(exists (select 1 from jsonb_array_elements(merch_list()) e where e->>'id' = 's7_org_poster'), 'своему ПБ лот виден');
set test.uid = :'p2';
select pg_temp.ok((select faction from players where id = :'p2') = :'f1' or not exists (select 1 from jsonb_array_elements(merch_list()) e where e->>'id' = 's7_org_poster'), 'чужому ПБ лот не виден');
set test.uid = :'staff_id';
select staff_merch_save('{"id":"s7_org_poster","factions":[]}'::jsonb) is null as c \gset
select pg_temp.ok((select factions is null from merch_items where id = 's7_org_poster'), 'снова для всех ПБ');

\echo '--- цены разом'
select price as pr0 from merch_items where id = 's7_removka' \gset
select pg_temp.ok(staff_merch_price_all(10) >= 34, 'всем товарам +10%');
select pg_temp.ok((select price from merch_items where id = 's7_removka') = round(:pr0 * 1.1), 'ремувка подорожала на 10%');
select staff_merch_price_all(-9) as d \gset

\echo '--- вернуть невыданное'
set test.uid = :'p1';
select merch_buy('s7_removka') is not null as o1 \gset
select (my_wallet()->>'balance')::int as bal1, (select stock from merch_items where id = 's7_removka') as st1 \gset
set test.uid = :'staff_id';
select staff_orders_cancel_pending() as cp \gset
select pg_temp.ok((:'cp'::jsonb->>'orders')::int >= 1, 'невыданные заказы отменены');
select pg_temp.ok((select stock from merch_items where id = 's7_removka') = :st1 + 1, 'штука вернулась в магазин');
set test.uid = :'p1';
select pg_temp.ok((my_wallet()->>'balance')::int > :bal1, 'баллы вернулись участнику');

\echo '--- сборы'
select id as gid from goals where effect = 'open_shop' \gset
select pg_temp.ok((select target from goals where id = :gid) = 50000, 'цель «Открыть магазин» — 50 000');
set test.uid = :'staff_id';
select staff_goal_save(('{"id":' || :gid || ',"target":300}')::jsonb) is not null as t \gset
insert into settings (key, value) values ('shop_open', 'false'::jsonb) on conflict (key) do update set value = 'false'::jsonb;
select pg_temp.fails($q$select goal_donate(1, 10)$q$, 'Организаторы не донатят%', 'организатор не донатит');
set test.uid = :'p1';
select (my_wallet()->>'balance')::int as b0 \gset
select goal_donate(:gid, 200) as d1 \gset
select pg_temp.ok((:'d1'::jsonb->>'raised')::int = 200 and (:'d1'::jsonb->>'mine')::int = 200 and jsonb_array_length(:'d1'::jsonb->'top') = 1, 'донат 200: прогресс и топ');
select pg_temp.ok((my_wallet()->>'balance')::int = :b0 - 200 and (my_wallet()->>'goals')::int >= 200, 'баллы ушли со счёта магазина');
set test.uid = :'p2';
select goal_donate(:gid, 500) as d2 \gset
select pg_temp.ok((:'d2'::jsonb->>'given')::int = 100 and (:'d2'::jsonb->>'status') = 'done', 'берём только сколько не хватало — цель собрана');
select pg_temp.ok(setting_bool('shop_open', false), 'магазин открылся сам');
select pg_temp.fails($q$select goal_donate((select id from goals where effect = 'open_shop'), 10)$q$, 'Цель уже собрана%', 'после цели донат не принимается');
set test.uid = :'staff_id';
select staff_goal_save('{"title":"Видео с открытия","text":"Покажем на большом экране","target":7000}'::jsonb) as g2 \gset
select pg_temp.ok((select count(*) from jsonb_array_elements(goals_list())) >= 2, 'новый сбор в списке');
select pg_temp.ok(setting_int('contrib_daily_cap', 0) = 200000, 'лимит вклада в здания — 200 000');
