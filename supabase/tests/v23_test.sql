-- Проверка v23: товар редактируется целиком, скрытый возвращается.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, what text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ПРОВАЛ: %', what; end if;
  return 'ok  ' || what;
end $$;
set test.role = '';
select id as staff_id from players where is_staff and roster_id is not null order by id limit 1 \gset
set test.uid = :'staff_id';
\echo '--- редактирование мерча'
select staff_merch_save('{"id":"s7_removka","name":"  Ремувка ШПА  ","emoji":"🔑","text":"новое описание","price":45,"stock":20,"perPerson":2,"discount":0}'::jsonb) is null as a \gset
select pg_temp.ok((select name = 'Ремувка ШПА' and emoji = '🔑' and descr = 'новое описание' and price = 45 and per_person = 2 from merch_items where id = 's7_removka'), 'название, эмодзи, описание, цена, в одни руки');
select pg_temp.ok((select (e->>'name') = 'Ремувка ШПА' from jsonb_array_elements(merch_list()) e where e->>'id' = 's7_removka'), 'участники видят новое название');
do $$ begin perform staff_merch_save('{"id":"s7_removka","name":"Улыбка Макса Борисова"}'::jsonb); raise exception 'ПРОВАЛ: дубль названия'; exception when others then if sqlerrm not like 'Товар «%» уже есть%' then raise; end if; end $$;
select staff_merch_save('{"id":"s7_removka","unlimited":true,"step":2}'::jsonb) is null as b \gset
select pg_temp.ok((select unlimited and price_step = 2 and stock = 0 from merch_items where id = 's7_removka'), 'можно сделать безлимитным с шагом цены');
select staff_merch_save('{"id":"s7_removka","unlimited":false,"step":0,"stock":20,"active":false}'::jsonb) is null as c \gset
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(merch_list()) e where e->>'id' = 's7_removka'), 'скрытый не виден участникам');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(staff_merch_all()) e where e->>'id' = 's7_removka' and (e->>'active')::boolean = false), 'скрытый виден в панели');
select staff_merch_save('{"id":"s7_removka","name":"Ремувка","emoji":"🏷️","text":"Брелок-ремувка ППО","price":40,"stock":20,"perPerson":1,"active":true}'::jsonb) is null as d \gset
select pg_temp.ok((select active and stock = 20 and not unlimited from merch_items where id = 's7_removka'), 'вернули в продажу');
