-- Проверка v25: начисление всему ПБ.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
set test.role = '';
do $$ declare r bigint; u uuid; f text; begin
  select faction into f from roster where role = 'participant' group by faction order by count(*) desc limit 1;
  while (select count(*) from players where role = 'participant' and roster_id is not null and faction = f) < 3 loop
    select id into r from roster where role = 'participant' and player_id is null and faction = f order by id limit 1;
    exit when r is null;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end loop;
  perform set_config('test.f', f, false);
end $$;
select current_setting('test.f') as f \gset
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
select count(*) as cnt, coalesce(sum(rating), 0) as r0 from players where role = 'participant' and roster_id is not null and faction = :'f' \gset
select coalesce(sum(rating), 0) as other0 from players where role = 'participant' and faction <> :'f' \gset
set test.uid = :'staff_id';
\echo '--- начислить всему ПБ'
select staff_grant_pb(array[:'f'], 25, 'bonus', 'за активность на блоке') as res \gset
select pg_temp.ok((:'res'::jsonb->>'players')::int = :cnt and (:'res'::jsonb->>'granted')::int = 25 * :cnt, 'всем участникам ПБ по +25');
select pg_temp.ok((select sum(rating) from players where role = 'participant' and roster_id is not null and faction = :'f') = :r0 + 25 * :cnt, 'рейтинг ПБ вырос');
select pg_temp.ok((select coalesce(sum(rating), 0) from players where role = 'participant' and faction <> :'f') = :other0, 'другие ПБ не тронуты');
select pg_temp.ok((select count(*) from notifications n join players p on p.id = n.player_id where p.faction = :'f' and n.text like 'Организатор начислил +25 баллов всему ПБ: за активность%') >= :cnt, 'каждому пришло уведомление');
do $$ begin perform staff_grant_pb(array['ivti'], 600); raise exception 'ПРОВАЛ: 600'; exception when others then if sqlerrm not like 'Сумма — от 1 до 500%' then raise; end if; end $$;
do $$ begin perform staff_grant_pb('{}'::text[], 10); raise exception 'ПРОВАЛ: пусто'; exception when others then if sqlerrm not like 'Выбери хотя бы одно ПБ%' then raise; end if; end $$;
