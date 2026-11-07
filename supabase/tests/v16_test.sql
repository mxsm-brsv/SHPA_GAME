-- Проверка v16: боевой режим, Telegram-id игрока для бота, задания, мерч выезда, ставка баллами на колесе.
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
set test.uid = '';

-- организатор и два участника из списка (после прошлого сброса привязки сняты)
do $$ declare r bigint; u uuid; begin
  if not exists (select 1 from players where is_staff and roster_id is not null) then
    select id into r from roster where role in ('staff', 'admin') and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end if;
  while (select count(*) from players where role = 'participant' and roster_id is not null) < 2 loop
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end loop;
end $$;
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
select (array_agg(id order by id))[1] as p1, (array_agg(id order by id))[2] as p2
from (select id from players where role = 'participant' and roster_id is not null order by id limit 2) x \gset

\echo '--- боевой режим'
-- прошлые сценарии включали тест-режим для своих проверок; миграция v16 ставит false — возвращаем как на живой базе
insert into settings (key, value) values ('test_mode', 'false'::jsonb), ('shop_open', 'false'::jsonb) on conflict (key) do update set value = excluded.value;
select pg_temp.ok(not test_mode(), 'тест-режим выключен');
set test.uid = :'p1';
select pg_temp.fails($q$select merch_buy('s7_removka')$q$, 'Магазин мерча ещё закрыт%', 'магазин закрыт, пока организаторы не откроют');

\echo '--- бот находит игрока по Telegram'
update roster set tg_id = 555000111 where player_id = :'p1';
select pg_temp.ok((select tg_id from players where id = :'p1') = 555000111, 'Telegram-id скопирован игроку');
set test.role = 'service_role';
select pg_temp.ok(service_bot_profile(555000111)->>'rating' is not null, '«Мои баллы» в боте: профиль найден');
set test.role = '';
update roster set tg_id = 555000222 where player_id = :'p1';
select pg_temp.ok((select tg_id from players where id = :'p1') = 555000222, 'смена Telegram-id тоже копируется');

\echo '--- задания'
select pg_temp.ok((select count(*) from task_defs where id in ('invite', 'morning', 'monument', 'steps') and lim = '0') = 4, 'убранные задания не начисляются');
select pg_temp.ok(_grant_task(:'p1', 'steps', 60) = 0, '«Шаги» больше не дают баллов');
select pg_temp.ok((select count(*) from task_defs where id in ('lightning', 'breakfast', 'interview', 'warmup') and moderated) = 4, 'четыре новых задания с проверкой');

\echo '--- мерч выезда'
select pg_temp.ok((select count(*) from merch_items where active and id like 's7\_%') = 34, '34 позиции мерча');
select pg_temp.ok((select sum(total) from merch_items where active and id like 's7\_%' and not unlimited) = 80, '80 штук + 2 безлимитных');
select pg_temp.ok((select sum(p) from (select max(price) p from merch_items where active and id like 's7\_%' group by case when name like 'Футболка с горами%' then name else split_part(name, ' · ', 1) end) x) = 2565, 'по штуке каждого вида — 2565 баллов');
select pg_temp.ok(not exists (select 1 from merch_items where active and id in ('removka', 'stickers', 'pin', 'notebook', 'shopper', 'hoodie')), 'старых тестовых товаров в продаже нет');

\echo '--- колесо: ставка баллами — всегда проигрыш'
select _grant_task(:'p1', 'bonus', 500, 'task', null, 'тест v16') as g \gset
set test.uid = :'p1';
select (my_wallet()->>'balance')::int as bal0, (select rating from players where id = :'p1') as r0 \gset
select casino_points_bet(100) as w \gset
select pg_temp.ok((:'w'::jsonb->>'mult')::int = 0 and (:'w'::jsonb->>'balance')::int = :bal0 - 100 and (:'w'::jsonb->>'casino')::int = 100, 'ставка 100: ×0, со счёта магазина ушло 100');
select pg_temp.ok((select rating from players where id = :'p1') = :r0, 'рейтинг не изменился');
select pg_temp.fails($q$select casino_points_bet(1000000)$q$, 'На счёте только%', 'больше, чем на счёте, не поставить');
select pg_temp.fails($q$select casino_points_bet(0)$q$, 'Ставка — хотя бы 1 балл%', 'нулевая ставка');
set test.uid = :'staff_id';
select pg_temp.fails($q$select casino_points_bet(10)$q$, 'Организаторы ставят только профкоины%', 'организатор баллами не ставит');
insert into settings (key, value) values ('shop_open', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
set test.uid = :'p1';
select casino_points_bet((my_wallet()->>'balance')::int - 30) is not null as allin \gset
select pg_temp.fails($q$select merch_buy('s7_removka')$q$, 'Не хватает%', 'проигранные баллы не потратить на мерч');
select pg_temp.ok((merch_buy('s7_org_smile')->>'price')::int = 5, 'на остаток можно купить подешевле');
set test.uid = :'staff_id';
select pg_temp.ok((casino_stats()->>'points')::int >= 100 and (casino_stats()->>'pointsPlayers')::int >= 1, 'итог казино: проиграно баллов');
select _reset_all();
select pg_temp.ok(not exists (select 1 from casino_point_bets), 'сброс чистит ставки баллами');
select pg_temp.ok((_db_summary()->>'merch_items')::int >= 34 and (_db_summary()->>'test_mode')::boolean = false, 'сводка: мерч и боевой режим');
