-- Проверка v20: «Улыбка» и «Объятия» без ограничения, цена растёт с каждой покупкой.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
set test.role = '';
set test.uid = '';
do $$ declare r bigint; u uuid; begin
  while (select count(*) from players where role = 'participant' and roster_id is not null) < 2 loop
    select id into r from roster where role = 'participant' and player_id is null order by id limit 1;
    insert into auth.users default values returning id into u; perform roster_attach(r, u);
  end loop;
end $$;
select (array_agg(id order by id))[1] as p1, (array_agg(id order by id))[2] as p2
from (select id from players where role = 'participant' and roster_id is not null order by id limit 2) x \gset
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
insert into settings (key, value) values ('shop_open', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
select _grant_task(:'p1', 'bonus', 200, 'task', null, 'тест v20') as g1 \gset
select _grant_task(:'p2', 'bonus', 200, 'task', null, 'тест v20') as g2 \gset

\echo '--- безлимитные товары'
select pg_temp.ok((select unlimited and price = 5 and price_step = 1 from merch_items where id = 's7_org_smile'), 'улыбка: старт 5, +1 за покупку');
select pg_temp.ok((select unlimited and price = 10 and price_step = 1 from merch_items where id = 's7_org_hug'), 'объятия: старт 10, +1 за покупку');
set test.uid = :'p1';
select pg_temp.ok((merch_buy('s7_org_smile')->>'price')::int = 5, 'первая улыбка — 5');
select pg_temp.ok((merch_buy('s7_org_smile')->>'price')::int = 6, 'вторая (тот же человек) — 6');
set test.uid = :'p2';
select merch_buy('s7_org_smile')->>'id' as oid3 \gset
select pg_temp.ok((select (e->>'price')::int = 5 and (e->>'sold')::int = 3 and (e->>'unlimited')::boolean from jsonb_array_elements(merch_list()) e where e->>'id' = 's7_org_smile'), 'в магазине: куплено 3, базовая цена 5');
select pg_temp.ok((select merch_price(m) from merch_items m where id = 's7_org_smile') = 8, 'текущая цена — 8');
set test.uid = :'staff_id';
select staff_order_set(:'oid3', 'cancelled') is null as c \gset
select pg_temp.ok((select merch_price(m) from merch_items m where id = 's7_org_smile') = 7, 'отменили заказ — цена 7');
select pg_temp.ok((select stock = 0 and total = 0 from merch_items where id = 's7_org_smile'), 'остаток у безлимитного не ведётся');
select _reset_all();
select pg_temp.ok((select merch_price(m) from merch_items m where id = 's7_org_hug') = 10 and (select stock from merch_items where id = 's7_org_smile') = 0, 'после сброса — снова со старта');
