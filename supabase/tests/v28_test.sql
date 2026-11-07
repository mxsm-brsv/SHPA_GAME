-- Проверка v28: удача колеса по кнопке.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
set test.role = '';
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
select id as p1 from players where role = 'participant' and roster_id is not null order by id limit 1 \gset
select _grant_task(:'p1', 'bonus', 300, 'task', null, 'v28') as g \gset
\echo '--- колесо: режимы'
set test.uid = :'p1';
select (my_wallet()->>'balance')::int as b0 \gset
select casino_points_bet(50) as w0 \gset
select pg_temp.ok((:'w0'::jsonb->>'mult')::int = 0 and (my_wallet()->>'balance')::int = :b0 - 50, 'обычный режим: баллы проигрывают');
set test.uid = :'staff_id';
select staff_set_casino('win') as m1 \gset
select pg_temp.ok(:'m1' = 'win' and (game_mode()->>'casino') = 'win', 'включили «профкоины всегда выигрывают»');
select pg_temp.ok(exists (select 1 from announcements where text like 'Счастливый час%' and until > now()), 'в эфире объявление');
set test.uid = :'p1';
select pg_temp.ok((casino_points_bet(10)->>'mult')::int = 0, 'в режиме win баллы всё ещё проигрывают');
set test.uid = :'staff_id';
select staff_set_casino('win_all') as m \gset
set test.uid = :'p1';
select (my_wallet()->>'balance')::int as b1 \gset
select casino_points_bet(40) as w \gset
select pg_temp.ok((:'w'::jsonb->>'mult')::int = 2 and (my_wallet()->>'balance')::int = :b1 + 40, 'win_all: ставка 40 баллов → +40 на счёт');
set test.uid = :'staff_id';
select staff_set_casino('normal') as m2 \gset
select pg_temp.ok(:'m2' = 'normal' and not exists (select 1 from announcements where text like 'Счастливый час%' and until > now()), 'вернули как было, объявление убрано');
select casino_stats() as cs \gset
select pg_temp.ok((:'cs'::jsonb->>'pointsLucky')::int >= 1 and (:'cs'::jsonb->>'points')::int = (select coalesce(sum(amount), 0) from casino_point_bets where won = 0), 'итог: «счастливый час» не смешан с проигрышами');
