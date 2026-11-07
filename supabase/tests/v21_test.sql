-- Проверка v21: «Эфир» уходит и в бот — получатели, один раз на сообщение.
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
  while (select count(*) from players where role = 'participant' and roster_id is not null) < 2 loop
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end loop;
end $$;
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
select (array_agg(id order by id))[1] as p1, (array_agg(id order by id))[2] as p2
from (select id from players where role = 'participant' and roster_id is not null order by id limit 2) x \gset
update roster set tg_id = 777000001 where player_id = :'p1';
update roster set tg_id = 777000002 where player_id = :'p2';

\echo '--- эфир → бот'
set test.uid = :'staff_id';
select staff_announce('Через 10 минут — финальная стычка', 'alert', 30) as aid \gset
select pg_temp.ok(:aid > 0, 'staff_announce вернул номер сообщения');
select service_announce_targets(:aid) as t \gset
select pg_temp.ok((:'t'::jsonb->>'kind') = 'alert' and (:'t'::jsonb->'ids') @> '[777000001, 777000002]'::jsonb, 'получатели — все вошедшие из Telegram');
select pg_temp.ok(service_announce_targets(:aid) is null, 'второй раз то же сообщение не рассылается');
select service_announce_sent(:aid, 2) is null as s \gset
select pg_temp.ok((select bot_sent from announcements where id = :aid) = 2, 'записано, сколько получили');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.service_announce_targets(bigint)', 'execute'), 'участники не вызывают рассылку напрямую');
select pg_temp.ok(has_function_privilege('authenticated', 'public.staff_announce(text, text, integer)', 'execute'), 'staff_announce доступен из приложения');
