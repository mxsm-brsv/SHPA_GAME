-- Проверка миграции v6 (после v5_test.sql): общий сброс прогресса и защита от старых вкладок.
\set ON_ERROR_STOP 1
set test.role = '';
select id as admin_id from players where role = 'admin' limit 1 \gset
select id as org from players where role = 'staff' limit 1 \gset
select id as p2 from players where faction = 'iee' and role = 'participant' limit 1 \gset
\echo '--- до сброса: есть баллы, сдачи, отметки, заказы'
update settings set value = 'true' where key = 'test_mode';
set test.uid = :'p2';
select _grant_task(:'p2', 'bonus', 40, 'task', null, 'тест') as granted;
select merch_buy((select id from merch_items where active and stock > 0 and price <= 40 order by price limit 1))->>'price' as bought;
select sum(stock) as stock_before from merch_items \gset
select count(*) as orders_before from merch_orders where status <> 'cancelled' \gset
select (select sum(rating) from players) > 0 as has_rating, (select count(*) from submissions) > 0 as has_subs,
       (select count(*) from lectures) > 0 as has_qr, :orders_before > 0 as has_orders;
select setting_int('progress_epoch', 0) as epoch_before \gset
\echo '--- участник и неверное слово — отказ'
do $$ begin perform admin_reset_progress('СБРОС'); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
set test.uid = :'admin_id';
do $$ begin perform admin_reset_progress('да'); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
\echo '--- сброс прогресса'
select _reset_progress() - 'epoch' as report;  -- кнопка админа с v7 сбрасывает ещё и регистрации (v7_test)
select (select coalesce(sum(rating), 0) from players) as rating_sum,
       (select count(*) from rating_log) as log_rows,
       (select count(*) from submissions) as subs,
       (select count(*) from lectures) as qr,
       (select count(*) from merch_orders) as orders,
       (select sum(stock) from merch_items) - :stock_before as stock_returned,
       (select count(*) from players where state <> '{}'::jsonb or stage <> 1 or power <> 0 or contributed <> 0) as dirty_players,
       (select coalesce(sum(xp), 0) from pb_buildings) as pb_xp,
       (select count(*) from map_points where owner is not null) as owned_points,
       (select count(*) from roster where player_id is not null) > 0 as logins_kept,
       setting_int('progress_epoch', 0) - :epoch_before as epoch_step;
\echo '--- старая вкладка не может записать прежнее состояние'
set test.uid = :'p2';
do $$ begin perform save_progress('{"v":1,"coins":99999}'::jsonb, 100, 5, setting_int('progress_epoch', 0) - 1); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
do $$ begin perform save_progress('{"v":1,"coins":99999}'::jsonb, 100, 5); exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
select state = '{}'::jsonb as still_clean from players where id = :'p2';
select (me()->>'epoch')::int = setting_int('progress_epoch', 0) as me_has_epoch;
select save_progress('{"v":1,"coins":5}'::jsonb, 100, 2, (me()->>'epoch')::int);
select state->>'coins' as saved_coins from players where id = :'p2';
\echo 'ГОТОВО v6'
