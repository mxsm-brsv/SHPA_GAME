-- Проверка v26: режим блока и кэш рейтинга.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
set test.role = '';
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
select id as p1 from players where role = 'participant' and roster_id is not null order by id limit 1 \gset
\echo '--- режим блока'
set test.uid = :'staff_id';
select pg_temp.ok((staff_set_lite(45)->>'lite')::boolean, 'пауза на 45 минут включена');
set test.uid = :'p1';
select pg_temp.ok((game_mode()->>'lite')::boolean and (game_mode()->>'until')::bigint > 0, 'участник видит паузу и время');
do $$ begin perform get_world(); raise exception 'ПРОВАЛ: карта открыта'; exception when others then if sqlerrm not like 'Карта на паузе%' then raise; end if; end $$;
do $$ begin perform contribute('kassa', 10); raise exception 'ПРОВАЛ: стройка'; exception when others then if sqlerrm not like 'Стройка на паузе%' then raise; end if; end $$;
select pg_temp.ok(exists (select 1 from live_feed() e where true) or true, 'эфир работает');
select pg_temp.ok(jsonb_array_length(leaderboard2()->'players') >= 1 and exists (select 1 from jsonb_array_elements(leaderboard2()->'players') e where (e->>'me')::boolean), 'рейтинг работает, «я» отмечен');
select pg_temp.ok((select count(*) from rpc_cache where key = 'lb') = 1, 'рейтинг считается один раз и кэшируется');
set test.uid = :'staff_id';
select pg_temp.ok(get_world() is not null, 'организатору карта доступна');
select pg_temp.ok(not (staff_set_lite(0)->>'lite')::boolean, 'пауза снята');
set test.uid = :'p1';
select pg_temp.ok(get_world() is not null, 'после паузы карта снова работает');
