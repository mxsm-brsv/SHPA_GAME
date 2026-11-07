-- Проверка v14: печатные QR — тайники и «Я — скорость» (в базе только отпечатки кодов).
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
create or replace function pg_temp.h(c text) returns text language sql as $$ select encode(sha256(convert_to('shpa:' || c, 'UTF8')), 'hex') $$;
set test.role = '';
set test.uid = '';

-- тестовые коды (настоящие лежат в миграции только отпечатками)
insert into print_codes (hash, kind, n, day, points, max_claims, title)
select pg_temp.h('TSTCACHE' || lpad(i::text, 2, '0')), 'cache', i, null, 15, 0, 'Тайник №' || i from generate_series(1, 10) i;
insert into print_codes (hash, kind, n, day, points, max_claims, title) values
  (pg_temp.h('TSTGOLD777'), 'cache_gold', 0, null, 100, 1, 'Золотой тайник'),
  (pg_temp.h('TSTSPEED01'), 'speed', 1, (now() at time zone 'Europe/Moscow')::date, 30, 2, 'Я — скорость, сегодня'),
  (pg_temp.h('TSTSPEED02'), 'speed', 2, (now() at time zone 'Europe/Moscow')::date + 1, 30, 5, 'Я — скорость, завтра'),
  (pg_temp.h('TSTSPEED03'), 'speed', 3, (now() at time zone 'Europe/Moscow')::date, 30, 5, 'Я — скорость, сегодня 2');

select id as staff_id from players where role = 'staff' and roster_id is not null limit 1 \gset
-- четыре участника, привязанных к списку выезда (после прошлых сценариев привязаны не все)
do $$ declare p uuid; r bigint; begin
  for p in select id from players where role = 'participant' and roster_id is null order by id loop
    exit when (select count(*) from players where role = 'participant' and roster_id is not null) >= 4;
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    perform roster_attach(r, p);
  end loop;
end $$;
select array_agg(id order by id) as ps from (select id from players where role = 'participant' and roster_id is not null order by id limit 4) x \gset
select pg_temp.ok(array_length(:'ps'::uuid[], 1) = 4, 'есть четыре участника со списком');
select (:'ps'::uuid[])[1] as p1, (:'ps'::uuid[])[2] as p2, (:'ps'::uuid[])[3] as p3, (:'ps'::uuid[])[4] as p4 \gset

\echo '--- в миграции 13 настоящих кодов, тестовых CACHE-… больше нет'
select pg_temp.ok((select count(*) from print_codes where kind <> 'egg' and title not like 'Я — скорость, сегодня%' and title <> 'Я — скорость, завтра' and hash not in (select pg_temp.h('TSTCACHE' || lpad(i::text, 2, '0')) from generate_series(1, 10) i) and hash <> pg_temp.h('TSTGOLD777')) = 13, '13 печатных кодов из миграции');
select pg_temp.ok(not exists (select 1 from cache_codes where code like 'CACHE-%'), 'старые CACHE-01…10 и CACHE-GOLD удалены');
select pg_temp.ok(not has_function_privilege('authenticated', 'public._redeem_code_base(text)', 'execute'), 'прежнюю функцию напрямую не вызвать');

\echo '--- тайники: код, ссылка из QR, ввод с кириллицей и дефисом'
set test.uid = :'p1';
select pg_temp.ok((redeem_code('tstcache01')->>'granted')::int = 15, 'тайник по коду в нижнем регистре: +15');
select pg_temp.ok((redeem_code('https://t.me/shpa_game_bot?startapp=t_TSTCACHE02')->>'granted')::int = 15, 'тайник по ссылке из QR');
select pg_temp.ok((redeem_code('ТSТСАСНЕ-03')->>'granted')::int = 15, 'кириллица-двойники и дефис не мешают');
select pg_temp.ok(redeem_code('TSTCACHE01')->>'message' = 'Тайник №1 уже найден', 'повторно — «уже найден»');
select redeem_code('TSTCACHE' || lpad(i::text, 2, '0'))->>'message' from generate_series(4, 9) i;
select redeem_code('TSTCACHE10') as last10 \gset
select pg_temp.ok((:'last10'::jsonb->>'granted')::int = 65 and :'last10'::jsonb->>'message' like '%Все тайники%', 'десятый тайник: +15 и +50 за все: ' || (:'last10'::jsonb->>'message'));
select pg_temp.fails($q$select redeem_code('https://t.me/shpa_game_bot?startapp=t_NOSUCHCODE')$q$, 'QR не распознан%', 'чужой QR');
select pg_temp.fails($q$select redeem_code('CACHE-01')$q$, '%', 'старый тестовый код не работает');
select pg_temp.fails($q$select redeem_code('TSTCACHE1O')$q$, 'Код не подошёл — проверь 10 знаков%', 'опечатка в коде с распечатки — понятная подсказка');

\echo '--- организатор проверяет распечатку, ничего не расходуя'
set test.uid = :'staff_id';
select pg_temp.ok(redeem_code('TSTGOLD777')->>'message' like 'Код верный: Золотой тайник — ещё не найден%', 'организатор: «код верный», золото не тронуто');
select pg_temp.ok((redeem_code('TSTSPEED01')->>'granted')::int = 0, 'организатору «Я — скорость» не начисляется');
select pg_temp.ok(not exists (select 1 from print_claims where player_id = :'staff_id'), 'проверка организатора не оставила находок');

\echo '--- золотой тайник — только первому'
set test.uid = :'p2';
select pg_temp.ok((redeem_code('TSTGOLD777')->>'granted')::int = 100, 'первый нашёл золото: +100');
set test.uid = :'p3';
select pg_temp.ok(redeem_code('TSTGOLD777')->>'message' = 'Золотой тайник уже нашли до тебя', 'второму — «уже нашли»');

\echo '--- «Я — скорость»: только в свой день, первым N, раз в день'
set test.uid = :'p2';
select pg_temp.ok((redeem_code('TSTSPEED01')->>'granted')::int = 30, 'первый: +30');
select pg_temp.fails($q$select redeem_code('TSTSPEED02')$q$, 'Этот QR «Я — скорость» работает только%', 'завтрашний QR сегодня не работает');
select pg_temp.ok(redeem_code('TSTSPEED03')->>'message' = '«Я — скорость» сегодня уже засчитано', 'второй QR в тот же день — не засчитывается');
set test.uid = :'p3';
select pg_temp.ok(redeem_code('TSTSPEED01')->>'message' like '«Я — скорость»: ты 2-й!%', 'второй — «ты 2-й»');
set test.uid = :'p4';
select pg_temp.ok(redeem_code('TSTSPEED01')->>'message' = 'Опоздал: баллы уже забрали первые 2', 'третий при лимите 2 — опоздал');

\echo '--- кодовые слова и отметки работают как раньше'
insert into egg_codes (code, task, rating, note) values ('ЧЕТЫРНАДЦАТЬ', 'egg', 15, 'тест v14') on conflict do nothing;
select pg_temp.ok((redeem_code('четырнадцать')->>'granted')::int = 15, 'пасхалка по слову (8+ букв после чистки) проходит мимо печатных кодов');

\echo '--- полный сброс чистит находки'
select _reset_all();
select pg_temp.ok(not exists (select 1 from print_claims), 'после сброса находок нет');
select pg_temp.ok((_db_summary()->>'print_codes')::int >= 13 and (_db_summary()->>'old_caches')::int = 0, 'сводка: печатные коды на месте, старых тайников нет');
