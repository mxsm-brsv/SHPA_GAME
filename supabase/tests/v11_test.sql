-- Проверка v11: разоблачение колеса и общий итог казино (после v10, где всё сброшено — регистрируем заново).
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
set test.role = '';
set test.uid = '';
select id as admin_id from players where role = 'admin' limit 1 \gset
select id as staff_id from players where role = 'staff' limit 1 \gset
select id as p1 from players where role = 'participant' order by id limit 1 \gset
select id as admin_roster from roster where role = 'admin' limit 1 \gset
select id as staff_roster from roster where role = 'staff' limit 1 \gset
select id as p1_roster from roster where role = 'participant' and player_id is null limit 1 \gset
select roster_attach(:admin_roster, :'admin_id');
select roster_attach(:staff_roster, :'staff_id');
select roster_attach(:p1_roster, :'p1');
update players set state = jsonb_set(coalesce(state, '{}'::jsonb), '{casino}', '{"bet": 1000, "won": 600, "spins": 12, "near": 5}'::jsonb) where id = :'p1';
\echo '--- до разоблачения итог видят только организаторы'
set test.uid = :'p1';
do $$ begin perform casino_stats(); raise exception 'не должно'; exception when others then if sqlerrm not like '%откроют организаторы%' then raise; end if; end $$;
select pg_temp.ok((get_config()->>'casinoReveal')::boolean = false, 'разоблачение выключено');
set test.uid = :'staff_id';
select pg_temp.ok((casino_stats()->>'bet')::int = 1000 and (casino_stats()->>'won')::int = 600 and (casino_stats()->>'players')::int = 1, 'организатор видит итог');
\echo '--- организатор включает разоблачение'
select staff_set_setting('casino_reveal', true);
set test.uid = :'p1';
select pg_temp.ok((get_config()->>'casinoReveal')::boolean, 'участник видит, что разоблачение включено');
select pg_temp.ok((casino_stats()->>'near')::int = 5, 'и общий итог');
do $$ begin perform staff_set_setting('casino_reveal', false); raise exception 'не должно'; exception when others then if sqlerrm <> 'staff only' then raise; end if; end $$;
\echo '--- полный сброс выключает разоблачение'
set test.uid = :'admin_id';
select admin_reset_progress('СБРОС') - 'epoch' as report;
select pg_temp.ok(not setting_bool('casino_reveal', false), 'разоблачение снова выключено');
\echo 'ГОТОВО v11'
