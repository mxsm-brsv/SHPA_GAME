-- Проверка миграции v4 (после v3_test.sql). Не для продакшена.
\set ON_ERROR_STOP 1
select id as p1 from players where faction = 'inei' and role = 'participant' limit 1 \gset
update players set tg_id = 777000111 where id = :'p1';
\echo '--- профиль для бота: чужим нельзя, сервису можно'
set test.role = 'authenticated';
do $$ begin perform service_bot_profile(777000111); raise exception 'должно было упасть'; exception when others then raise notice 'ожидаемо: %', sqlerrm; end $$;
set test.role = 'service_role';
select service_bot_profile(777000111) ? 'rating' as has_rating, (service_bot_profile(777000111)->>'place')::int >= 1 as place_ok,
  (service_bot_profile(777000111)->>'fplace')::int between 1 and 10 as fplace_ok, service_bot_profile(1) is null as unknown_null;
set test.role = '';
\echo '--- мерч: стартовый набор только в пустой магазин'
select count(*) as merch_items from merch_items;
\echo 'ГОТОВО v4'
