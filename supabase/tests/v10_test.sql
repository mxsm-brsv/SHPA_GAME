-- Проверка миграции v10 (после v2–v9): начислить/снять, игры без баллов, цена мерча по остатку,
-- голосование, отмечает один организатор, захват профкома, полный сброс. Идёт с защитой safeupdate, как в Supabase.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
/** Ожидаемая ошибка: текст должен содержать like-шаблон. */
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

\echo '--- игроки: админ, организатор, участники ИЭЭ и ИРЭ в списке выезда'
select id as admin_id from players where role = 'admin' limit 1 \gset
select id as staff_id from players where role = 'staff' limit 1 \gset
select id as p_iee from players where faction = 'iee' and role = 'participant' and roster_id is not null limit 1 \gset
select id as p_ire from players where faction = 'ire' and role = 'participant' and roster_id is null order by id limit 1 \gset
select id as admin_roster from roster where role = 'admin' limit 1 \gset
select id as staff_roster from roster where role = 'staff' limit 1 \gset
select id as ire_roster from roster where faction = 'ire' and player_id is null limit 1 \gset
select roster_attach(:admin_roster, :'admin_id');
select roster_attach(:staff_roster, :'staff_id');
select roster_attach(:ire_roster, :'p_ire');
update players set faction = 'ire' where id = :'p_ire';

\echo '--- 1. Начислить ровно введённое и снять (не ниже нуля)'
set test.uid = :'admin_id';
update players set rating = 30 where id = :'p_iee';
select pg_temp.ok((staff_grant(:'p_iee', 15, 'bonus', 'тест')->>'granted')::int = 15, 'начислено ровно 15');
select pg_temp.ok((select rating from players where id = :'p_iee') = 45, 'рейтинг 45');
select pg_temp.ok((staff_grant(:'p_iee', -20, 'penalty', 'нарушение')->>'granted')::int = -20, 'снято 20');
select pg_temp.ok((staff_grant(:'p_iee', -500, 'penalty', null)->>'granted')::int = -25, 'снять больше, чем есть, — до нуля');
select pg_temp.fails(format('select staff_grant(%L, -5, %L, null)', :'p_iee', 'penalty'), '%0 баллов%', 'у кого 0 — снимать нечего');
select pg_temp.ok((select count(*) from notifications where player_id = :'p_iee' and text like 'Организатор снял%') = 2, 'участник получил уведомления о снятии');
select pg_temp.ok((select text from notifications where player_id = :'p_iee' and text like 'Организатор начислил%' order by id desc limit 1) = 'Организатор начислил +15 баллов: тест', 'текст без смайликов, с окончанием');
select pg_temp.fails(format('select staff_grant(%L, 10, %L, null)', :'p_iee', 'penalty'), '%выбери задание%', 'начислить «за штраф» нельзя');
set test.uid = :'p_iee';
select pg_temp.fails(format('select staff_grant(%L, -5, %L, null)', :'p_ire', 'penalty'), 'staff only', 'участник снимать не может');

\echo '--- 2. Игры баллов не дают'
select pg_temp.ok((add_game_rating('blocks', 30)->>'granted')::int = 0, 'мини-игра: 0 баллов');
select pg_temp.ok((select rating from players where id = :'p_iee') = 0, 'рейтинг не вырос');

\echo '--- 3. Цена мерча по остатку'
set test.uid = :'admin_id';
select staff_merch_save('{"name": "Тест-худи", "price": 100, "stock": 5}'::jsonb);
select id as mid from merch_items where name = 'Тест-худи' \gset
select staff_merch_save(jsonb_build_object('id', :'mid', 'tiers', '[{"left": 3, "price": 150}, {"left": 1, "price": 300}, {"left": "x", "price": 5}]'::jsonb));
select pg_temp.ok((select jsonb_array_length(tiers) from merch_items where id = :'mid') = 2, 'мусорное условие отброшено');
select pg_temp.ok((select merch_price(i) from merch_items i where id = :'mid') = 100, 'осталось 5 — обычная цена');
update merch_items set stock = 3 where id = :'mid';
select pg_temp.ok((select merch_price(i) from merch_items i where id = :'mid') = 150, 'осталось 3 — 150');
update merch_items set stock = 1 where id = :'mid';
select pg_temp.ok((select merch_price(i) from merch_items i where id = :'mid') = 300, 'осталось 1 — 300 (самое строгое условие)');
update merch_items set discount = 10 where id = :'mid';
select pg_temp.ok((select merch_price(i) from merch_items i where id = :'mid') = 270, 'ручная скидка считается от цены по остатку');
select pg_temp.ok((select merch_json(i)->'tiers'->0->>'left' from merch_items i where id = :'mid') = '3', 'условия — по убыванию остатка');
select staff_merch_save(jsonb_build_object('id', :'mid', 'tiers', '[]'::jsonb, 'discount', 0));
select pg_temp.ok((select merch_price(i) from merch_items i where id = :'mid') = 100, 'условия убраны — снова обычная цена');

\echo '--- 4. Голосование «Работа со спонсорами»'
set test.uid = :'staff_id';
select pg_temp.ok(jsonb_array_length(staff_vote_setup('Работа со спонсорами', '[{"id": "ire", "name": "ИРЭ", "faction": "ire"}, {"id": "iee", "name": "ИЭЭ", "faction": "iee"}, {"id": "t3", "name": "Команда 3"}]'::jsonb)->'teams') = 3, 'три команды');
set test.uid = :'p_ire';
select pg_temp.fails('select vote_cast(''iee'', 1)', '%закрыто%', 'до открытия голосовать нельзя');
set test.uid = :'staff_id';
select staff_vote_control('open', null);
set test.uid = :'p_ire';
select pg_temp.ok(vote_cast('iee', 1)->'my'->>'iee' = '1', 'ИРЭ: за ИЭЭ');
select pg_temp.fails('select vote_cast(''ire'', 1)', '%свою команду%', 'за свою — нельзя');
select vote_cast('t3', -1);
set test.uid = :'p_iee';
select vote_cast('ire', 1);
select vote_cast('t3', 1);
select pg_temp.ok(vote_cast('t3', -1)->'my'->>'t3' = '-1', 'передумал: против');
select pg_temp.ok((select (t->>'protiv')::int from jsonb_array_elements(vote_state()->'teams') t where t->>'id' = 't3') = 2, 'против «Команды 3» — 2');
select pg_temp.ok((vote_state()->>'voters')::int = 2, 'проголосовали двое');
select vote_cast('ire', 0);
select pg_temp.ok((select (t->>'za')::int from jsonb_array_elements(vote_state()->'teams') t where t->>'id' = 'ire') = 0, 'голос можно снять');
set test.uid = :'staff_id';
select staff_vote_control('open', 'iee');
set test.uid = :'p_iee';
select pg_temp.fails('select vote_cast(''t3'', 1)', '%другую команду%', 'пока на сцене ИЭЭ — только за неё');
select pg_temp.fails('select staff_vote_control(''reset'')', 'staff only', 'участник не управляет голосованием');
set test.uid = :'staff_id';
select pg_temp.ok((staff_vote_control('reveal', null)->>'reveal')::boolean, 'итог показан');
select pg_temp.ok(staff_vote_control('reset', null)->'teams'->0->>'za' = '0', 'голоса обнулены, команды остались');

\echo '--- 5. Отмечает один организатор'
set test.uid = :'admin_id';
select pg_temp.ok((staff_set_checkin_host(:admin_roster)->>'canCheckin')::boolean, 'админ назначил себя');
set test.uid = :'staff_id';
select pg_temp.fails('select staff_lecture_open(''Блок 1'', 15, 7, ''lecture'')', 'Отмечает и начисляет баллы только%', 'организатор не открывает отметку на блоке');
select pg_temp.fails(format('select staff_grant(%L, 10, %L, null)', :'p_iee', 'bonus'), 'Отмечает и начисляет баллы только%', 'и не начисляет');
select pg_temp.ok((staff_lecture_open('Я — скорость', 30, 60, 'speed', 5, false)->>'id') is not null, '«Я — скорость» — у всех');
select pg_temp.ok((get_config()->>'canCheckin')::boolean = false and get_config()->'checkinHost'->>'name' = 'Админ Админов', 'видно, кто отмечает');
select pg_temp.fails('select staff_set_checkin_host(null)', 'Только админы', 'менять — только админам');
set test.uid = :'admin_id';
select pg_temp.ok((staff_lecture_open('Блок 1', 15, 7, 'lecture')->>'id') is not null, 'отмечающий открывает блок');
set test.uid = '';
select pg_temp.ok(jsonb_typeof(get_config()->'checkinHost') = 'null', 'анонимному ключу имя не отдаётся');
set test.uid = :'admin_id';
select pg_temp.ok(jsonb_typeof(staff_set_checkin_host(null)->'checkinHost') = 'null', 'снова отмечают все');

\echo '--- 6. Захват профкома'
set test.uid = :'p_ire';
update players set power = 1000 where id = :'p_ire';
select pg_temp.ok(jsonb_array_length(raid_state()->'bosses') = 2, 'боссы — организаторы (2)');
select pg_temp.ok(raid_state()->'bosses'->1->>'name' = 'Админ Админов', 'админ — последний босс');
select pg_temp.ok((raid_state()->'bosses'->1->>'hp')::int = 140625, 'финальный босс: ×1,25 и ×2,5');
select pg_temp.ok((raid_hit(100000)->>'dealt')::int = 6000, 'урон за штурм — не больше 6 × сила отряда');
select pg_temp.fails('select raid_hit(10)', 'Отряд отдыхает%', 'штурм — раз в N минут');
update raid_hits set at = at - interval '1 hour' where player_id = :'p_ire';
update raid_progress set last_hit = last_hit - interval '1 hour' where faction = 'ire';
select pg_temp.ok((raid_state()->'my'->>'dmg')::int = 1500, 'без штурмов босс восстановил 10% за час');
update players set power = 100000 where id = :'p_ire';
select pg_temp.ok((raid_hit(1000000)->>'defeated')::boolean, 'первый босс повержен');
select pg_temp.ok((raid_state()->'my'->>'boss')::int = 1, 'дальше — финальный босс');
select pg_temp.ok(exists (select 1 from announcements where text like 'ИРЭ победили босса%'), 'эфир: победа над боссом');
update raid_hits set at = at - interval '1 hour' where player_id = :'p_ire';
select pg_temp.ok((raid_hit(1000000)->>'captured')::boolean, 'профком захвачен');
select pg_temp.ok((select holder from raid_world) = 'ire', 'профком у ИРЭ');
select pg_temp.ok((select 'Ключи от профкома' = any(trophies) from faction_world where faction = 'ire'), 'трофей у ИРЭ');
update raid_hits set at = at - interval '1 hour' where player_id = :'p_ire';
select pg_temp.fails('select raid_hit(10)', '%уже прошло всех%', 'дальше штурмовать некого');
set test.uid = :'p_iee';
select pg_temp.ok((raid_state()->'my'->>'boss')::int = 0, 'у другого ПБ своя цепочка');
set test.uid = :'staff_id';
select pg_temp.fails('select raid_hit(10)', 'Организаторы — боссы%', 'организаторы не штурмуют');

\echo '--- 7. Полный сброс чистит голосование и штурм'
set test.uid = :'admin_id';
select admin_reset_progress('СБРОС') - 'epoch' as report;
select pg_temp.ok((select count(*) from vote_ballots) = 0 and (select count(*) from raid_progress) = 0 and (select count(*) from raid_hits) = 0, 'голоса и штурм обнулены');
select pg_temp.ok((select holder from raid_world) is null, 'профком снова ничей');
\echo 'ГОТОВО v10'
